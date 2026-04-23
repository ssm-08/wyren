# Relay — Project Context

Relay is a Claude Code plugin that gives a team shared memory across every teammate's sessions on the same repo. Each session's transcript is distilled in the background; a compact `memory.md` is synced via git and injected as hidden system context at every new `SessionStart` — so any Claude, on any laptop, starts warm with the team's reasoning (decisions, rejected paths, live workarounds).

**Audience for this file:** future Claude Code sessions working on this repo. Keep it terse; leave depth to the docs site.

## Canonical references

- **Docs site** (polished, team-facing): `docs-site/` → deployed at `https://ssm-08.github.io/relay/`. Good for onboarding a teammate; updated live during the build.
- **GitHub repo:** `https://github.com/ssm-08/relay` (branch `master`).

## Current status

- **Chunk 0 (pre-build docs site):** ✅ shipped. Astro Starlight, 19 content pages, Mermaid diagrams, GitHub Pages via Actions.
- **Chunk 1 (distiller quality gate):** ✅ shipped. `distiller.mjs` + `lib/transcript.mjs` + `lib/memory.mjs` + `prompts/distill.md`. Gate passed first iteration: 34-line memory from 828-line transcript, hygiene test passed, blind A/B test 3/3. Uses `claude -p --bare` — `--bare` flag critical to strip global plugins/hooks from subprocess.
- **Chunk 2 (plugin skeleton + injection):** ✅ shipped. `.claude-plugin/plugin.json` + `hooks/hooks.json` + `hooks/run-hook.cmd` + `hooks/session-start.mjs` + `hooks/stop.mjs` (stub) + `bin/relay.mjs` + `lib/util.mjs`. 17 unit tests green. E2E verified via hook pipe test.
- **Chunk 3 (distiller wired into Stop hook):** ✅ shipped. `stop.mjs` spawns distiller detached after 5 turns (or 2min idle). Tier 0 regex filter in `lib/filter.mjs` — matches rendered transcript format `[tool_use Edit]`, not raw JSONL. Default model Haiku 4.5. `distiller_running` lock prevents concurrent runs. 29 unit tests green.
- **Chunk 4 (git sync layer):** ✅ shipped. `lib/sync.mjs` — `GitSync` with `pull()` (fetch + checkout `.relay/` from remote, 3s cap, `RELAY_SKIP_PULL` escape), `push()` (commit + retry-on-conflict, `reset --mixed FETCH_HEAD` keeps HEAD in sync), `lock()` (atomic `openSync('wx')`, 60s stale-steal). `relay status` + `relay distill [--force|--push|--dry-run]` CLI. 38 unit tests green.
- **Chunk 5 (broadcast + polish + demo):** ✅ shipped. `relay broadcast-skill` CLI, `/relay-handoff` slash command (`commands/relay-handoff.toml`), acknowledgment instruction in SessionStart, polished README + docs. All 6 chunks complete — plugin is feature-complete.
- **Post-ship (2026-04-22):** ✅ code review + 7 bug fixes (fd leak, double-distiller race, atomic watermark writes, handoff conflict retry, execSync→spawnSync, JSONL error logging, plugin.json hooks pointer). Two Windows/junction bugs fixed: `isMain()` now uses `realpathSync`, `run-hook.cmd` self-locates `CLAUDE_PLUGIN_ROOT`. 48 unit tests green. Docs: 22 pages + guides/two-system-test.md.
- **Scripts (2026-04-22):** ✅ `scripts/setup.ps1` + `scripts/test-e2e.mjs` shipped. 21 e2e tests across 7 groups (init, SessionStart, Stop, distiller, CLI, dispatcher, stress/concurrency). Full lifecycle verified.
- **Live two-system test (2026-04-22):** ✅ verified end-to-end across two machines. Fixed: setup.ps1 cwd bug, windowsHide: true for distiller spawn.
- **Deployability v1 (2026-04-23):** ✅ `install.sh` (macOS/Linux) + `install.ps1` (Windows) one-liner installers. `scripts/installer.mjs` — shared Node logic for install/update/uninstall/doctor (zero deps, JSONC-tolerant settings.json patch, atomic write, symlink/junction, verify). `relay install|update|uninstall|doctor` CLI subcommands. `setup.ps1` shrunk to deprecation stub. CI matrix: ubuntu unit + macos/windows e2e. Code review: 3 Important bugs caught + fixed. **79 unit tests + 27 e2e = 106 total.**

## Repo layout

```
Vibejam/
├── docs-site/                  # Astro Starlight — team docs site (Chunk 0, done)
│   ├── src/content/docs/       # markdown content
│   ├── src/plugins/            # custom rehype + post-build integrations
│   └── astro.config.mjs        # base path + env overrides
├── .github/
│   ├── workflows/docs.yml      # Pages deploy (docs-site/** changes only)
│   └── workflows/ci.yml        # Unit + e2e CI (ubuntu + macos + windows)
├── install.sh                  # macOS/Linux one-liner installer shim
├── install.ps1                 # Windows one-liner installer shim
├── README.md
├── .gitignore                  # excludes node_modules/, .claude/, .relay/state/, .relay/log, .worktrees/
├── CLAUDE.md                   # this file
├── package.json                # name/version/bin/scripts/engines (zero deps)
├── distiller.mjs               # Chunks 1+3: distiller CLI (Haiku 4.5 default, Tier 0 filter)
├── lib/
│   ├── transcript.mjs          # JSONL parse + slicer + prose renderer
│   ├── memory.mjs              # atomic read/write for memory.md
│   ├── filter.mjs              # Tier 0 signal filter (hasTier0Signal)
│   ├── sync.mjs                # Chunk 4: GitSync — pull, push, lock
│   └── util.mjs                # readStdin, isMain (realpathSync junction-safe)
├── prompts/
│   └── distill.md              # distiller system prompt (core IP)
├── hooks/                      # plugin hooks
│   ├── hooks.json              # hook manifest
│   ├── run-hook.cmd            # polyglot bash+cmd dispatcher (self-locates CLAUDE_PLUGIN_ROOT)
│   ├── session-start.mjs       # injects memory + broadcast as additionalContext
│   └── stop.mjs                # watermark + detached distiller spawn (5 turns / 2min idle)
├── bin/
│   └── relay.mjs               # CLI: init | status | distill | broadcast-skill | install | update | uninstall | doctor
├── scripts/
│   ├── installer.mjs           # cross-platform install/update/uninstall/doctor logic (Node, zero deps)
│   ├── setup.ps1               # DEPRECATED stub — forwards to install.ps1
│   └── test-e2e.mjs            # 27 e2e tests across 8 groups (A–H)
├── tests/                      # 79 unit tests (node:test)
│   ├── installer.test.mjs      # installer pure-function tests (26)
│   ├── stop.test.mjs           # watermark, shouldDistill, trigger-lock
│   ├── sync.test.mjs           # GitSync — pull, push, lock (bare-repo fixture)
│   └── ...                     # session-start, distiller, relay-init, broadcast-skill
└── commands/
    └── relay-handoff.toml      # /relay-handoff slash command
```

## Plugin registration (non-obvious — read before touching hooks)

Junction into `~/.claude/plugins/relay` is NOT sufficient. Claude Code only fires hooks for plugins listed in `installed_plugins.json`. For local dev, wire hooks directly in `~/.claude/settings.json`:

```json
"hooks": {
  "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\\hooks\\run-hook.cmd\" session-start", "timeout": 2, "statusMessage": "Loading relay memory..."}]}],
  "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\\hooks\\run-hook.cmd\" stop", "timeout": 5}]}]
}
```

**`install.sh` / `install.ps1` automates this.** Run from anywhere:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/ssm-08/relay/master/install.sh | sh

# Windows
iwr -useb https://raw.githubusercontent.com/ssm-08/relay/master/install.ps1 | iex

# Dev: use local clone, test without touching real ~/.claude/
node scripts/installer.mjs install --from-local . --home /tmp/fake-home
node scripts/installer.mjs doctor --home /tmp/fake-home
node scripts/installer.mjs uninstall --home /tmp/fake-home
```

**Hook command uses `${CLAUDE_PLUGIN_ROOT}` variable** (not absolute path). Claude Code expands this at invocation. `run-hook.cmd` is a polyglot bash+cmd file — same file works on both OSes.

## Non-obvious conventions

1. **Base path is env-driven.** Astro config reads `RELAY_BASE` (default `/relay`). Workflow sets it from `${{ github.event.repository.name }}` so the site deploys to any repo name. If renaming repo, no code changes needed — CI picks it up.

2. **Root-relative links in markdown omit the base prefix.** Link to `/problem/` not `/relay/problem/`. The `rehype-base-href` plugin prepends the prefix at build time; `astro-base-href-fixup` integration does a post-build pass to fix Starlight's hero-action hrefs that bypass the markdown pipeline. If you add new pages/links, keep to this convention.

3. **Mermaid rendering is client-side via CDN.** `rehype-mermaid-pre.mjs` transforms ` ```mermaid ` fences into `<pre class="mermaid">`; a head script loads `mermaid@11` from jsdelivr and runs on `astro:page-load`. No playwright, no heavy deps. If offline rendering is ever needed, swap in a Node-based mermaid renderer.

4. **Workflow `paths:` filter is strict.** Only pushes touching `docs-site/**` or `.github/workflows/docs.yml` trigger the Pages deploy. Empty commits are skipped. To force a redeploy without content changes, use `workflow_dispatch` (Actions tab → Run workflow).

5. **Node 22 pinned in CI.** Node 20 deprecation warning from `actions/setup-node` flagged in early runs. Don't drop below 22. Local dev on any 20+ works.

6. **`.claude/` is gitignored.** Per-machine Claude Code state (permissions, session transcripts) must never be committed. Team memory lives in `.relay/memory.md`, not `.claude/`.

## Coding conventions

- **Node.js ESM `.mjs`. Zero runtime dependencies** — stdlib only (`node:fs`, `node:child_process`, `node:path`, `node:readline`, `node:os`). `@anthropic-ai/sdk` is a SDK-fallback-only dep (tree-shakeable out of the preferred path).
- **Preferred AI call: `claude -p`** (headless Claude Code). Rides the user's existing Claude Code auth; no separate API key. SDK path is the fallback when `claude` CLI is unavailable.
- **Tier 0 regex filter is mandatory** before any API call. See `docs-site/src/content/docs/cost-model.md` for the exact regex and rationale. ~70% of triggers skip the API entirely.
- **Hooks never block.** `SessionStart` must return in < 500ms (hard-capped 2s with fail-open). `Stop` spawns the distiller detached and returns immediately. On any error: log to `.relay/log` and `process.exit(0)` — never break Claude Code on a Relay failure.
- **Atomic memory writes.** Write to `.relay/memory.md.tmp`, then `rename()`.
- **Path-scoped git pushes.** `git add .relay/memory.md .relay/broadcast/` — never push main code from within a hook.
- **`git()` helper uses `spawnSync(array)`** — never shell strings (no injection surface).

## Commit style

- Type-prefixed: `docs:`, `ci(pages):`, `feat(distiller):`, `fix(hooks):`, `chore:`.
- Subject in imperative, under 70 chars.
- Body explains *why*, not *what* (diff shows what).
- Trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` when pair-producing with Claude.

## Local dev flow

Docs site:
```bash
cd docs-site
npm install          # first time
npm run dev          # http://localhost:4321/relay/ — hot reload
npm run build        # static HTML in dist/
```

Plugin tests:
```bash
npm test             # 79 unit tests (~15s)
npm run test:e2e     # 27 e2e tests (~25s, no Claude API needed)
node scripts/test-e2e.mjs --only stop   # filter to one group
node scripts/test-e2e.mjs --verbose     # dump stdout/stderr on failure
```

## What's out of scope (don't build these yet)

Next planned specs: distillation quality, CLAUDE.md compatibility, reliability (`relay doctor` deep checks), sync robustness, decision traceability. See session context for per-area breakdown.

Don't build: cloud sync backend, dashboard UI, MCP RAG server, permissions/auth, Cursor/Windsurf support, real-time per-turn sync, CRDT merge strategies. All designed-for (`RelaySync` interface is pluggable) but out of scope.
