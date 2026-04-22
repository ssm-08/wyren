---
title: Chunk 4 — Git sync layer
description: Hours 22-32. Cross-machine sync. Alice's decisions reach Bob's laptop.
---

## Goal

Make the single-machine loop from Chunk 3 work across teammates. Git becomes the sync medium. `RelaySync` interface lets a future cloud backend slot in without touching hooks.

## Files

| File | Purpose |
|---|---|
| `lib/sync.mjs` | `RelaySync` interface + `GitSync` implementation |
| `hooks/session-start.mjs` | Add `sync.pull()` before reading memory |
| `distiller.mjs` | Add `sync.push()` after writing memory |
| `bin/relay` | Add `relay status`, `relay distill` commands |

## RelaySync interface

```js
export class RelaySync {
  async pull() {}            // bring .relay/ up-to-date; idempotent
  async push() {}            // commit+push .relay/ changes only
  async lock() {}            // advisory lock; returns release fn
}

export class GitSync extends RelaySync {
  constructor(cwd) { super(); this.cwd = cwd; }
  // real impl
}
```

Later a `CloudSync extends RelaySync` slots in — zero hook changes.

## GitSync.pull()

```js
async pull() {
  // git fetch --quiet
  // git checkout -- .relay/  (discard any local scratch in .relay)
  // git pull --rebase --quiet -- .relay/
  // Timeout 3s. On failure: log + continue (best-effort).
}
```

Scoped to `.relay/` so we never trigger merges in the user's working code.

## GitSync.push()

```js
async push() {
  // git add .relay/memory.md .relay/broadcast/
  // if nothing staged → return
  // git commit -m "[relay] memory update (session <short-id>)"
  // for attempt in 0..2:
  //   if git push origin HEAD:<branch> succeeds → return
  //   git pull --rebase     (if conflict → re-distill against new base)
  // On final failure: log, leave commit local.
}
```

## GitSync.lock()

```js
async lock() {
  // atomic create .relay/state/.lock
  // if exists AND mtime < 60s ago → wait-then-retry
  // if exists AND mtime > 60s → stale, steal
  // return () => fs.unlinkSync(lockPath)
}
```

## Hook integration

session-start.mjs:

```js
import { GitSync } from '../lib/sync.mjs';
const sync = new GitSync(cwd);
await sync.pull();    // timeboxed, non-throwing
// ... rest of session-start (read memory, emit context)
```

distiller.mjs:

```js
// after writing memory.md atomically
const release = await sync.lock();
try {
  await sync.push();
} finally {
  release();
}
```

## Race handling

Two teammates distill within the same second. Strategy:

1. **Path-scoped push** — only `.relay/*` touched. Main code never pushed by the hook.
2. **Retry-on-conflict** — if push fails non-fast-forward, pull-rebase. If memory.md conflicts on same lines, `git checkout --theirs .relay/memory.md` and re-distill locally. Ship the later one.
3. **Advisory lock** — per-machine. Cross-machine coordination via git rebase.

For 2-10 person teams: sufficient. Beyond that → CloudSync.

## CLI additions

```bash
relay status          # memory size, last distill time, watermark age, git sync state
relay distill --force # manual distill trigger for debugging
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
- Git log of `.relay/memory.md` is clean-linear in default workflow.
- Memory doesn't grow unbounded under multi-machine merges (hygiene survives).
- `relay status` command provides clear debug info.
