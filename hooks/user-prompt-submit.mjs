#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readStdin, isMain } from '../lib/util.mjs';
import { readMemory, writeMemoryAtomic } from '../lib/memory.mjs';
import { writeWatermarkAtomic } from './stop.mjs';
import { GitSync } from '../lib/sync.mjs';
import { diffMemory, renderDelta, hashMemory } from '../lib/diff-memory.mjs';

const SNAPSHOT_FILE = 'last-injected-memory.md';

function appendLog(cwd, msg) {
  try {
    const logPath = path.join(cwd, '.relay', 'log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [ups] ${msg}\n`);
  } catch {}
}

function readWatermark(watermarkPath) {
  try { return JSON.parse(fs.readFileSync(watermarkPath, 'utf8')); } catch { return {}; }
}

/**
 * Exported for unit testing — all logic with no I/O side effects except reading files.
 * Returns { delta: string, newWatermark: object, newSnapshot: string } or null (skip).
 */
export function buildInjection({ cwd, relayDir, watermarkPath, snapshotPath, memoryPath }) {
  // 1. Check memory.md exists
  if (!fs.existsSync(memoryPath)) return null;

  const wm = readWatermark(watermarkPath);
  let currentMtime;
  try {
    currentMtime = fs.statSync(memoryPath).mtimeMs;
  } catch {
    return null;
  }

  // 2. Fast path: mtime unchanged since last injection check
  if (wm.last_injected_mtime === currentMtime) return null;

  // 3. Read current memory content + compute hash
  const currentContent = readMemory(memoryPath);
  const currentHash = hashMemory(currentContent);

  // 4. First-run seed: no prior injection → seed without injecting
  if (!wm.last_injected_hash) {
    return {
      delta: null,
      newWatermark: { ...wm, last_injected_mtime: currentMtime, last_injected_hash: currentHash },
      newSnapshot: currentContent,
    };
  }

  // 5. Hash unchanged (e.g. file re-written with same content) → update mtime only
  if (currentHash === wm.last_injected_hash) {
    return {
      delta: null,
      newWatermark: { ...wm, last_injected_mtime: currentMtime },
      newSnapshot: null, // no snapshot update needed
    };
  }

  // 6. Content changed — compute diff against stored snapshot
  let snapshotContent = '';
  try {
    if (fs.existsSync(snapshotPath)) {
      snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    }
  } catch {
    // Corrupt/missing snapshot — treat as empty, inject full diff
  }

  const diff = diffMemory(snapshotContent, currentContent);
  const delta = renderDelta(diff);

  return {
    delta: delta || null,
    newWatermark: { ...wm, last_injected_mtime: currentMtime, last_injected_hash: currentHash },
    newSnapshot: currentContent,
  };
}

async function main() {
  let cwd;
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    cwd = input.cwd;

    const relayDir = path.join(cwd, '.relay');
    if (!fs.existsSync(relayDir)) { process.exit(0); }

    // Pull latest memory from remote with tight timeout (stay within 2s hook budget)
    try {
      new GitSync().pull(cwd, { fetchTimeoutMs: 1000, checkoutTimeoutMs: 500 });
    } catch (e) {
      appendLog(cwd, `pull failed: ${e.message}`);
      // Fail-open: proceed with whatever is on disk
    }

    const stateDir = path.join(relayDir, 'state');
    const watermarkPath = path.join(stateDir, 'watermark.json');
    const snapshotPath = path.join(stateDir, SNAPSHOT_FILE);
    const memoryPath = path.join(relayDir, 'memory.md');

    const result = buildInjection({ cwd, relayDir, watermarkPath, snapshotPath, memoryPath });

    if (!result) { process.exit(0); }

    const { delta, newWatermark, newSnapshot } = result;

    // Write state updates
    fs.mkdirSync(stateDir, { recursive: true });
    writeWatermarkAtomic(watermarkPath, newWatermark);
    if (newSnapshot !== null) {
      writeMemoryAtomic(snapshotPath, newSnapshot);
    }

    if (!delta) { process.exit(0); }

    // Emit additionalContext
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: delta,
      },
    }) + '\n');
  } catch (e) {
    // Fail-open: log + exit 0, never break the session
    try { if (cwd) appendLog(cwd, `error: ${e && e.message ? e.message : e}`); } catch {}
    process.exit(0);
  }
}

if (isMain(import.meta.url)) main();
