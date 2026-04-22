---
title: Chunk 3 — Distiller wired into Stop hook
description: Hours 14-22. Real-time distillation. Memory updates live. Still single-machine. ✅ Shipped.
---

## Goal

Hook up the Chunk 1 distiller to the Chunk 2 plugin skeleton. The `Stop` hook debounces turns, spawns the distiller detached. Memory updates live during a session. Still single-machine — git sync is Chunk 4.

## Status: ✅ Shipped

29 unit tests green. Single-machine warm-start verified.

## Files changed

| File | Change |
|---|---|
| `hooks/stop.mjs` | Full implementation — watermark, `shouldDistill`, detached spawn |
| `distiller.mjs` | Tier 0 filter, Haiku 4.5 default, `distiller_running` cleanup |
| `lib/filter.mjs` | New — `hasTier0Signal()` extracted here for testability |
| `tests/stop.test.mjs` | 7 new tests for `shouldDistill` |
| `tests/distiller.test.mjs` | New — 5 tests for `hasTier0Signal` |

## stop.mjs

Three exported functions:

**`updateWatermark(relayDir)`** — increments `turns_since_distill`, records `last_turn_at`. Called every turn regardless of whether distillation fires.

**`shouldDistill(state)`** — returns true if:
- `turns_since_distill >= 5` (main trigger), OR
- `turns_since_distill > 0` AND `last_distilled_at` exists AND idle > 2 minutes

Returns false if `distiller_running` is true (lock guard).

**`spawnDistiller({ relayDir, transcriptPath, since, cwd })`** — spawns `distiller.mjs` detached with `--transcript`, `--memory`, `--out`, `--cwd`, `--since`. Resolves distiller path via `CLAUDE_PLUGIN_ROOT` env (set by Claude Code) or relative fallback. Logs stdout+stderr to `.relay/log`. Never uses `shell:true` — avoids argument splitting on paths with spaces.

In `main()`:

1. Read stdin → extract `{ cwd, transcript_path }`.
2. Bail if no `.relay/` directory (not a relay repo).
3. `updateWatermark(relayDir)`.
4. If `shouldDistill(state) && transcript_path`:
   - Set `distiller_running = true`, reset `turns_since_distill = 0` — **before** spawn to prevent race.
   - Call `spawnDistiller(...)`.
5. `process.exit(0)` — never blocks the turn.

## distiller.mjs changes

**Default model:** `claude-haiku-4-5-20251001` (was `claude-sonnet-4-6`). Haiku handles incremental deltas cheaply; Sonnet path still available via `--model` flag for future Tier 2 logic.

**Tier 0 filter:** called after rendering the transcript slice, before any API call:

```js
if (!hasTier0Signal(transcriptSlice)) {
  // update watermark + clear distiller_running, exit — no API call
}
```

**`writeWatermark` signature extended:** `writeWatermark(cwd, uuid, { clearRunning = false })` — the `clearRunning` option deletes `distiller_running` from the watermark. Called with `clearRunning: true` in all exit paths (Tier 0 skip, success, error) so the lock is never permanently stuck.

**Error handling:** `runClaude` + `writeMemoryAtomic` wrapped in try/catch. On error: clears lock (in its own try/catch so a failing write doesn't prevent the rethrow), then rethrows to `main().catch()` which logs to stderr.

## lib/filter.mjs

```js
const TIER0_REGEX = /\b(decide|decided|won'?t|doesn'?t work|workaround|hack|TODO|FIXME|
  rejected|tried|instead|actually|broken|skip|stub|hardcod|mock|placeholder|
  out of scope|for now|revisit|later)\b/i;

// renderForDistiller emits tool calls as: [tool_use ToolName] {...}
const TIER0_TOOL_REGEX = /\[tool_use (Edit|Write)\]/;

export function hasTier0Signal(transcriptText) {
  if (TIER0_REGEX.test(transcriptText)) return true;
  if (TIER0_TOOL_REGEX.test(transcriptText)) return true;
  return false;
}
```

**Why a separate file?** Importing `distiller.mjs` in tests would trigger `main()` (the module's entry-point guard fires on `process.argv[1]` match). Extracting the filter keeps it purely testable.

**Why `[tool_use Edit]` format?** The distiller receives *rendered* transcript text from `renderForDistiller()`, not raw JSONL. The renderer converts `tool_use` blocks to `[tool_use ToolName] {input}` prose. The raw JSONL `"tool_name":"Edit"` format never reaches the filter.

## Tier 0 in context

See [Cost model](/cost-model/) for the full tiering strategy. Tier 0 is free — regex only, no API call. Expected to kill ~70% of `Stop` triggers in a typical coding session (file reads, small fixes, questions without decisions).

## Verification

1. Open Claude Code in test repo (initialized from Chunk 2).
2. Have a 10-turn conversation: pick X, reject Y, install workaround Z.
3. Watch `.relay/memory.md` update after turn 5 (`tail -f .relay/log`).
4. Exit session, open new one. First assistant reply names X, Y, Z correctly.

## Exit criteria (all met)

- Distiller triggers automatically, **never blocks a turn** — spawned detached, hook exits 0 immediately.
- Memory updates visibly during a live session.
- Single-machine warm-start test passes.
- Tier 0 filter demonstrably skips no-signal slices (visible in `.relay/log`).
