---
title: Chunk 3 — Distiller wired into Stop hook
description: Hours 14-22. Real-time distillation. Memory updates live. Still single-machine.
---

## Goal

Hook up the Chunk 1 distiller to the Chunk 2 plugin skeleton. The `Stop` hook debounces turns, spawns the distiller detached. Memory updates live during a session. Still single-machine — git sync is Chunk 4.

## Files

| File | Purpose |
|---|---|
| `hooks/stop.mjs` | Real implementation (watermark + detached spawn) |
| `distiller.mjs` | Now reads hook context (cwd, transcript_path, session_id) |
| `lib/transcript.mjs` | Used by distiller for slicing |

## stop.mjs

```js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const input = JSON.parse(await readAllStdin());
const { cwd, session_id, transcript_path } = input;

const relayDir = path.join(cwd, '.relay');
if (!fs.existsSync(relayDir)) process.exit(0);

const statePath = path.join(relayDir, 'state', 'watermark.json');
fs.mkdirSync(path.dirname(statePath), { recursive: true });

let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

state.turns_since_distill = (state.turns_since_distill ?? 0) + 1;
state.last_turn_at = Date.now();

const SHOULD_DISTILL = state.turns_since_distill >= 5;

if (SHOULD_DISTILL && !state.distiller_running) {
  state.distiller_running = true;
  state.turns_since_distill = 0;
  fs.writeFileSync(statePath, JSON.stringify(state));

  const proc = spawn('node', [
    path.join(process.env.CLAUDE_PLUGIN_ROOT, 'distiller.mjs'),
    '--cwd', cwd,
    '--transcript', transcript_path,
    '--session', session_id,
  ], {
    detached: true,
    stdio: ['ignore',
      fs.openSync(path.join(relayDir, 'log'), 'a'),
      fs.openSync(path.join(relayDir, 'log'), 'a')],
  });
  proc.unref();
} else {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
```

Key properties:
- **Never blocks the turn.** Distiller is spawned detached.
- **Debounced.** Only triggers every 5 turns.
- **Lock-guarded.** `distiller_running` flag prevents concurrent runs.

## distiller.mjs (real mode)

1. Parse args (`--cwd`, `--transcript`, `--session`).
2. **Tier 0 filter** — regex scan transcript slice for signal words; skip if none.
3. Load current `memory.md`.
4. Load watermark → last processed turn UUID.
5. `lib/transcript.mjs` reads JSONL, slices since watermark.
6. Shell out to `claude -p` with distill prompt.
7. Atomic write new `memory.md`.
8. Update watermark with new last-UUID.
9. Clear `distiller_running` flag.

On error: log to `.relay/log`, clear flag, no retry. Next Stop trigger tries again.

## lib/transcript.mjs

```js
export function* readTranscriptLines(path) {
  // stream JSONL line-by-line using readline
}

export function sliceSinceUuid(lines, watermarkUuid) {
  // return messages after the line matching watermarkUuid
  // handle empty watermark (first run) → return all
}

export function renderForDistiller(messages) {
  // compact prose transcript:
  //   [turn N, user]: <text>
  //   [turn N+1, assistant]: <text>  (tool calls summarized)
  // truncate huge tool_use results
}
```

## Tier 0 filter (mandatory in this chunk)

Before spawning the API call, regex scan the slice:

```js
const SIGNAL_REGEX = /\b(decide|decided|won'?t|doesn'?t work|workaround|hack|TODO|FIXME|rejected|tried|instead|actually|broken|skip|stub|hardcod|mock|placeholder|out of scope|for now|revisit|later)\b/i;

if (!SIGNAL_REGEX.test(renderedSlice)) {
  // update watermark and exit early — no API call
  updateWatermark(lastUuid);
  return;
}
```

See [Cost model](/cost-model/) for the full tiering strategy.

## Verification

1. Open Claude Code in test repo (already initialized from Chunk 2).
2. Have a 10-turn conversation: pick X, reject Y, install workaround Z.
3. Watch `.relay/memory.md` update after turn 5 (~15s delay acceptable).
4. Exit session, open new one. First assistant reply names X, Y, Z correctly.

## Exit criteria

- Distiller triggers automatically, **never blocks a turn**.
- Memory updates visibly during a live session.
- Single-machine warm-start test passes reliably.
- Tier 0 filter demonstrably skips no-signal slices (check `.relay/log`).
