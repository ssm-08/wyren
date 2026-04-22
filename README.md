# Relay

Shared brain for teams using Claude Code. One memory, every session warm.

> Multiple humans. One brain. Zero workflow change.

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
├── .github/workflows/docs.yml  # GitHub Pages deploy for docs-site
├── README.md                   # (this file)
└── (plugin source comes next — Chunks 1-5)
```

## Status

Built for a 48-hour hackathon. Six chunks:

| Chunk | Status | What |
|---|---|---|
| 0 | ✅ Done | Documentation site (Astro Starlight) |
| 1 | ⏳ Next | Distiller quality gate (hours 0-6) |
| 2 | ⏳ | Plugin skeleton + injection (hours 6-14) |
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
