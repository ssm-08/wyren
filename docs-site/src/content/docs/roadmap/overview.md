---
title: Roadmap — six chunks at a glance
description: Pre-build docs + five build chunks across 48 hours.
---

import { Badge } from '@astrojs/starlight/components';

## Timeline

| Chunk | Hours | Name | Status |
|---|---|---|---|
| [0](/roadmap/overview/#chunk-0) | Pre-build | Documentation site | <Badge text="Shipped" variant="success" /> |
| [1](/roadmap/1-distiller/) | 0-6 | Distiller quality gate | <Badge text="Shipped" variant="success" /> |
| [2](/roadmap/2-skeleton/) | 6-14 | Plugin skeleton + injection | <Badge text="Shipped" variant="success" /> |
| [3](/roadmap/3-distillation/) | 14-22 | Distiller wired to Stop hook | <Badge text="Shipped" variant="success" /> |
| [4](/roadmap/4-git-sync/) | 22-32 | Git sync layer | <Badge text="Shipped" variant="success" /> |
| [5](/roadmap/5-broadcast/) | 32-44 | Broadcast + polish + demo | <Badge text="Shipped" variant="success" /> |
| — | 44-48 | Buffer, demo rehearsal, fallback video | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--deployability-v1) | 2026-04-23 | Cross-platform installer | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--live-sync--fault-hardening) | 2026-04-23 | Live sync + fault hardening | <Badge text="Shipped" variant="success" /> |

## Sequencing rules

1. **Each chunk has exit criteria.** Do NOT start the next chunk until current criteria pass.
2. **Chunk 1 is the go/no-go gate.** If distiller quality fails there, kill the project or pivot to handoff-only. All downstream infra is wasted without it.
3. **Living docs discipline.** Each chunk ends with a 5-min docs update. Docs ship with code.

## Chunk 0 — Documentation site (this site)

**Goal:** every teammate can read this site cold and answer: what is Relay, what problem, what's the stack, what ships when, how much it costs, how to install.

**Stack:** Astro Starlight → GitHub Pages. Markdown content, built-in search, dark mode, Mermaid diagrams.

**Exit criteria:**
- Deployed URL reachable; sidebar + search + dark mode all work.
- Unseen teammate reads site for 10 min and can answer five core questions unaided.
- Site committed + pushed; Actions green.

## Chunk 1 — Distiller quality gate (Hours 0-6) ✅

**Gate passed.** `distiller.mjs` + `lib/transcript.mjs` + `lib/memory.mjs` + `prompts/distill.md`. Tested on a real 828-line planning transcript: 34-line final memory, hygiene test passed (resolved item correctly dropped on incremental pass), blind A/B 3/3 non-obvious facts captured.

Key detail: subprocess runs with `claude -p --bare` — strips global plugins/hooks so only the distill prompt reaches the model.

[Full Chunk 1 detail + test results →](/roadmap/1-distiller/)

## Chunk 2 — Plugin skeleton + injection (Hours 6-14) ✅

**Shipped.** Plugin hooks wired via `~/.claude/settings.json`. `SessionStart` hook reads `.relay/memory.md` + broadcast files, injects as `additionalContext`. `relay init` sets up `.relay/` structure. 17 unit tests green. E2E verified via hook pipe test.

New files: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/run-hook.cmd`, `hooks/session-start.mjs`, `hooks/stop.mjs` (stub), `bin/relay.mjs`, `lib/util.mjs`.

[Full Chunk 2 detail →](/roadmap/2-skeleton/)

## Chunk 3 — Distiller wired into Stop hook (Hours 14-22) ✅

**Shipped.** `stop.mjs` spawns distiller detached after 5 turns (or 2min idle since last distillation). Tier 0 regex filter in `lib/filter.mjs` skips API calls when the transcript slice has no signal words or Edit/Write tool use. Default model changed to Haiku 4.5. `distiller_running` lock prevents concurrent runs. 29 unit tests green.

Key detail: the Tier 0 regex matches the *rendered* transcript format (`[tool_use Edit]`), not raw JSONL — a subtle but important distinction since the distiller operates on rendered prose, not the raw event stream.

[Full Chunk 3 detail →](/roadmap/3-distillation/)

## Chunk 4 — Git sync layer (Hours 22-32) ✅

**Shipped.** `lib/sync.mjs` — `GitSync` with `pull()` (fetch + scoped checkout of `.relay/` files, 3s timeout, `RELAY_SKIP_PULL` escape), `push()` (commit + retry-on-conflict, `reset --mixed FETCH_HEAD` on conflict so local HEAD stays in sync — no infinite re-conflict loop), `lock()` (atomic `openSync('wx')`, 60s stale-steal). Session-start pulls before injecting context; distiller pushes after atomic write. `relay status` and `relay distill [--force|--push|--dry-run]` CLI commands. 38 unit tests green (including two-machine conflict scenario).

Key implementation detail: conflict resolution uses `reset --mixed FETCH_HEAD` rather than `--theirs + rebase --continue`. Safer on Windows (no GIT_EDITOR needed), leaves working tree untouched outside `.relay/`, and correctly advances local HEAD to remote tip.

[Full Chunk 4 detail →](/roadmap/4-git-sync/)

## Chunk 5 — Broadcast + polish + demo (Hours 32-44) ✅

**Shipped.** Skills/CLAUDE.md broadcast via `.relay/broadcast/`. `relay broadcast-skill <name>` CLI copies a local skill file to `.relay/broadcast/skills/` for teammates to receive on their next `SessionStart`. Session-start wraps broadcast content with explicit authoritative headers so Claude treats it as team override. 46 unit tests green (6 broadcast-skill + 9 session-start + rest from prior chunks).

**Exit criteria:** full scripted demo runs end-to-end in under 4 minutes without intervention.

[Full Chunk 5 detail →](/roadmap/5-broadcast/)

## Buffer (Hours 44-48)

Fix whatever broke during rehearsal. Record fallback demo video. Short design-doc writeup for judges.

## Post-ship — Deployability v1 (2026-04-23) ✅

**Shipped.** Cross-platform installer closes the biggest adoption blocker — teammates on macOS had no automated install path.

New files: `install.sh` (macOS/Linux one-liner), `install.ps1` (Windows one-liner), `scripts/installer.mjs` (shared Node logic — preflight, symlink/junction, settings.json JSONC-tolerant patch, atomic write, verify, update, uninstall, doctor).

New CLI subcommands: `relay install`, `relay update`, `relay uninstall`, `relay doctor`. `setup.ps1` shrunk to deprecation stub. CI matrix added: ubuntu unit tests + macOS + Windows e2e. Heavy code review caught 3 Important bugs before merge.

Test totals after this work: **79 unit tests + 27 e2e tests = 106 total.**

[Install guide →](/reference/install/)

## Post-ship — Live sync + fault hardening (2026-04-23) ✅

**Shipped.** B's running session now receives A's new memory automatically — no restart required.

New files: `hooks/user-prompt-submit.mjs` (`UserPromptSubmit` hook — pulls `.relay/memory.md` on each user turn with a 1s fetch cap, diffs against a stored snapshot, injects only the delta as `additionalContext`), `lib/diff-memory.mjs` (pure section-aware diff + hash utilities, no deps).

State file: `.relay/state/ups-state.json` — owned exclusively by the UPS hook (stores snapshot hash + last-pull timestamp). `RELAY_SKIP_PULL=1` skips the pull; diff still runs from disk.

**Fault injection testing** caught two bugs before they reached users: (1) EISDIR crash when `.relay/state/` directory exists but `ups-state.json` is absent; (2) watermark race between Stop hook and UPS — resolved by giving each hook exclusive ownership of its own state file. `windowsHide: true` added to remaining `spawnSync` calls.

New test files: `tests/fault-network.test.mjs`, `tests/fault-corruption.test.mjs`, `tests/fault-concurrency.test.mjs`, `tests/fault-e2e-livesync.test.mjs` (53 fault tests).

Test totals after this work: **131 unit tests + 32 e2e tests = 163 total.**
