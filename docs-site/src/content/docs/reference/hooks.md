---
title: Hook contracts
description: SessionStart and Stop hook payloads, responses, and expected behavior.
---

Wyren uses three Claude Code hooks. Contracts are pinned here so they can be mocked for tests and understood independently from the implementation.

## SessionStart

Fires once per Claude Code session (startup, resume, clear, or compact).

### Input (stdin JSON)

```json
{
  "session_id": "7a2e-…",
  "transcript_path": "/Users/alice/.claude/projects/<encoded>/7a2e-….jsonl",
  "cwd": "/Users/alice/repo",
  "permission_mode": "default",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

| Field | Type | Notes |
|---|---|---|
| `session_id` | uuid v4 | Stable for the session |
| `transcript_path` | abs path | Use this, don't reconstruct |
| `cwd` | abs path | Repo root (or wherever Claude Code was invoked) |
| `source` | enum | `startup` \| `resume` \| `clear` \| `compact` |

### Output (stdout JSON)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "# Wyren Memory\n\n## Decisions\n..."
  }
}
```

`additionalContext` is ingested as **hidden system context** — Claude sees it, user does not.

### Timing

- Target: under 500ms.
- Main cost: the scoped `git fetch` + `checkout` of `.wyren/memory.md` and `.wyren/broadcast/` during `GitSync.pull()`. Internal timeouts cap fetch at **1.5s** and checkout at **0.5s**; hook-level budget is **4s** total, providing a 2s buffer for Node startup and file I/O.
- Fail-open — individual git commands time out on their own, then fail-open.
- On slow or offline networks, set `WYREN_SKIP_PULL=1` to short-circuit the pull entirely. Memory still injects from whatever is on disk.

### Failure mode

`process.exit(0)` on any error. Never block session init. Log to `.wyren/log`.

## Stop

Fires after every assistant turn.

### Input (stdin JSON)

```json
{
  "session_id": "7a2e-…",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "Stop"
}
```

Same shape as SessionStart minus `source`.

### Output

None required. Hook emits no JSON unless it wants to block the turn (Wyren never does).

### Behavior

1. Increment `turns_since_distill` in `.wyren/state/watermark.json`.
2. If threshold reached (default 5 turns, override with `WYREN_TURNS_THRESHOLD`) AND `distiller_running` is false (or its PID is no longer alive):
   - Spawn `distiller.mjs` **detached** (`spawn(..., { detached: true })` + `proc.unref()`).
   - Set `distiller_running = true` + `distiller_pid = <pid>` in watermark.
   - Return immediately.
3. Never block the turn. Distiller runs in background.

### Failure mode

`process.exit(0)`. Next Stop will try again.

## UserPromptSubmit

Fires before each user message is sent to the model — the live sync hook.

### Input (stdin JSON)

```json
{
  "session_id": "7a2e-…",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "UserPromptSubmit"
}
```

### Output (stdout JSON)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "# Wyren live update\n\n## New section from teammate\n..."
  }
}
```

Only emitted when the diff detects new content. If nothing changed, the hook exits silently with no output.

### Behavior

1. Pull `.wyren/memory.md` from the remote (1.5s fetch cap, 3s hook budget). Skipped when `WYREN_SKIP_PULL=1`; diff still runs from disk.
1b. If the pull succeeded, compare the last-known remote commit SHA for `.wyren/memory.md` (stored in `ups-state.json`) against the current remote SHA. If the current commit is not a descendant of the last-known commit (non-linear history), set a ⚠️ force-push warning that will be prepended to any injected delta. This protects against a teammate accidentally force-pushing a rewrite of memory.
2. Compare the current file against the stored snapshot hash in `.wyren/state/ups-state.json`.
3. If content has changed, compute a section-aware delta (new or modified sections only).
4. Inject the delta as `additionalContext` so the model receives it before processing the user's prompt.
5. Update the snapshot and pull timestamp in `ups-state.json`.

### State files

| File | Owner | Purpose |
|---|---|---|
| `.wyren/state/ups-state.json` | UserPromptSubmit hook (exclusively) | Snapshot hash + last-pull timestamp |
| `.wyren/state/last-injected-memory.md` | UserPromptSubmit hook | Full text of the last memory snapshot used for diffing |

`ups-state.json` is owned exclusively by this hook — the Stop hook does not touch it. This avoids the watermark race that was found and fixed during fault injection testing.

### Timing

- Target: under 200ms on cache hits (local disk diff only).
- Pull adds ~300ms–1.5s depending on network; fetch capped at **1.5s**, hook budget **3s** total.
- Set `WYREN_SKIP_PULL=1` to skip the network call entirely (e.g., when working offline or in a flaky-network environment).

### Failure mode

`process.exit(0)` on any error. Hook is fail-open — a pull timeout or missing state file never blocks the user's prompt.

## Why not Stop for injection?

`Stop` can emit `additionalContext` too, but that would inject into Claude's context **after** the user has already typed their first prompt. Too late — prompt has already been constructed. `SessionStart` is the only surface that injects **before** the first user prompt is constructed.

## What about SessionEnd?

Claude Code has no `SessionEnd` hook, and Wyren doesn't try to fake one. The tradeoff: if a session closes with pending turns that weren't distilled yet, those turns stay in the transcript but don't reach `memory.md` until the **next** session on that machine fires `Stop` and the distiller catches them via the watermark.

For explicit end-of-session handoffs, use `/wyren-handoff` — a manual push that bypasses the distiller and lands a human-authored note in `memory.md` immediately.

## Full hook reference

For the complete Claude Code hooks API, see the [official docs](https://code.claude.com/docs/en/hooks).
