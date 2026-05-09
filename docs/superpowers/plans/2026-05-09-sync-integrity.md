# Sync Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two sync-integrity gaps: stale memory detection (wyren status + distill nag) and force-push poisoning detection in UPS.

**Architecture:** Fix 1 adds a git query to `wyrenStatus()` and a console nag to `wyrenDistill()`. Fix 2 adds remote SHA tracking and an ancestry check in UPS `main()`, with a pure `mergeForcePushWarning()` helper exported for unit testing.

**Tech Stack:** Node.js ESM, `spawnSync` (already used), `node:test`, zero new deps.

---

### Task 1: `wyren status` — add `Peer pushed:` line

**Files:**
- Modify: `bin/wyren.mjs` (wyrenStatus function, around line 76)
- Create: `tests/wyren-status.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/wyren-status.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { wyrenStatus } from '../bin/wyren.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-status-test-'));
}

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

test('wyrenStatus: not initialized → prints init message', () => {
  const dir = makeTmpDir();
  try {
    const lines = captureLog(() => wyrenStatus(dir));
    assert.ok(lines.some(l => l.includes('wyren init')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenStatus: initialized, no remote → Peer pushed shows unavailable', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- x\n', 'utf8');
    const lines = captureLog(() => wyrenStatus(dir));
    const peerLine = lines.find(l => l.startsWith('Peer pushed:'));
    assert.ok(peerLine, 'Peer pushed: line must be present');
    assert.ok(
      peerLine.includes('no remote') || peerLine.includes('unavailable') || peerLine.includes('never'),
      `got: ${peerLine}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run to verify tests fail**

```
node --test tests/wyren-status.test.mjs
```

Expected: FAIL — `wyrenStatus` not exported, or `Peer pushed:` line absent.

- [ ] **Step 3: Implement `Peer pushed:` in `wyrenStatus`**

In `bin/wyren.mjs`, `wyrenStatus()` already uses `spawnSync` for the remote URL check (around line 138). Add the peer-push query right after the `Remote:` block (before the lock check). Insert this block:

```js
  // Peer pushed: last remote commit touching memory.md
  {
    let peerLine = '(unavailable)';
    try {
      const branchR = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: targetDir, encoding: 'utf8', windowsHide: true, timeout: 2_000,
      });
      const branch = (branchR.stdout || '').trim();
      if (branchR.status === 0 && branch) {
        const logR = spawnSync(
          'git', ['log', `origin/${branch}`, '-n1', '--format=%ci%x09%an', '--', '.wyren/memory.md'],
          { cwd: targetDir, encoding: 'utf8', windowsHide: true, timeout: 3_000 }
        );
        if (logR.status === 0) {
          const out = (logR.stdout || '').trim();
          if (out) {
            const [ts, author] = out.split('\t');
            const ago = ts ? Math.round((Date.now() - new Date(ts).getTime()) / 60_000) : null;
            peerLine = ago !== null
              ? `${new Date(ts).toISOString()} (${author || 'unknown'}, ${ago} min ago)`
              : out;
          } else {
            peerLine = '(never)';
          }
        } else {
          peerLine = '(no remote)';
        }
      }
    } catch {}
    console.log(`${label('Peer pushed:')} ${peerLine}`);
  }
```

Also export `wyrenStatus` if not already exported — add `export` keyword: `export function wyrenStatus(targetDir) {`

- [ ] **Step 4: Run tests to verify they pass**

```
node --test tests/wyren-status.test.mjs
```

Expected: 2 pass.

- [ ] **Step 5: Commit**

```
git add bin/wyren.mjs tests/wyren-status.test.mjs
git commit -m "feat(status): add Peer pushed timestamp from remote git log"
```

---

### Task 2: Post-distill nag when `--push` omitted

**Files:**
- Modify: `bin/wyren.mjs` (wyrenDistill, around line 217)

No new test file — the nag is a 2-line conditional; covered implicitly by e2e.

- [ ] **Step 1: Add nag after distiller exits**

In `wyrenDistill()`, the distiller runs at line 217:
```js
const result = spawnSync('node', args, { stdio: 'inherit' });
```

The `--push` block runs if `flags.push && result.status === 0 && !flags.dryRun`. Add the nag **before** that block, triggered when push was NOT requested and distill succeeded:

```js
  if (!flags.push && !flags.dryRun && result.status === 0) {
    console.log('Memory updated locally. Run: wyren distill --push');
  }
```

Insert this 3-line block between line 217 (`const result = spawnSync(...)`) and line 219 (`if (flags.push && ...)`).

- [ ] **Step 2: Manual smoke test**

```
node bin/wyren.mjs distill --transcript <any-jsonl> --dry-run
```

Expected: nag line does NOT appear (dry-run suppresses it). Then test without `--dry-run` but also without `--push`: nag should appear after distiller output.

- [ ] **Step 3: Commit**

```
git add bin/wyren.mjs
git commit -m "feat(distill): nag when --push omitted after successful distill"
```

---

### Task 3: UPS force-push detection

**Files:**
- Modify: `hooks/user-prompt-submit.mjs`
- Modify: `tests/user-prompt-submit.test.mjs`

- [ ] **Step 1: Write failing tests for `mergeForcePushWarning`**

Append to `tests/user-prompt-submit.test.mjs`:

```js
import { mergeForcePushWarning } from '../hooks/user-prompt-submit.mjs';

test('mergeForcePushWarning: null warning → result unchanged', () => {
  const result = { delta: 'some delta', newUpsState: { a: 1 }, newSnapshot: null };
  const out = mergeForcePushWarning(result, null);
  assert.deepEqual(out, result);
});

test('mergeForcePushWarning: warning + delta result → warning prepended', () => {
  const result = { delta: 'existing delta', newUpsState: { a: 1 }, newSnapshot: 'snap' };
  const out = mergeForcePushWarning(result, 'WARN');
  assert.ok(out.delta.startsWith('WARN'));
  assert.ok(out.delta.includes('existing delta'));
  assert.deepEqual(out.newUpsState, { a: 1 });
  assert.equal(out.newSnapshot, 'snap');
});

test('mergeForcePushWarning: warning + result with null delta → warning becomes delta', () => {
  const result = { delta: null, newUpsState: { b: 2 }, newSnapshot: 'snap' };
  const out = mergeForcePushWarning(result, 'WARN');
  assert.equal(out.delta, 'WARN');
  assert.deepEqual(out.newUpsState, { b: 2 });
  assert.equal(out.newSnapshot, 'snap');
});
```

- [ ] **Step 2: Run to verify they fail**

```
node --test tests/user-prompt-submit.test.mjs
```

Expected: FAIL — `mergeForcePushWarning` not exported.

- [ ] **Step 3: Add `spawnSync` import + helpers to UPS**

In `hooks/user-prompt-submit.mjs`, add to the imports at the top:

```js
import { spawnSync } from 'node:child_process';
```

Then add these two exported functions after the `SNAPSHOT_FILE` / `UPS_STATE_FILE` constants:

```js
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

/** Runs a git command, returns stdout string or null on any failure. */
function tryGit(args, cwd, timeout = 1_000) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', timeout, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || '').trim() || null;
}
```

- [ ] **Step 4: Add ancestry check in `main()`**

In `main()`, after the `pull()` try/catch block and before `buildInjection()` is called, insert:

```js
    // Force-push detection: verify remote memory.md commit ancestry
    let forcePushWarning = null;
    let currentRemoteSha = null;
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
          // Verify ancestry: exits 0 if lastSha is ancestor of currentRemoteSha
          const r = spawnSync('git', ['merge-base', '--is-ancestor', lastSha, currentRemoteSha], {
            cwd, timeout: 1_000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          });
          if (!r.error && r.status === 1) {
            // status 1 = not-ancestor = force-push
            forcePushWarning =
              '⚠️ Wyren: remote memory.md was force-pushed (non-linear history). ' +
              'Treat injected context with extra caution.';
            appendLog(cwd, `force-push detected: last=${lastSha} current=${currentRemoteSha}`);
          }
        }
      }
    } catch (e) {
      appendLog(cwd, `force-push check error: ${e.message}`);
      // Fail-open: proceed without warning
    }
```

- [ ] **Step 5: Wire force-push check and SHA persistence into `main()`**

Replace the existing block from `const result = buildInjection(...)` through `writeUpsStateAtomic(upsStatePath, newUpsState)` with the following. Key changes:
- null `result` with an active `forcePushWarning` emits warning then exits (reads current upsState to preserve existing fields — avoids wiping `last_injected_mtime` etc.)
- non-null `result` passes through `mergeForcePushWarning`
- `last_remote_memory_commit` merged into state before write

```js
    const result = buildInjection({ cwd, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    // Null result means nothing new to inject. If a force-push was detected, still
    // emit the warning and update the SHA — but read current state first to avoid
    // overwriting existing fields (last_injected_mtime, last_injected_hash, etc.).
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
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: delta,
        },
      }) + '\n');
    }

    if (newSnapshot !== null) {
      writeMemoryAtomic(snapshotPath, newSnapshot);
    }
    const stateToWrite = currentRemoteSha
      ? { ...newUpsState, last_remote_memory_commit: currentRemoteSha }
      : newUpsState;
    writeUpsStateAtomic(upsStatePath, stateToWrite);

    if (delta) markInjection(cwd, 'user-prompt-submit');
```

- [ ] **Step 6: Run tests**

```
node --test tests/user-prompt-submit.test.mjs
```

Expected: all existing tests pass + 4 new `mergeForcePushWarning` tests pass.

- [ ] **Step 7: Run full test suite**

```
npm test
```

Expected: 178 pass (174 existing + 4 new), 2 skip, 0 fail.

- [ ] **Step 8: Commit**

```
git add hooks/user-prompt-submit.mjs tests/user-prompt-submit.test.mjs
git commit -m "feat(ups): detect force-push via ancestry check, warn+inject on violation"
```

---

### Task 4: Run full suite + clean up

- [ ] **Step 1: Run all tests**

```
npm test
```

Expected: all new tests pass, existing 174 still pass, 2 skip. (174 + 3 mergeForcePushWarning + 2 status = 179 pass)

- [ ] **Step 2: Run e2e**

```
npm run test:e2e
```

Expected: 32 pass.

- [ ] **Step 3: Verify `wyren status` output manually**

In the wyren repo dir:
```
node bin/wyren.mjs status
```

Expected: `Peer pushed:` line appears, shows either a timestamp or `(no remote)` / `(never)`.

- [ ] **Step 4: Commit plan**

```
git add docs/superpowers/plans/2026-05-09-sync-integrity.md
git commit -m "docs: add sync-integrity implementation plan"
```
