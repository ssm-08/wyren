#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readStdin, isMain, atomicRename } from '../lib/util.mjs';
import { readMemory, writeMemoryAtomic } from '../lib/memory.mjs';
import { GitSync } from '../lib/sync.mjs';
import { diffMemory, renderDelta, hashMemory } from '../lib/diff-memory.mjs';

const SNAPSHOT_FILE = 'last-injected-memory.md';

/**
 * Merge a force-push warning into a non-null buildInjection result.
 * Pure function — no I/O. Exported for unit testing.
 * Only call when result is non-null; null result is handled separately in main().
 */
export function mergeForcePushWarning(result, warningText) {
  if (!warningText) return result;
  return {
    ...result,
    delta: result.delta ? `${warningText}\n\n${result.delta}` : warningText,
  };
}

/** Runs a git command, returns trimmed stdout or null on any failure. */
function tryGit(args, cwd, timeout = 1_000) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', timeout, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || '').trim() || null;
}

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
  atomicRename(tmp, upsStatePath);
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
    let pullSucceeded = false;
    try {
      new GitSync().pull(cwd, { fetchTimeoutMs: 1500, checkoutTimeoutMs: 500 });
      pullSucceeded = true;
    } catch (e) {
      appendLog(cwd, `pull failed: ${e.message}`);
      // Fail-open: proceed with whatever is on disk
    }

    const stateDir = path.join(wyrenDir, 'state');
    const upsStatePath = path.join(stateDir, UPS_STATE_FILE);
    const snapshotPath = path.join(stateDir, SNAPSHOT_FILE);
    const memoryPath = path.join(wyrenDir, 'memory.md');

    // Force-push detection: verify remote memory.md commit ancestry (fail-open throughout)
    let forcePushWarning = null;
    let currentRemoteSha = null;
    if (pullSucceeded) {
      try {
        const remote =
          tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd) ||
          (() => {
            const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
            return branch ? `origin/${branch}` : null;
          })();

        if (remote) {
          currentRemoteSha = tryGit(
            ['log', remote, '-n1', '--format=%H', '--', '.wyren/memory.md'], cwd
          );
          const st = readUpsState(upsStatePath);
          const lastSha = st.last_remote_memory_commit;

          if (currentRemoteSha && lastSha && lastSha !== currentRemoteSha) {
            const r = spawnSync('git', ['merge-base', '--is-ancestor', lastSha, currentRemoteSha], {
              cwd, timeout: 1_000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
            });
            if (!r.error && r.status === 1) {
              forcePushWarning =
                '⚠️ Wyren: remote memory.md was force-pushed (non-linear history). ' +
                'Treat injected context with extra caution.';
              appendLog(cwd, `force-push detected: last=${lastSha} current=${currentRemoteSha}`);
            }
          }
        }
      } catch (e) {
        appendLog(cwd, `force-push check error: ${e.message}`);
      }
    }

    const result = buildInjection({ cwd, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    // Null result: nothing new to inject. If force-push detected, still warn + persist SHA.
    if (!result) {
      if (forcePushWarning && currentRemoteSha) {
        fs.mkdirSync(stateDir, { recursive: true });
        const curSt = readUpsState(upsStatePath);
        writeUpsStateAtomic(upsStatePath, { ...curSt, last_remote_memory_commit: currentRemoteSha });
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: forcePushWarning,
          },
        }) + '\n');
        markInjection(cwd, 'user-prompt-submit');
      }
      process.exit(0);
    }

    const finalResult = mergeForcePushWarning(result, forcePushWarning);
    const { delta, newUpsState, newSnapshot } = finalResult;

    fs.mkdirSync(stateDir, { recursive: true });

    if (delta) {
      // Emit before marking the delta as delivered. If the hook is killed between
      // stdout and state persistence, the user may see the delta again later, but
      // we avoid the worse failure mode of recording an unseen update as injected.
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: delta,
        },
      }) + '\n');
    }

    // Write state updates only after successful output; never touch watermark.json.
    // Snapshot first: if killed between writes, next run re-diffs harmlessly rather than
    // fast-pathing on stale mtime and permanently losing the delta.
    if (newSnapshot !== null) {
      writeMemoryAtomic(snapshotPath, newSnapshot);
    }
    const stateToWrite = currentRemoteSha
      ? { ...newUpsState, last_remote_memory_commit: currentRemoteSha }
      : newUpsState;
    writeUpsStateAtomic(upsStatePath, stateToWrite);

    if (delta) markInjection(cwd, 'user-prompt-submit');
  } catch (e) {
    // Fail-open: log + exit 0, never break the session
    try { if (cwd) appendLog(cwd, `error: ${e && e.message ? e.message : e}`); } catch {}
    process.exit(0);
  }
}

if (isMain(import.meta.url)) main();
