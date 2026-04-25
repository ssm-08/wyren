---
title: Cost model
description: Tiered extraction keeps background distillation cheap — or free.
---

Relay's distiller runs continuously in the background. Naively, that's wasteful. Relay uses a **three-tier pipeline** to keep cost minimal — or zero under the preferred execution path.

## Naive baseline (what we DON'T do)

Without tiering, every `Stop` hook triggers a Sonnet 4.6 call:

- Per call: ~10k input tokens (transcript slice + memory + prompt) + ~2k output.
- Sonnet 4.6: $3/M input + $15/M output → **~$0.06 per call**.
- 3 teammates × 4 active hours × 12 triggers/hr = 144 calls = **~$8.60 total**.

Cheap in absolute terms, but **most turns contribute nothing** to memory (tool-use loops, file reads, small tweaks). The fix is tiering.

## Tier 0 — Local scoring filter (FREE)

Before any API call, `lib/filter.mjs` scores the transcript slice. Scoring runs entirely in Node — no API call, no cost.

**Text signals** (weighted, capped per category):

| Category | Weight | Examples |
|---|---|---|
| Decision language | 3 | `decided`, `we're going with`, `chose`, `agreed` |
| Rejection / failure | 3 | `rejected`, `doesn't work`, `tried X but`, `abandoned` |
| Deliberate hacks | 3 | `workaround`, `hack`, `hardcoded`, `stub`, `mock` |
| Scope signals | 2 | `out of scope`, `deferred`, `descoped`, `dropping` |
| Open questions | 2 | `open question`, `still deciding`, `TBD`, `revisit` |
| Maintenance flags | 2 | `TODO`, `FIXME`, `before launch` |
| Weak signals | 1 | `actually`, `instead`, `broken`, `for now` |

Edit tool calls (`Edit` / `Write` / `MultiEdit`) are scored separately at weight 3 per call, capped at weight × 4.

**Structural signals** (scored on raw JSONL lines, not rendered text):
- Session length ≥ 10 turns: +2; ≥ 20 turns: +4 total
- Average user message length > 200 chars: +2 (explains context or decisions)
- File edits ≥ 3: +2; ≥ 8: +4 total

**Rule:** total score must reach the threshold (default **3**, overridable via `RELAY_TIER0_THRESHOLD`) to proceed. A single high-value signal word is enough; weak words alone need reinforcement. **~60–70% of triggers die here for free.**

## Tier 1 — Claude Haiku 4.5 (routine distillation)

The remaining 30–40% of triggers go to Haiku 4.5 (`claude-haiku-4-5-20251001`):

- Pricing: ~$1/M input + $5/M output → **~$0.02 per call**.
- Latency: ~2 s P50 — background completes before the next trigger.
- Quality: sufficient for **incremental** updates. The task is merging a small delta into a well-structured existing file, not generating from scratch.

This is the only model the Stop hook ever spawns automatically.

## Tier 2 — Claude Sonnet 4.6 (deep cleanup)

Sonnet is designed for a slower cadence to correct Haiku drift over long sessions:

- Once per hour after any Tier 1 runs
- When `memory.md` exceeds 60 lines → forced re-compression
- On explicit `/relay-handoff`

**Not yet automated.** The standalone `distiller.mjs` accepts `--model <id>`, so you can invoke Sonnet manually with `relay distill --model claude-sonnet-4-6 --push` — but the Stop hook always uses Haiku. No timer or line-count trigger exists yet. `/relay-handoff` runs the normal distiller (Haiku) with `--push`.

Haiku drift on long sessions is a real concern — Tier 2 automation is planned follow-up work, not a current capability. See [Future](/future/).

## Prompt caching (SDK path only)

When using the Anthropic SDK (not `claude -p`):

- System prompt → 5 min cache, ~$0 on repeat reads.
- Current `memory.md` → 5 min cache, ~$0 on repeat reads.
- Only the transcript slice varies per call — small incremental cost.

Effective cached per-call cost: **~$0.003 on Haiku, ~$0.008 on Sonnet**.

## Revised total — what actually ships

With Tier 0 + Tier 1 (no Tier 2 automation):

- 144 raw triggers (3 teammates × 4 active hours × 12/hr).
- Tier 0 kills ~70% → ~43 triggers reach the API.
- All 43 go to Haiku. Under `claude -p` these draw from each teammate's Claude Code quota — no separate billing.
- If the SDK path is used instead with prompt caching: 43 × $0.003 = **~$0.13** total for the session.

**Compared to the naive baseline of $8.60 — roughly 65× cheaper, and $0 under the preferred `claude -p` path.**

## The zero-billing path

When using `claude -p` headless (the default), **distillation draws from each teammate's existing Claude Code quota** — no separate API billing surface at all.

The tiered SDK path only matters for cost-conscious deployments where teammates do not have Claude Code subscriptions.

## Free-only fallback

If a teammate has **no Claude Code auth AND no API key** (edge case), Tier 0 scoring alone produces a degraded but non-zero memory:

- Bullet-list every signal-word match with surrounding context.
- No semantic cleanup — verbose and noisy.
- Still better than nothing on a team with one paid member distilling on everyone else's behalf.

## Which tiers ship?

| Tier | Status |
|---|---|
| Tier 0 (weighted scoring filter) | ✅ **Shipped** in `lib/filter.mjs`. Mandatory — runs before every API call. Kills ~70% of triggers. |
| Tier 1 (Haiku 4.5) | ✅ **Shipped** as default in `distiller.mjs`. Invoked via `claude -p --model claude-haiku-4-5-20251001`. |
| Tier 2 (Sonnet on timer / size threshold) | ❌ **Not automated.** `distiller.mjs --model <id>` accepts Sonnet manually; no automatic trigger. |
| SDK prompt caching | ❌ **Not shipped.** Current path uses `claude -p` exclusively. |
