# Chunk 4 — Git Sync Layer Design

**Date:** 2026-04-22  
**Chunk:** 4 of 5 (Hours 22–32)  
**Goal:** Cross-machine sync. Alice's decisions appear in Bob's session on another laptop.

---

## Files Changed

| File | Change |
|---|---|
| `lib/sync.mjs` | New — `GitSync` class |
| `hooks/session-start.mjs` | Add `sync.pull()` before `buildContext()` |
| `distiller.mjs` | Add `sync.push()` after `writeMemoryAtomic()` |
| `bin/relay.mjs` | Add `relay status` and `relay distill` commands |
| `tests/sync.test.mjs` | New — unit tests for `GitSync` |

---

## Architecture

`lib/sync.mjs` exports a single class `GitSync` with three methods. No formal `RelaySync` base class — the interface is a comment convention only (YAGNI for MVP). Swapping in a cloud backend later means replacing `GitSync` with a new class; the call sites in session-start and distiller are unchanged.

All git operations use `child_process.execSync` / `exec` (shell commands). Zero new dependencies. Timeout enforced via `AbortController` on async paths.

---

## `lib/sync.mjs` — GitSync

### `pull(cwd)`

```
git fetch --quiet
git pull --rebase --quiet -- .relay/
```

- Timeout: 3000ms hard cap.
- On any error (network, no remote, timeout): log to `.relay/log`, return. Fail-open — session starts with cached memory.
- Does NOT `git checkout -- .relay/` before pull (that would destroy uncommitted distiller writes). Rebase handles divergence cleanly.

### `push(cwd, sessionId)`

```
git add .relay/memory.md .relay/broadcast/
git diff --cached --quiet .relay/ → early return (nothing staged)
git commit -m "[relay] memory update (session <id>)"
retry up to 3:
  git push origin HEAD
  on push fail:
    git fetch + git rebase FETCH_HEAD
    on rebase conflict:
      git rebase --abort
      git reset --mixed FETCH_HEAD     (advance HEAD to remote; no working tree changes outside .relay/)
      git checkout FETCH_HEAD -- .relay/memory.md
      reset watermark: turns_since_distill=0 → next Stop hook re-triggers distiller
      return (stop retrying — repo is clean, next distillation merges local transcript into remote memory)
    retry push
on all retries exhausted: log "push failed, leaving commit local", return
```

- Conflict resolution: `--theirs` (remote wins for this cycle). Local session's changes will be re-distilled on next trigger — no data lost, just delayed one cycle.
- No remote configured: `git push` exits non-zero → log + return. Plugin runs local-only silently.

### `lock(cwd)` → `release` fn

```
lockPath = .relay/state/.lock
if lockPath exists:
  age = Date.now() - mtime
  if age < 60_000: throw Error('LOCKED')   ← caller should skip or retry
  // else: stale lock, steal it
write lockPath (ISO timestamp content)
return () => fs.rmSync(lockPath, { force: true })
```

- Lock is local filesystem only — not git-tracked. Prevents two concurrent distillers on the same machine from double-pushing.
- `distiller.mjs` acquires lock before push, releases in finally block.

---

## Hook Integration

### `hooks/session-start.mjs`

At top of `main()`, before `buildContext()`:

```js
import { GitSync } from '../lib/sync.mjs';
const sync = new GitSync();
try {
  await sync.pull(cwd);
} catch {
  // fail-open: log written inside pull()
}
```

Hard cap: if pull takes > 3s, `AbortController` cancels and session proceeds with cached memory. SessionStart must stay under 500ms in the happy path (local repo with fast remote). 3s is the outer bound for slow/offline.

### `distiller.mjs`

After `writeMemoryAtomic(outPath, cleaned)` and watermark update:

```js
import { GitSync } from './lib/sync.mjs';
const sync = new GitSync();
const release = await sync.lock(cwd);
try {
  await sync.push(cwd, sessionId);
} catch (e) {
  // log, swallow — watermark already updated
} finally {
  release();
}
```

Lock is acquired before push. If lock contention (another distiller running), skip push silently; the other distiller will push. Next cycle will catch up.

---

## `bin/relay.mjs` — New Commands

### `relay status`

Reads local state and prints:

```
Relay status — /path/to/repo

Memory:   .relay/memory.md  (1.2 KB, 34 lines)
Last distill: 2026-04-22T14:33:01Z  (12 min ago)
Last UUID:    abc12345
Watermark:    turns_since_distill=2, distiller_running=false

Git remote: origin → https://github.com/ssm-08/relay
Lock:       not held
```

If `.relay/` does not exist: `relay not initialized in this repo. Run: relay init`

### `relay distill`

Triggers distillation synchronously by spawning `distiller.mjs` as a child process (not detached — waits for exit). Requires `--transcript <path>` flag, or reads `last_transcript` from `watermark.json` if stored there.

To enable auto-resolution: distiller.mjs now writes `last_transcript` (the transcript path) to watermark.json on each run. `relay distill` with no flags uses that path.

Useful for:
- Demo debugging
- Forcing a sync after manual memory edit
- Testing the distiller without waiting for turn threshold

Flags:
- `--force` — bypass Tier 0 filter (pass `--force` through to distiller)
- `--dry-run` — print prompt, don't call claude
- `--transcript <path>` — override transcript source (required if watermark has no `last_transcript`)
- `--push` — also call `sync.push()` after distilling (default: off for manual runs)

**Watermark addition:** `distiller.mjs` writes `last_transcript: transcriptPath` to watermark.json alongside `last_uuid`, enabling `relay distill` and `relay status` to surface the active transcript path.

---

## Data Flow (Updated)

```
Session start:
  GitSync.pull() [3s timeout, fail-open]
  → read memory.md
  → additionalContext

Each turn:
  Stop hook → watermark++ → (threshold) → spawnDistiller()

Distiller (detached):
  Tier 0 filter
  → claude -p [haiku]
  → writeMemoryAtomic()
  → watermark update
  → GitSync.lock() → GitSync.push() → release lock
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| No git remote | `push()` logs "no remote", returns. Plugin silent. |
| Network timeout on pull | Pull aborted at 3s, session proceeds with cached memory. |
| Lock contention | `push()` skipped this cycle. Next distillation retries. |
| Rebase conflict (3 retries) | Local commit left unpushed. Next session pull will try again. |
| `distiller.mjs` crash | finally block releases lock. Watermark already clear. |

---

## Testing (`tests/sync.test.mjs`)

All tests use `tmp` dirs with a local bare git repo (`git init --bare`) as the remote. No network calls.

| Test | Verifies |
|---|---|
| `pull()` — clean repo | No-op, returns without error |
| `pull()` — remote has new memory | Local memory.md updated after pull |
| `push()` — new memory commit | Commit appears in bare remote |
| `push()` — nothing staged | Returns early, no commit created |
| `push()` — conflict → theirs | Remote version wins, local commit abandoned, turns reset |
| `push()` — no remote | Logs error, does not throw |
| `lock()` — creates + releases | `.lock` file appears then disappears |
| `lock()` — stale steal | Lock older than 60s is overwritten |
| `lock()` — fresh contention | Throws `LOCKED` |

---

## Exit Criteria (from plan)

- Two-machine warm-start demo works reliably over 5 trials.
- Git log of `.relay/memory.md` is clean-linear on default workflow.
- Memory hygiene survives multi-machine merges (no unbounded growth).
