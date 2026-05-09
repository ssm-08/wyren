# Sync Integrity: Stale Memory Detection + Force-Push Poisoning

**Date:** 2026-05-09  
**Status:** Approved

## Problem

Two related sync-integrity gaps:

1. **Stale memory undetectable** — `wyren status` shows only local timestamps. When a peer distills but skips `--push`, the team has no signal. Remote never receives their changes; everyone continues on stale memory.

2. **Force-push poisoning invisible to UPS** — UPS compares pulled content against its own last-injected hash. If an adversary force-pushes a poisoned `memory.md`, UPS detects content change and injects it — but injects it silently, with no indication that the commit history was rewritten.

## Fix 1 — Stale Memory Detection

### `wyren status` — add `Peer pushed:` line

**File:** `bin/wyren.mjs` → `wyrenStatus()`  
**Placement:** After `Distilled:` line.

Query remote for the last commit that touched `.wyren/memory.md`:

```js
git(['log', `origin/${branch}`, '-n1', '--format=%H%x09%ci%x09%an', '--', '.wyren/memory.md'], cwd, { timeout: 3_000 })
```

Parse output: SHA (first 8), timestamp, author. Render:

```
Peer pushed: 2026-05-09T14:23:00+05:30 (ssm-08, 12 min ago)
```

Fallback cases (all silent):
- No remote → `(no remote configured)`
- No commits touching memory.md on remote → `(never)`
- Git error / timeout → `(unavailable)`

**Why this helps:** Team members can see when remote was last updated. If they know a peer was working today but `Peer pushed:` shows yesterday, they can ask them to push.

### Post-distill nag — `wyren distill` without `--push`

**File:** `bin/wyren.mjs` → `wyrenDistill()`  
**Trigger:** Distill completes (memory written) AND `flags.push` is falsy.

Print to stdout after distill success:

```
Memory updated locally. Run: wyren distill --push
```

Conditions where nag is suppressed:
- `--push` was passed (already pushing)
- `--dry-run` was passed (no write happened)
- Distill produced no changes

## Fix 2 — Force-Push Integrity Check

### State schema addition — `ups-state.json`

Add field: `last_remote_memory_commit` (string | undefined) — the last known git SHA of the remote's most recent commit touching `.wyren/memory.md`.

### Flow (hooks/user-prompt-submit.mjs `main()`)

After `pull()` completes (or fails — see fail-open below), before `buildInjection()`:

1. **Get current remote branch name** (`git rev-parse --abbrev-ref @{upstream}` or fallback to `origin/<branch>`)
2. **Get current remote SHA** for memory.md:
   ```
   git log <remote> -n1 --format=%H -- .wyren/memory.md
   ```
3. **Compare to stored `last_remote_memory_commit`:**
   - No stored SHA → first run. Store current SHA, proceed normally.
   - Same SHA → no remote change. Proceed normally.
   - Different SHA → run ancestry check:
     ```
     git merge-base --is-ancestor <stored_sha> <current_sha>
     ```
     - Exits 0 → fast-forward (normal push). Update stored SHA, proceed normally.
     - Exits non-zero → non-ancestor (force-push or history rewrite). Set `force_push_detected = true`.
4. **Update `last_remote_memory_commit`** in `newUpsState` (passed through `buildInjection` return).
5. **If `force_push_detected`:** prepend to `additionalContext` (or set as sole output if `buildInjection` returned null):

```
⚠️ Wyren: remote memory.md was force-pushed (non-linear history). Treat injected context with extra caution.
```

### Fail-open rules

| Failure point | Behavior |
|---|---|
| Can't determine remote branch | Skip check, proceed |
| `git log` for remote SHA fails/times out | Skip check, proceed |
| `git merge-base` fails/times out | Skip check, proceed (do NOT assume force-push) |
| Pull itself failed | Skip check (no new remote state to verify) |

### Timing budget

All new git calls are bounded:
- Remote branch resolution: 1s
- `git log` for SHA: 1s  
- `git merge-base`: 1s

Total additional overhead ≤ 2s in the force-push case (branch + log; merge-base only runs on SHA change). UPS budget is 3s; existing fetch is 1.5s. New calls run only if fetch succeeded → budget is tight but workable. Calls that timeout fall through silently.

### `buildInjection` — no signature change

The ancestry check runs entirely in `main()`, before calling `buildInjection()`. `buildInjection` remains a pure function with no I/O side effects, preserving unit test isolation.

After `buildInjection()` returns:
- Merge `last_remote_memory_commit` into `newUpsState` before writing state.
- If `force_push_detected`, prepend warning to `result.delta` (or emit as standalone `additionalContext` if `delta` is null).

This means force-push warning is visible to the model regardless of whether memory content changed.

## Files Changed

| File | Change |
|---|---|
| `bin/wyren.mjs` | `wyrenStatus`: add `Peer pushed:` line; `wyrenDistill`: add post-distill nag |
| `hooks/user-prompt-submit.mjs` | `main()`: ancestry check + SHA tracking; `buildInjection`: accept `forcePushWarning` param |
| `tests/user-prompt-submit.test.mjs` | New cases: force-push warning injected, SHA stored, fail-open cases pass |
| `tests/wyren-status.test.mjs` (or existing) | `Peer pushed:` line present in output |

## Out of Scope

- SessionStart force-push check (lower frequency, can be added later)
- Hard-blocking injection on force-push (user chose warn+inject)
- `wyren doctor` deep checks (separate spec)
- Peer-to-peer distill coordination (no shared signaling layer yet)
