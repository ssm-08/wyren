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
| [3](/roadmap/3-distillation/) | 14-22 | Distiller wired to Stop hook | <Badge text="In progress" variant="caution" /> |
| [4](/roadmap/4-git-sync/) | 22-32 | Git sync layer | <Badge text="Pending" variant="default" /> |
| [5](/roadmap/5-broadcast/) | 32-44 | Broadcast + polish + demo | <Badge text="Pending" variant="default" /> |
| — | 44-48 | Buffer, demo rehearsal, fallback video | <Badge text="Pending" variant="default" /> |

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

**Shipped.** Plugin installs via `/plugins add ssm-08/relay`. `SessionStart` hook reads `.relay/memory.md` + broadcast files, injects as `additionalContext`. `relay init` sets up `.relay/` structure. 17 unit tests green. E2E verified via hook pipe test.

New files: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/run-hook.cmd`, `hooks/session-start.mjs`, `hooks/stop.mjs` (stub), `bin/relay.mjs`, `lib/util.mjs`.

[Full Chunk 2 detail →](/roadmap/2-skeleton/)

## Chunk 3 — Distiller wired into Stop hook (Hours 14-22)

Real-time distillation. `Stop` hook debounces, spawns distiller detached. Memory updates live during a session. Still single-machine.

**Exit criteria:** 10-turn conversation triggers distiller, memory reflects decisions/rejections/workarounds, next session first reply names them correctly.

[Full Chunk 3 detail →](/roadmap/3-distillation/)

## Chunk 4 — Git sync layer (Hours 22-32)

Cross-machine sync. `RelaySync` interface + `GitSync` impl. Retry-on-conflict, advisory lock.

**Exit criteria:** two laptops, warm-start each other reliably over 5 trials. Git log of `.relay/memory.md` stays clean-linear.

[Full Chunk 4 detail →](/roadmap/4-git-sync/)

## Chunk 5 — Broadcast + polish + demo (Hours 32-44)

Skills/CLAUDE.md broadcast via `.relay/broadcast/`. `relay broadcast-skill <name>` CLI. `/relay-handoff` slash command (stretch). README + demo script.

**Exit criteria:** full scripted demo runs end-to-end in under 4 minutes without intervention.

[Full Chunk 5 detail →](/roadmap/5-broadcast/)

## Buffer (Hours 44-48)

Fix whatever broke during rehearsal. Record fallback demo video. Short design-doc writeup for judges.
