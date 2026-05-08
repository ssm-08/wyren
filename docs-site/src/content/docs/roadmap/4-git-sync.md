---
title: Chunk 4 — Git sync layer
description: Hours 22-32. Cross-machine sync. Alice's decisions reach Bob's laptop. ✅ Shipped.
---

## Status: ✅ Shipped

38 unit tests green. Two-machine warm-start verified locally. Conflict scenario tested: remote wins, local HEAD advances, second push succeeds.

## Goal

Make the single-machine loop from Chunk 3 work across teammates. Git becomes the sync medium. `WyrenSync` interface lets a future cloud backend slot in without touching hooks.

## Files

| File | Purpose |
|---|---|
| `lib/sync.mjs` | `WyrenSync` interface + `GitSync` implementation |
| `hooks/session-start.mjs` | Add `sync.pull()` before reading memory |
| `distiller.mjs` | Add `sync.push()` after writing memory |
| `bin/wyren` | Add `wyren status`, `wyren distill` commands |

## WyrenSync interface

```js
export class WyrenSync {
  async pull() {}            // bring .wyren/ up-to-date; idempotent
  async push() {}            // commit+push .wyren/ changes only
  async lock() {}            // advisory lock; returns release fn
}

export class GitSync extends WyrenSync {
  constructor(cwd) { super(); this.cwd = cwd; }
  // real impl
}
```

Later a `CloudSync extends WyrenSync` slots in — zero hook changes.

## GitSync.pull()

```js
pull(cwd) {
  if (process.env.WYREN_SKIP_PULL) return;   // escape hatch for local/demo
  // short-circuit if no remote configured
  // git fetch --quiet  (3s timeout, fail-open)
  // git checkout origin/<branch> -- .wyren/memory.md
  // git checkout origin/<branch> -- .wyren/broadcast
}
```

Scoped checkout — never rebases or touches the user's working code. `.wyren/state/` is gitignored and machine-local; never pulled.

## GitSync.push()

```js
push(cwd, sessionId) {
  // git add .wyren/memory.md .wyren/broadcast
  // if nothing staged → return
  // git commit -m "[wyren] memory update (session <short-id>)"
  // for attempt in 0..2:
  //   git push origin HEAD → success: return
  //   on fail: git fetch + git rebase FETCH_HEAD
  //     on conflict: rebase --abort + reset --mixed FETCH_HEAD
  //                  git checkout FETCH_HEAD -- .wyren/memory.md
  //                  reset turns → re-distill next cycle; return
  // on 3 failures: log + leave commit local
}
```

Conflict strategy: `reset --mixed FETCH_HEAD` advances local HEAD to remote tip without touching the working tree outside `.wyren/`. Safer than `--theirs + rebase --continue` on Windows (no GIT_EDITOR needed). Local session changes re-distill on next trigger.

## GitSync.lock()

```js
lock(cwd) {
  // openSync(lockPath, 'wx')  ← atomic; EEXIST if held
  // if EEXIST + mtime < 60s → throw LOCKED
  // if EEXIST + mtime > 60s → steal (stale)
  // return release fn → rmSync
}
```

## Hook integration

session-start.mjs:

```js
import { GitSync } from '../lib/sync.mjs';
if (fs.existsSync(wyrenDir)) {
  try { new GitSync().pull(cwd); } catch {}
}
// ... buildContext, emit additionalContext
```

distiller.mjs:

```js
// after writeMemoryAtomic + watermark update
const sync = new GitSync();
const release = sync.lock(cwd);   // throws LOCKED if concurrent distiller
try { sync.push(cwd, sessionId); } finally { release(); }
```

## Race handling

1. **Path-scoped push** — only `.wyren/*` staged/committed. Main code untouched.
2. **Retry-on-conflict** — fetch + rebase FETCH_HEAD; on conflict abort + reset --mixed.
3. **Advisory lock** — `openSync('wx')` atomic; 60s stale-steal. Cross-machine via git.

For 2-10 person teams: sufficient. Beyond that → `CloudSync extends WyrenSync`.

## CLI additions

```bash
wyren status          # memory size, last distill time, watermark age, git sync state
wyren distill --force # manual distill trigger for debugging
```

## Verification

1. Two laptops, same repo, same git remote.
2. A runs session, makes a decision, exits. Memory pushed.
3. B starts fresh session. Memory pulled. **B's first message names A's decision.**
4. B makes a different decision. Memory updated, pushed.
5. A opens new session. Names both decisions.
6. **Stress test:** both laptops running simultaneously for 10 minutes. Inspect `git log`. Expect zero merge commits, all linear.

## Exit criteria

- Two-machine warm-start demo works reliably over **5 consecutive trials**.
- Git log of `.wyren/memory.md` is clean-linear in default workflow.
- Memory doesn't grow unbounded under multi-machine merges (hygiene survives).
- `wyren status` command provides clear debug info.
