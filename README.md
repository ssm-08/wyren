# Relay

Shared brain for teams using Claude Code. One memory, every session warm.

> Multiple humans. One brain. Zero workflow change.

## Install

```
/plugins add ssm-08/relay
```

## Init (per repo)

```bash
cd your-project
node ~/.claude/plugins/relay/bin/relay.mjs init
git add .relay/memory.md
git commit -m "chore: init relay"
git push
```

## How memory updates

Every 5 turns (or after 2min idle since last distillation), the `Stop` hook spawns `distiller.mjs` detached in the background. Distiller scans the transcript slice for signal words — decisions, rejections, workarounds, actual code changes. If none found (Tier 0 filter), the API call is skipped entirely. Otherwise it calls Haiku 4.5 to update `memory.md` atomically.

Watch it live: `tail -f .relay/log`

You can also seed memory manually by editing `.relay/memory.md` directly — useful for initial project context before any sessions run.

## Dev install (local)

```bash
# Windows (run as admin)
mklink /J "C:\Users\<you>\.claude\plugins\relay" "C:\path\to\Vibejam"

# Unix
ln -s ~/path/to/Vibejam ~/.claude/plugins/relay
```

## What is this?

A Claude Code plugin that:
1. Watches every teammate's session transcript in the background.
2. Distills the transcript into a compact `memory.md` (decisions, rejected paths, live workarounds).
3. Syncs `memory.md` across teammates via git.
4. Injects it as hidden context at every `SessionStart` — so any new Claude, on any laptop, starts warm.

## Repo layout

```
Vibejam/
├── docs-site/                  # Astro Starlight documentation site
├── .claude-plugin/
│   └── plugin.json             # Claude Code plugin manifest
├── hooks/
│   ├── hooks.json              # SessionStart + Stop hook definitions
│   ├── run-hook.cmd            # Windows/Unix polyglot dispatcher
│   ├── session-start.mjs       # injects .relay/memory.md as additionalContext
│   └── stop.mjs                # watermark + detached distiller spawn
├── bin/
│   └── relay.mjs               # CLI: relay init
├── tests/                      # node:test unit tests
├── distiller.mjs               # standalone distiller CLI (Chunk 1)
├── lib/
│   ├── transcript.mjs          # JSONL parse + slice + prose render
│   ├── memory.mjs              # atomic memory.md read/write
│   └── filter.mjs              # Tier 0 regex signal filter
├── prompts/
│   └── distill.md              # distiller system prompt
├── .github/workflows/docs.yml  # GitHub Pages deploy for docs-site
└── README.md                   # (this file)
```

## Status

Built for a 48-hour hackathon. Six chunks:

| Chunk | Status | What |
|---|---|---|
| 0 | ✅ Done | Documentation site (Astro Starlight) |
| 1 | ✅ Done | Distiller quality gate — `distiller.mjs`, `lib/transcript.mjs`, `lib/memory.mjs`, `prompts/distill.md` |
| 2 | ✅ Done | Plugin skeleton + injection — hooks, `relay init`, memory injection |
| 3 | ✅ Done | Distiller wired to Stop hook — Tier 0 filter, Haiku default, detached spawn, 29 tests green |
| 4 | ⏳ | Git sync layer (hours 22-32) |
| 5 | ⏳ | Broadcast + polish + demo (hours 32-44) |

See [docs-site](./docs-site/) for the full plan, architecture, and cost model.

## Running the docs site locally

```bash
cd docs-site
npm install
npm run dev
# → open http://localhost:4321/relay
```

Build:
```bash
npm run build
# → static site in docs-site/dist
```

## Deploying docs

Push to `main` / `master`. GitHub Actions builds and deploys to Pages automatically (see `.github/workflows/docs.yml`).

## Full planning document

The complete 48h implementation plan lives outside the repo at
`~/.claude/plans/enter-plan-and-help-quiet-eagle.md`. The docs site is a
polished, browsable version of that plan.
