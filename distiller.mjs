#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import {
  readTranscriptLines,
  sliceSinceUuid,
  renderForDistiller,
  lastUuid,
} from './lib/transcript.mjs';
import { readMemory, writeMemoryAtomic } from './lib/memory.mjs';
import { hasTier0Signal } from './lib/filter.mjs';
import { GitSync } from './lib/sync.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CLAUDE_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = val;
      i++;
    }
  }
  return out;
}

function usage() {
  console.error(
    `Usage: distiller.mjs --transcript <path> --memory <path> --out <path>` +
    ` [--since <uuid>] [--cwd <dir>] [--limit <n>] [--model <id>] [--dry-run]`
  );
  process.exit(2);
}

function buildPrompt({ systemPrompt, sessionId, existingMemory, transcriptSlice }) {
  return (
    systemPrompt +
    `\n\n<session-id>${sessionId || 'unknown'}</session-id>\n\n` +
    `<existing-memory>\n${existingMemory || '(empty — first distillation)'}\n</existing-memory>\n\n` +
    `<transcript-slice>\n${transcriptSlice}\n</transcript-slice>\n`
  );
}

function runClaude(prompt, model) {
  return new Promise((resolve, reject) => {
    const claudeArgs = [
      '-p',
      '--bare',
      '--no-session-persistence',
      '--tools', '',   // empty string = no tools; --bare doesn't disable tools
      '--output-format', 'text',
      '--max-budget-usd', '1.00',
    ];
    if (model) claudeArgs.push('--model', model);

    // Windows: use cmd /c to invoke claude without shell:true (avoids injection surface)
    const [exe, args] = process.platform === 'win32'
      ? ['cmd', ['/c', 'claude', ...claudeArgs]]
      : ['claude', claudeArgs];

    let proc;
    try {
      proc = spawn(exe, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return reject(new Error(`failed to spawn claude: ${e.message}. Is claude CLI on PATH?`));
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error(`claude subprocess timed out after ${CLAUDE_TIMEOUT_MS}ms`));
    }, CLAUDE_TIMEOUT_MS);

    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`claude spawn error: ${e.message}. Is claude CLI on PATH?`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.stdin.end(prompt, 'utf8');
  });
}

// Intentionally not imported from stop.mjs — distiller runs detached and must be self-contained.
function writeWatermark(cwd, uuid, { clearRunning = false, transcript = '' } = {}) {
  if (!cwd) return;
  const statePath = path.join(cwd, '.wyren', 'state', 'watermark.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
  if (uuid) {
    state.last_uuid = uuid;
    state.last_distilled_at = Date.now();
  }
  if (transcript) state.last_transcript = transcript;
  if (clearRunning) {
    delete state.distiller_running;
    delete state.distiller_pid; // clear stale PID alongside the flag
  }
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  // Retry loop matches writeWatermarkAtomic in stop.mjs — EPERM/EBUSY transient on Windows
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, statePath); return; } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY') break;
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.transcript || !args.memory || !args.out) usage();

  const transcriptPath = args.transcript;
  const memoryPath = args.memory;
  const outPath = args.out;
  const since = args.since && args.since !== 'true' ? args.since : '';
  const cwd = args.cwd && args.cwd !== 'true' ? args.cwd : '';
  const model = args.model && args.model !== 'true' ? args.model : 'claude-haiku-4-5-20251001';
  const dryRun = !!args['dry-run'];
  const force = !!args['force'];

  // --limit applies to raw lines before --since slice; useful for A/B testing only.
  // Chunk 3 wiring uses --since and omits --limit.
  const limit = args.limit && args.limit !== 'true' ? parseInt(args.limit, 10) : 0;

  if (!fs.existsSync(transcriptPath)) {
    console.error(`transcript not found: ${transcriptPath}`);
    process.exit(1);
  }

  const promptPath = path.join(__dirname, 'prompts', 'distill.md');
  const systemPrompt = fs.readFileSync(promptPath, 'utf8');

  const lines = await readTranscriptLines(transcriptPath);
  const limited = limit > 0 ? lines.slice(0, limit) : lines;
  const sliced = sliceSinceUuid(limited, since);
  const transcriptSlice = renderForDistiller(sliced);

  if (!transcriptSlice.trim()) {
    console.error('empty transcript slice; nothing to distill');
    // Write watermark to end of limited lines so next run advances correctly
    const endUuid = lastUuid(limited) || lastUuid(lines);
    if (endUuid) writeWatermark(cwd, endUuid, { clearRunning: true });
    process.exit(0);
  }

  const existingMemory = readMemory(memoryPath);

  // Use session id from transcript; fall back to filename-derived id to avoid
  // empty provenance tags ([session , turn n]) in distilled memory entries.
  const rawSessionId = (lines.find((l) => l && l.sessionId) || {}).sessionId || '';
  const sessionId = rawSessionId.slice(0, 8) ||
    path.basename(transcriptPath, '.jsonl').slice(0, 8);

  const fullPrompt = buildPrompt({
    systemPrompt,
    sessionId,
    existingMemory,
    transcriptSlice,
  });

  if (dryRun) {
    process.stdout.write(fullPrompt);
    return;
  }

  // Tier 0: skip API call if slice has no actionable signal (bypass with --force)
  if (!force && !hasTier0Signal(transcriptSlice, sliced)) {
    console.error('distiller: low-signal session; skipping distillation');
    const endUuid = lastUuid(sliced) || lastUuid(limited) || lastUuid(lines);
    writeWatermark(cwd, endUuid, { clearRunning: true });
    process.exit(0);
  }

  console.error(
    `distiller: transcript=${transcriptPath} lines=${lines.length}` +
    ` slice_chars=${transcriptSlice.length} memory_chars=${existingMemory.length} model=${model}`
  );

  try {
    const newMemory = await runClaude(fullPrompt, model);
    const cleaned = newMemory.trim() + '\n';
    writeMemoryAtomic(outPath, cleaned);

    const newLastUuid = lastUuid(sliced) || lastUuid(limited) || lastUuid(lines);
    writeWatermark(cwd, newLastUuid, { clearRunning: true, transcript: transcriptPath });

    console.error(
      `distiller: wrote ${outPath} (${cleaned.length} chars). last_uuid=${newLastUuid}`
    );

    // Sync push (best-effort — failure is logged but never throws)
    if (cwd) {
      const sync = new GitSync();
      let release = () => {};
      let locked = false;
      try {
        release = sync.lock(cwd);
      } catch (e) {
        locked = true; // any lock failure → skip push (conservative)
        const reason = e.message === 'LOCKED' ? 'locked by another process' : `lock error: ${e.message}`;
        console.error(`distiller: ${reason}, skipping push`);
      }
      if (!locked) {
        try {
          sync.push(cwd, sessionId);
        } catch (e) {
          console.error(`distiller: sync.push error: ${e.message}`);
        } finally {
          release();
        }
      }
    }
  } catch (e) {
    try { writeWatermark(cwd, null, { clearRunning: true }); } catch {}
    throw e;
  }
}

main().catch((e) => {
  console.error(`distiller error: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
