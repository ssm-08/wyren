---
title: Chunk 1 — Distiller quality gate
description: Hours 0-6. Highest-risk chunk. Go/no-go gate for the whole project.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="danger" title="Highest risk">
If distiller output doesn't pass the blind A/B test here, all downstream infrastructure is wasted effort. Iterate the prompt, switch model, or pivot to handoff-only — but **do not proceed** to Chunk 2 until this passes.
</Aside>

## Goal

Standalone CLI that reads a transcript + old memory, produces a new memory that passes the blind A/B bar. Zero infra, no hooks, no git.

## Files

| File | Purpose |
|---|---|
| `distiller.mjs` | Standalone CLI (not wired to any hook yet) |
| `prompts/distill.md` | The distiller system prompt — iterate on this |
| `lib/transcript.mjs` | JSONL parse + since-watermark slicer |
| `lib/memory.mjs` | Parse/serialize markdown (whole-file for this chunk) |

## CLI interface

```bash
node distiller.mjs \
    --transcript ~/.claude/projects/<proj>/<session>.jsonl \
    --memory .relay/memory.md \
    --since <uuid-or-empty> \
    --out .relay/memory.new.md
```

## Distiller prompt (first draft)

Living in `prompts/distill.md`. See the [full annotated prompt](/reference/distiller-prompt/) in the reference section.

Core rules:
1. **REPLACE superseded entries** — never stack contradictions.
2. **REMOVE resolved workarounds** — delete when transcript shows the fix.
3. **NEVER append blindly** — every entry must still be load-bearing.
4. **NO code snippets, NO conversation quotes** — conclusions only.
5. **Max 30 lines per section** — cull stale entries aggressively.
6. **Tag each entry** with `[session <id>, turn <n>]` for provenance.

Guiding question for every entry: *"Would a new Claude opening this project in 10 minutes genuinely need this, or is this noise?"*

## Claude call shape

Prefer headless Claude Code:

```bash
echo "$PROMPT

<existing-memory>
$MEMORY
</existing-memory>

<transcript-slice>
$SLICE
</transcript-slice>" | claude -p --output-format text > memory.new.md
```

Fallback: Anthropic SDK with `@anthropic-ai/sdk` (if `claude` CLI unavailable during dev).

## Verification (must pass before Chunk 2)

1. Find an existing 2+ hour session JSONL under `~/.claude/projects/`. Ideally one with real decisions + dead-ends.
2. Run distiller fresh (empty memory) on first half of transcript. Inspect output.
3. Run distiller again (previous output as memory) on second half. Inspect output.
4. **Blind test:** read only the final `memory.md`. Name any 3 concrete facts that should be there and check they appear.
5. **Hygiene test:** introduce a workaround early in transcript, resolve it later. Verify it does NOT appear in final memory.

## Exit criteria

- Two independent evaluators (or self-eval with 12h gap) agree output passes blind test.
- Memory stays under 60 lines on a 2-hour transcript (tight hygiene).
- Output is deterministic enough that small transcript tweaks don't flip unrelated entries (stability check).

## If this chunk fails

Options in order of preference:

1. **Iterate prompt.** Most likely fix. Add more explicit negative examples, tighten hygiene instructions.
2. **Switch model.** Try Opus 4.7 if Sonnet is weak on hygiene.
3. **Pivot to handoff-only.** Ship without auto-distiller: `/relay-handoff` becomes the only write path, humans author memory verbatim. Less magic, still useful, still demoable.

Do NOT proceed to Chunk 2 until one of these passes.
