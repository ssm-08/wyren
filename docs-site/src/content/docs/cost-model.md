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

## Tier 2 — Claude Sonnet 4.6 (deep cleanup, design only)

Sonnet was planned for a slower cadence to fix Haiku drift:

- Once per hour after any Tier 1 runs
- When `memory.md` exceeds 60 lines → forced re-compression
- On explicit `/relay-handoff`

**Not shipped in the 48h build.** The standalone `distiller.mjs` accepts a `--model <id>` argument, so you can invoke Sonnet manually with `node distiller.mjs --model claude-sonnet-4-6 ...` — but the Stop hook spawns it with Haiku every time. No timer, no line-count trigger. `/relay-handoff` runs the normal distiller (Haiku) with `--push`.

The Tier 2 design stays in the plan because Haiku drift on long sessions is a real concern — but it's intentional follow-up work, not a current capability. See [Future](/future/).

## Prompt caching (SDK path only)

When using the Anthropic SDK (not `claude -p`):

- System prompt → 5min cache, ~$0 on repeat reads.
- Current `memory.md` → 5min cache, ~$0 on repeat reads.
- Only the transcript slice varies per call — small incremental cost.

Effective cached per-call cost: **~$0.003 on Haiku, ~$0.008 on Sonnet**.

## Revised total — what actually ships

With only Tier 0 + Tier 1 shipped (no Tier 2 automation):

- 144 raw triggers (3 teammates × 4 hrs × 12/hr).
- Tier 0 kills ~70% → ~43 triggers reach API.
- All 43 go to Haiku — under `claude -p`, these draw from each teammate's Claude Code quota (no separate billing).
- If the SDK path is used instead with prompt caching: 43 × $0.003 = **~$0.13** total for the whole 4-hour hackathon.

**Compared to the naive baseline of $8.60 — roughly 65× cheaper, and $0 under the preferred `claude -p` path.**

## The zero-billing path

When using `claude -p` headless (the default/preferred path), **distillation draws from each teammate's existing Claude Code quota** — no separate API billing surface at all.

For hackathon demo: **preferred path is free in new-billing terms**. The tiered SDK path only matters for cost-conscious future users who don't have Claude Code.

## Free-only fallback

If a teammate has **no Claude Code auth AND no API key** (edge case), Tier 0 regex alone produces a degraded but non-zero memory:

- Bullet-list every signal-word match with surrounding context.
- No semantic cleanup — verbose and noisy.
- Still beats nothing on a team with one paid member distilling on everyone else's behalf.

Documented, not demoed.

## Which tiers actually ship?

| Tier | Status |
|---|---|
| Tier 0 (regex filter) | ✅ **Shipped** in `lib/filter.mjs`. Mandatory — runs before every API call. Kills ~70% of triggers. |
| Tier 1 (Haiku 4.5) | ✅ **Shipped** as the default in `distiller.mjs`. Invoked via `claude -p --model claude-haiku-4-5-20251001`. |
| Tier 2 (Sonnet 4.6 on timer / size threshold) | ❌ Not shipped. `distiller.mjs --model <id>` accepts Sonnet manually, but there is no automatic Tier 2 trigger. |
| SDK prompt caching | ❌ Not shipped. Current path uses `claude -p` exclusively — no `@anthropic-ai/sdk` code path. |

What this means in practice: cost is **$0 on the preferred `claude -p` path**. If you're on the SDK fallback without caching, it's roughly Haiku pricing × 43 calls = **$0.86 for a 4-hour 3-person hackathon**. Still cheap, but notably higher than the cached design.
