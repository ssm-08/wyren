---
title: Hook contracts
description: SessionStart and Stop hook payloads, responses, and expected behavior.
---

Relay uses two Claude Code hooks. Contracts are pinned here so they can be mocked for tests and understood independently from the implementation.

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
    "additionalContext": "# Relay Memory\n\n## Decisions\n..."
  }
}
```

`additionalContext` is ingested as **hidden system context** — Claude sees it, user does not.

### Timing

- Target: < 500ms.
- Hard cap: 2s (fail-open — emit empty context on timeout).
- Main cost: `git pull --rebase` on `.relay/`.

### Failure mode

`process.exit(0)` on any error. Never block session init. Log to `.relay/log`.

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

None required. Hook emits no JSON unless it wants to block the turn (Relay never does).

### Behavior

1. Increment `turns_since_distill` in `.relay/state/watermark.json`.
2. If threshold reached (default 5 turns) AND `distiller_running` flag is false:
   - Set `distiller_running = true`.
   - Spawn `distiller.mjs` **detached** (`spawn(..., { detached: true })` + `proc.unref()`).
   - Return immediately.
3. Never block the turn. Distiller runs in background.

### Failure mode

`process.exit(0)`. Next Stop will try again.

## Why not Stop for injection?

`Stop` can emit `additionalContext` too, but that would inject into Claude's context **after** the user has already typed their first prompt. Too late — prompt has already been constructed. `SessionStart` is the only surface that injects **before** the first user prompt is constructed.

## Why not SessionEnd?

Claude Code has no `SessionEnd` hook. Relay fakes it by piggybacking on the **next** `SessionStart`:

1. Check watermark.
2. If the transcript has turns past the watermark that weren't distilled (session closed with pending work), run the distiller **synchronously** (up to timeout) before emitting `additionalContext`.

This ensures a departing teammate's final turns land in memory before the next reader starts.

## Full hook reference

For the complete Claude Code hooks API, see the [official docs](https://code.claude.com/docs/en/hooks).
