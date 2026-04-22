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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

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
    `Usage: distiller.mjs --transcript <path> --memory <path> --out <path> [--since <uuid>] [--model <id>] [--dry-run]`
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
    const args = [
      '-p',
      '--bare',
      '--no-session-persistence',
      '--tools', '',
      '--output-format', 'text',
      '--max-budget-usd', '1.00',
    ];
    if (model) args.push('--model', model);
    const proc = spawn('claude', args, {
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    proc.stdin.end(prompt, 'utf8');
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.transcript || !args.memory || !args.out) usage();

  const transcriptPath = args.transcript;
  const memoryPath = args.memory;
  const outPath = args.out;
  const since = args.since && args.since !== 'true' ? args.since : '';
  const model = args.model && args.model !== 'true' ? args.model : 'claude-sonnet-4-6';
  const dryRun = !!args['dry-run'];

  if (!fs.existsSync(transcriptPath)) {
    console.error(`transcript not found: ${transcriptPath}`);
    process.exit(1);
  }

  const promptPath = path.join(__dirname, 'prompts', 'distill.md');
  const systemPrompt = fs.readFileSync(promptPath, 'utf8');

  const lines = await readTranscriptLines(transcriptPath);
  const limit = args.limit && args.limit !== 'true' ? parseInt(args.limit, 10) : 0;
  const limited = limit > 0 ? lines.slice(0, limit) : lines;
  const sliced = sliceSinceUuid(limited, since);
  const transcriptSlice = renderForDistiller(sliced);

  if (!transcriptSlice.trim()) {
    console.error('empty transcript slice; nothing to distill');
    process.exit(0);
  }

  const existingMemory = readMemory(memoryPath);

  const sessionId =
    (lines.find((l) => l && l.sessionId) || {}).sessionId || '';

  const fullPrompt = buildPrompt({
    systemPrompt,
    sessionId: sessionId.slice(0, 8),
    existingMemory,
    transcriptSlice,
  });

  if (dryRun) {
    process.stdout.write(fullPrompt);
    return;
  }

  console.error(
    `distiller: transcript=${transcriptPath} lines=${lines.length} slice_chars=${transcriptSlice.length} memory_chars=${existingMemory.length} model=${model}`
  );

  const newMemory = await runClaude(fullPrompt, model);
  const cleaned = newMemory.trim() + '\n';
  writeMemoryAtomic(outPath, cleaned);

  const newLastUuid = lastUuid(sliced) || lastUuid(lines);
  console.error(
    `distiller: wrote ${outPath} (${cleaned.length} chars). last_uuid=${newLastUuid}`
  );
}

main().catch((e) => {
  console.error(`distiller error: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
