#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import { readStdin, isMain } from '../lib/util.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const TURNS_THRESHOLD = 5;
const IDLE_MS = 2 * 60 * 1000;

export function writeWatermarkAtomic(watermarkPath, state) {
  const tmp = `${watermarkPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, watermarkPath);
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
  if (state.distiller_running) return false;
  if (state.turns_since_distill >= TURNS_THRESHOLD) return true;
  // idle trigger: turns accumulated but not yet at threshold
  if (
    state.turns_since_distill > 0 &&
    state.last_distilled_at &&
    Date.now() - state.last_distilled_at > IDLE_MS
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
      state.distiller_running = true;
      state.turns_since_distill = 0;
      writeWatermarkAtomic(watermarkPath, state);

      // release trigger lock immediately — distiller_running flag takes over
      try { fs.unlinkSync(triggerLock); } catch {}

      spawnDistiller({
        relayDir,
        transcriptPath: transcript_path,
        since: state.last_uuid || '',
        cwd,
      });
    }
  } catch (e) {
    process.stderr.write(`[relay] stop error: ${e.message}\n`);
  }
  process.exit(0);
}

if (isMain(import.meta.url)) main();
