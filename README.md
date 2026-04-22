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

## Manual memory seeding

Until the distiller is wired (Chunk 3), edit `.relay/memory.md` directly:

```markdown
# Relay Memory

## Decisions
- Using SQLite (rejected Postgres — too heavy for this project)

## Live workarounds
- user_id hardcoded to 1 in /dashboard — remove before demo [session abc1, turn 3]
```

Every teammate's next session starts with this context injected silently.

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
│   └── stop.mjs                # watermark counter (distiller wires here in Chunk 3)
├── bin/
│   └── relay.mjs               # CLI: relay init
├── tests/                      # node:test unit tests
├── distiller.mjs               # standalone distiller CLI (Chunk 1)
├── lib/
│   ├── transcript.mjs          # JSONL parse + slice + prose render
│   └── memory.mjs              # atomic memory.md read/write
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
| 3 | ⏳ | Distiller wired to Stop hook (hours 14-22) |
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
