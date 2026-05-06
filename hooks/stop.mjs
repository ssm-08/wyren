#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import { readStdin, isMain } from '../lib/util.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const TURNS_THRESHOLD = process.env.RELAY_TURNS_THRESHOLD ? parseInt(process.env.RELAY_TURNS_THRESHOLD, 10) : 5;
const IDLE_MS = process.env.RELAY_IDLE_MS ? parseInt(process.env.RELAY_IDLE_MS, 10) : 2 * 60 * 1000;

export function writeWatermarkAtomic(watermarkPath, state) {
  const tmp = `${watermarkPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, watermarkPath); return; } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY') break;
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}

export function updateWatermark(relayDir) {
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  const watermarkPath = path.join(stateDir, 'watermark.json');
  let state = { turns_since_distill: 0 };
  try {
    state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
  } catch {}

  state.turns_since_distill = (state.turns_since_distill ?? 0) + 1;
  state.last_turn_at = Date.now();

  writeWatermarkAtomic(watermarkPath, state);
  return state;
}

export function shouldDistill(state) {
  if (state.distiller_running) {
    // PID liveness check — if the distiller was killed (OOM, forced reboot) the flag would
    // stick forever. Verify the PID is still alive; only treat as stale on ESRCH (no such process).
    if (state.distiller_pid) {
      try {
        process.kill(state.distiller_pid, 0);
        return false; // still alive
      } catch (e) {
        if (e.code !== 'ESRCH') return false; // EPERM or unknown — conservatively honor flag
        // ESRCH: process is gone — stale flag, fall through to normal threshold checks
      }
    } else {
      return false; // no PID stored, honor flag
    }
  }
  if (state.turns_since_distill >= TURNS_THRESHOLD) return true;
  // idle trigger: turns accumulated but not yet at threshold
  // Use last_turn_at (not last_distilled_at) so idle trigger fires even before first distillation
  if (
    state.turns_since_distill > 0 &&
    state.last_turn_at &&
    Date.now() - state.last_turn_at > IDLE_MS
  ) return true;
  return false;
}

export function spawnDistiller({ relayDir, transcriptPath, since, cwd }) {
  const distillerPath =
    process.env.CLAUDE_PLUGIN_ROOT
      ? path.join(process.env.CLAUDE_PLUGIN_ROOT, 'distiller.mjs')
      : path.join(__dirname, '..', 'distiller.mjs');

  const memoryPath = path.join(relayDir, 'memory.md');
  const logPath = path.join(relayDir, 'log');

  const args = [
    distillerPath,
    '--transcript', transcriptPath,
    '--memory', memoryPath,
    '--out', memoryPath,
    '--cwd', cwd,
  ];
  if (since) args.push('--since', since);

  let logFd;
  try {
    logFd = fs.openSync(logPath, 'a');
  } catch {
    logFd = 'ignore';
  }

  const proc = spawn('node', args, {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  proc.on('error', (e) => {
    process.stderr.write(`[relay] distiller spawn failed: ${e.message}\n`);
  });
  proc.unref();
  // close parent's copy — child already inherited its own fd
  if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch {} }
  return proc;
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd, transcript_path } = input;
    const relayDir = path.join(cwd, '.relay');
    if (!fs.existsSync(relayDir)) process.exit(0);

    const state = updateWatermark(relayDir);

    if (shouldDistill(state) && transcript_path) {
      // openSync('wx') is atomic — EEXIST if another Stop hook beat us here
      const triggerLock = path.join(relayDir, 'state', 'distill-trigger.lock');
      try {
        fs.closeSync(fs.openSync(triggerLock, 'wx'));
      } catch {
        process.exit(0); // another process won the race
      }

      const watermarkPath = path.join(relayDir, 'state', 'watermark.json');

      const distProc = spawnDistiller({
        relayDir,
        transcriptPath: transcript_path,
        since: state.last_uuid || '',
        cwd,
      });

      // Only set distiller_running + reset turns if OS assigned a pid.
      // If spawn silently failed (pid undefined), don't reset turns — distiller never ran.
      const pid = distProc?.pid;
      if (pid) {
        state.distiller_running = true;
        state.distiller_pid = pid;
        state.turns_since_distill = 0;
      }
      writeWatermarkAtomic(watermarkPath, state);
      // Release trigger lock only after distiller_running is written — prevents a second
      // concurrent Stop hook from passing the lock check before the flag is set.
      try { fs.unlinkSync(triggerLock); } catch {}
    }
  } catch (e) {
    process.stderr.write(`[relay] stop error: ${e.message}\n`);
  }
  process.exit(0);
}

if (isMain(import.meta.url)) main();
