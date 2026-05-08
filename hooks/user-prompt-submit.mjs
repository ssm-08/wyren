#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readStdin, isMain } from '../lib/util.mjs';
import { readMemory, writeMemoryAtomic } from '../lib/memory.mjs';
import { GitSync } from '../lib/sync.mjs';
import { diffMemory, renderDelta, hashMemory } from '../lib/diff-memory.mjs';

const SNAPSHOT_FILE = 'last-injected-memory.md';

/**
 * UPS owns its own state file — separate from watermark.json (owned by stop.mjs).
 * This eliminates the read-modify-write race that existed when both hooks wrote
 * to the shared watermark.json: UPS only needs last_injected_mtime + last_injected_hash,
 * Stop only needs turns_since_distill + distiller_running + last_turn_at.
 * No shared mutable state → no lock needed.
 */
const UPS_STATE_FILE = 'ups-state.json';

function appendLog(cwd, msg) {
  try {
    const logPath = path.join(cwd, '.wyren', 'log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [ups] ${msg}\n`);
  } catch {}
}

function readUpsState(upsStatePath) {
  try { return JSON.parse(fs.readFileSync(upsStatePath, 'utf8')); } catch { return {}; }
}

function writeUpsStateAtomic(upsStatePath, state) {
  const tmp = `${upsStatePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, upsStatePath); return; } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') break;
      // Staggered busy-wait: reduces concurrent NTFS rename contention on Windows
      const end = Date.now() + i + 1;
      while (Date.now() < end) {}
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}

function markInjection(cwd, event) {
  appendLog(cwd, `injection: ${event}`);
}

/**
 * Exported for unit testing — all logic with no I/O side effects except reading files.
 * Returns { delta: string, newUpsState: object, newSnapshot: string } or null (skip).
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.wyrenDir
 * @param {string} opts.upsStatePath  - path to ups-state.json (UPS-owned, never written by stop.mjs)
 * @param {string} opts.snapshotPath
 * @param {string} opts.memoryPath
 */
export function buildInjection({ cwd, wyrenDir, upsStatePath, snapshotPath, memoryPath }) {
  // 1. Check memory.md exists
  if (!fs.existsSync(memoryPath)) return null;

  const st = readUpsState(upsStatePath);
  let currentMtime;
  try {
    const stat = fs.statSync(memoryPath);
    if (!stat.isFile()) return null;
    currentMtime = stat.mtimeMs;
  } catch {
    return null;
  }

  // 2. Fast path: mtime unchanged since last injection check
  if (st.last_injected_mtime === currentMtime) return null;

  // 3. Read current memory content + compute hash
  const currentContent = readMemory(memoryPath);
  const currentHash = hashMemory(currentContent);

  // 4. First-run seed: no prior injection → seed without injecting
  if (!st.last_injected_hash) {
    return {
      delta: null,
      newUpsState: { last_injected_mtime: currentMtime, last_injected_hash: currentHash },
      newSnapshot: currentContent,
    };
  }

  // 5. Hash unchanged (e.g. file re-written with same content) → update mtime only
  if (currentHash === st.last_injected_hash) {
    return {
      delta: null,
      newUpsState: { ...st, last_injected_mtime: currentMtime },
      newSnapshot: null,
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
    newUpsState: { last_injected_mtime: currentMtime, last_injected_hash: currentHash },
    newSnapshot: currentContent,
  };
}

async function main() {
  let cwd;
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    cwd = input.cwd;

    const wyrenDir = path.join(cwd, '.wyren');
    if (!fs.existsSync(wyrenDir)) { process.exit(0); }

    // Pull latest memory from remote with tight timeout (stay within 2s hook budget)
    try {
      new GitSync().pull(cwd, { fetchTimeoutMs: 1500, checkoutTimeoutMs: 500 });
    } catch (e) {
      appendLog(cwd, `pull failed: ${e.message}`);
      // Fail-open: proceed with whatever is on disk
    }

    const stateDir = path.join(wyrenDir, 'state');
    const upsStatePath = path.join(stateDir, UPS_STATE_FILE);
    const snapshotPath = path.join(stateDir, SNAPSHOT_FILE);
    const memoryPath = path.join(wyrenDir, 'memory.md');

    const result = buildInjection({ cwd, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    if (!result) { process.exit(0); }

    const { delta, newUpsState, newSnapshot } = result;

    // Write state updates — only to UPS-owned files; never touch watermark.json
    fs.mkdirSync(stateDir, { recursive: true });
    writeUpsStateAtomic(upsStatePath, newUpsState);
    if (newSnapshot !== null) {
      writeMemoryAtomic(snapshotPath, newSnapshot);
    }

    if (!delta) { process.exit(0); }

    markInjection(cwd, 'user-prompt-submit');

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
