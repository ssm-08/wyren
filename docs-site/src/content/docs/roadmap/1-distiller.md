---
title: Chunk 1 — Distiller quality gate
description: Hours 0-6. Highest-risk chunk. Go/no-go gate for the whole project.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="tip" title="Shipped">
Gate passed on first prompt iteration using Sonnet 4.6 via `claude -p --bare`. Two-pass A/B test on a real 828-line planning transcript: final memory 34 lines, 3/3 blind facts present, hygiene test passed (a resolved open question was correctly dropped on the incremental pass). Safe to proceed to Chunk 2.
</Aside>

<Aside type="danger" title="Gate behavior — read before re-running">
If a future change to the prompt or model regresses output quality, **do not proceed** past this chunk. Iterate the prompt, switch model, or pivot to handoff-only.
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
    --memory .wyren/memory.md \
    --since <uuid-or-empty> \
    --out .wyren/memory.new.md
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

Headless Claude Code with `--bare` to skip global hooks/plugins/auto-memory so the distiller sees only the prompt we hand it:

```bash
echo "$PROMPT

<session-id>$SESSION_ID</session-id>

<existing-memory>
$MEMORY
</existing-memory>

<transcript-slice>
$SLICE
</transcript-slice>" | claude -p --bare --no-session-persistence \
    --tools "" --output-format text \
    --model claude-sonnet-4-6 > memory.new.md
```

Why `--bare`: without it the subprocess would inherit the team's CLAUDE.md, SessionStart hooks (caveman, superpowers), and auto-memory — all of which would pollute the distiller's output. With `--bare`, only the piped prompt reaches the model.

Fallback: Anthropic SDK with `@anthropic-ai/sdk` (if `claude` CLI unavailable).

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

## Results on the gate run

Test corpus: the 828-line planning session for Wyren itself — real decisions, real rejected paths, real Windows-specific workaround discovered mid-session.

| Pass | Input | Output | Time |
|---|---|---|---|
| 1 | Lines 0-414, empty memory | 27-line memory: 9 decisions, 4 rejected paths, 2 live workarounds, 1 open question | ~35s |
| 2 | Lines 415-828, pass 1 as memory | 34-line memory: 12 decisions, 5 rejected paths, 5 live workarounds, 0 open questions | ~80s |
| 2b | Same as pass 2 (stability) | Same semantic content, phrasing varies | ~77s |

Blind test (3 concrete facts a fresh teammate would need):
- Docs site is deployed at `https://ssm-08.github.io/wyren/` — ✅ captured.
- Custom `rehype-mermaid-pre.mjs` replaces `rehype-mermaid` (the latter pulled playwright) — ✅ captured.
- Windows Git Bash needs `MSYS_NO_PATHCONV=1` when setting `WYREN_BASE` locally — ✅ captured (non-obvious gotcha worth the whole feature).

Hygiene test: pass 1 recorded "open question: `.gitignore` content unconfirmed" at turn 265. The second half of the transcript resolved this. Pass 2 correctly **removed** the open question. Self-cleaning under load. ✅

Stability (pass 2 vs 2b on identical inputs): same section structure, same decisions preserved, same rejected paths, same workarounds. Wording and turn-number estimates drift slightly (Sonnet non-determinism) but no content flips. ✅

## If this chunk fails

Options in order of preference:

1. **Iterate prompt.** Most likely fix. Add more explicit negative examples, tighten hygiene instructions.
2. **Switch model.** Try Opus 4.7 if Sonnet is weak on hygiene.
3. **Pivot to handoff-only.** Ship without auto-distiller: `/wyren-handoff` becomes the only write path, humans author memory verbatim. Less magic, still useful, still demoable.

Do NOT proceed to Chunk 2 until one of these passes.
