---
title: Cost model
description: Tiered extraction keeps background distillation cheap — or free.
---

Relay's distiller runs continuously in the background. Naively, that's wasteful. Relay uses a **three-tier pipeline** to keep cost minimal — or zero if running under the user's existing Claude Code auth.

## Naive baseline (what we DON'T do)

Without tiering, every `Stop` hook triggers a Sonnet 4.6 call:

- Per call: ~10k input tokens (transcript slice + memory + prompt) + ~2k output.
- Sonnet 4.6: $3/M input + $15/M output → **~$0.06 per call**.
- 3 teammates × 4 active hours × 12 triggers/hr = 144 calls = **~$8.60 total**.

Cheap in absolute terms, but **most turns contribute nothing** to memory (tool-use loops, file reads, small tweaks). The fix is tiering.

## Tier 0 — Local regex filter (FREE)

Before any API call, the distiller scans the transcript slice for "signal words":

```regex
/\b(decide|decided|won'?t|doesn'?t work|workaround|hack|TODO|FIXME|rejected|tried|instead|actually|broken|skip|stub|hardcod|mock|placeholder|out of scope|for now|revisit|later)\b/i
```

Plus structural signals:
- Any assistant turn with `stop_reason: "tool_use"` calling `Edit` or `Write` — real code changes.
- `parentUuid` gaps suggesting branch abandonment.

**Rule:** if the slice scores 0 signals → skip the API call entirely. Update watermark, return. **~60-70% of triggers die here for free.**

## Tier 1 — Claude Haiku 4.5 (routine)

Remaining 30-40% of triggers go to Haiku 4.5:

- Pricing: ~$1/M input + $5/M output → **~$0.02 per call**.
- Latency: ~2s P50 — background completes before next trigger.
- Quality: sufficient for **incremental** updates. It's merging a small delta into a well-structured existing file, not generating from scratch.

## Tier 2 — Claude Sonnet 4.6 (deep cleanup)

Sonnet runs on a slower cadence:

- Once per hour, if any Tier 1 ran in that hour.
- On session exit (force-flush via next-session-start fallback).
- On `/relay-handoff` slash command.
- When `memory.md` exceeds 60 lines — hygiene violation → force re-compression.

Sonnet reads the full current memory and re-compresses aggressively — fixes Haiku drift, removes stale entries, unifies phrasing. **~1-2 Sonnet calls per hour per teammate.**

## Prompt caching (SDK path only)

When using the Anthropic SDK (not `claude -p`):

- System prompt → 5min cache, ~$0 on repeat reads.
- Current `memory.md` → 5min cache, ~$0 on repeat reads.
- Only the transcript slice varies per call — small incremental cost.

Effective cached per-call cost: **~$0.003 on Haiku, ~$0.008 on Sonnet**.

## Revised total — tiered + cached

- 144 raw triggers (3 teammates × 4 hrs × 12/hr).
- Tier 0 kills 70% → 43 triggers reach API.
- 90% go to Haiku (39 × $0.003) = **$0.12**.
- 10% go to Sonnet (4 × $0.008) = **$0.03**.
- Hourly deep re-compressions (12 × $0.01) = **$0.12**.
- **Total: ~$0.30** for the full hackathon.

**30× cheaper than naive.**

## The zero-billing path

When using `claude -p` headless (the default/preferred path), **distillation draws from each teammate's existing Claude Code quota** — no separate API billing surface at all.

For hackathon demo: **preferred path is free in new-billing terms**. The tiered SDK path only matters for cost-conscious future users who don't have Claude Code.

## Free-only fallback

If a teammate has **no Claude Code auth AND no API key** (edge case), Tier 0 regex alone produces a degraded but non-zero memory:

- Bullet-list every signal-word match with surrounding context.
- No semantic cleanup — verbose and noisy.
- Still beats nothing on a team with one paid member distilling on everyone else's behalf.

Documented, not demoed.

## Which tiers ship in 48h?

| Chunk | What ships |
|---|---|
| Chunk 1 | Iterate prompt on single Sonnet calls. Cost irrelevant during dev. |
| Chunk 3 | Tier 0 regex filter **(mandatory)**. Haiku default. |
| Chunk 3 | Sonnet path as separate function, gated by timer + line-count. |
| Chunk 5 | SDK prompt caching path — stretch. Cost-story for demo. |

Fallback if time runs short: single-tier Haiku for everything. Still ~5× cheaper than naive Sonnet.
