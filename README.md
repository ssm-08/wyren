# Wyren

[![CI](https://github.com/ssm-08/wyren/actions/workflows/ci.yml/badge.svg)](https://github.com/ssm-08/wyren/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40ssm-08%2Fwyren)](https://www.npmjs.com/package/@ssm-08/wyren)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

Shared brain for teams using Claude Code. One memory, every session warm.

> **Git made code collaboration possible. Wyren does the same for the AI working alongside your team.**

## The problem

Every Claude Code session starts blank. On a team this breaks down fast: each person's Claude gives conflicting advice because it doesn't know what was decided yesterday, what approaches failed, or what shortcuts are still in the code. You spend the first 10 minutes of every session re-briefing an AI that should already know.

The core insight: the problem isn't that Claude forgets — it's that Claude never knew in the first place.

## Why not CLAUDE.md?

`CLAUDE.md` is written by hand. It captures what you choose to document — usually the final decision, rarely the reasoning behind it. It doesn't update on its own, it doesn't know what your teammates did, and it doesn't capture the things nobody has time to write down at the moment they matter most.

|  | Updates automatically | Captures reasoning | Syncs across teammates |
|---|---|---|---|
| `CLAUDE.md` | ❌ | ❌ | ✅ (if committed) |
| Claude Projects | ❌ | ❌ | ✅ |
| **Wyren** | ✅ | ✅ | ✅ |

Wyren is what `CLAUDE.md` would be if it wrote itself.

## How it works

Wyren keeps a shared file in your git repo: `.wyren/memory.md`. Every session reads from it at startup. Every session writes to it while you work.

**Reading** — at session start, Wyren pulls the latest `.wyren/memory.md` from git and quietly feeds it to Claude before you type anything. Claude already knows the context.

**Writing** — while you work, Wyren watches your conversation in the background. After every few turns it pulls out what matters — decisions made, approaches that didn't pan out, temporary hacks — rewrites the file, and pushes it to git. You never notice it happening.

**Live sync** — if a teammate pushes new memory while your session is already open, Wyren picks it up automatically. Before each prompt you send, it checks for updates and injects only the new sections into Claude's context. No restart needed.

The file is plain text. Read or edit it any time:
```bash
cat .wyren/memory.md
```

Watch the writing happen live:
```bash
tail -f .wyren/log
```

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and authenticated (`claude auth login`)
- Node.js 20+ and Git on PATH (Node comes bundled with recent Claude Code installs)
- A git remote for the repo you want to track (GitHub, GitLab, or self-hosted)

## Install

```bash
npm install -g @ssm-08/wyren
wyren install
```

Or via one-liner:

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/ssm-08/wyren/master/install.sh | sh
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/ssm-08/wyren/master/install.ps1 | iex
```

Installs via npm, creates a plugin link at `~/.claude/plugins/wyren`, and patches `~/.claude/settings.json` with the three hooks. Idempotent — safe to re-run.

## Init (per repo, one teammate, once)

```bash
cd your-project
wyren init
git add .wyren/ .gitignore
git commit -m "chore: add wyren shared memory"
git push
```

Teammates install the plugin on their machine (`curl | sh` above), then just `git pull`. They don't run `init` again.

## Commands

| Command | What it does |
|---|---|
| `wyren init` | Bootstrap this repo — creates `.wyren/`, seeds `memory.md`, updates `.gitignore`. One teammate, once. |
| `wyren status` | Shows memory file size, when distillation last ran, and git sync state. Run this if memory seems stale. |
| `wyren log [--lines N]` | Tail the Wyren log. Use this to watch distillation and injection events. |
| `wyren distill [--force] [--push]` | Run distillation manually. `--force` skips the signal filter. `--push` commits and pushes the result. Useful after a long session. |
| `wyren broadcast-skill <file>` | Copy skill file to `.wyren/broadcast/skills/` and push to teammates. |
| `wyren install` | Wire hooks on this machine. Called automatically by the one-liners; re-run after a manual npm install. |
| `wyren update` | Update Wyren via npm and re-wire hooks. |
| `wyren uninstall` | Fully remove Wyren from this machine — unhooks, unlinks, uninstalls from npm. |
| `wyren doctor` | Verify the install is healthy. Run this first if something seems wrong. |
| `wyren --version` | Print installed version. |
| `wyren --help` | Show usage. |
| `/wyren-handoff` | Slash command (inside Claude Code): write a handoff note and push it verbatim to `memory.md`. |

## Dev install (from local clone)

```bash
# macOS / Linux — from the wyren repo root
./install.sh --from-local .

# Windows
.\install.ps1 --from-local .
```

Test without touching your real `~/.claude/`:

```bash
node scripts/installer.mjs install --from-local . --home /tmp/fake-home
node scripts/installer.mjs doctor --home /tmp/fake-home
node scripts/installer.mjs uninstall --home /tmp/fake-home
```

## Repo layout

```
├── .claude-plugin/plugin.json      # plugin manifest
├── hooks/
│   ├── session-start.mjs           # reads memory + broadcast, injects as context
│   ├── stop.mjs                    # triggers distiller after N turns
│   └── user-prompt-submit.mjs      # live sync: pulls memory, diffs, injects delta per prompt
├── commands/
│   └── wyren-handoff.toml          # /wyren-handoff slash command
├── bin/wyren.mjs                   # CLI: init | status | distill | install | update | ...
├── install.sh                      # macOS/Linux one-liner installer
├── install.ps1                     # Windows one-liner installer
├── lib/
│   ├── sync.mjs                    # git pull / push / lock
│   ├── transcript.mjs              # reads and slices session transcripts
│   ├── memory.mjs                  # reads and writes memory.md
│   ├── filter.mjs                  # pre-filters transcripts before calling AI
│   └── diff-memory.mjs             # section-aware diff + hash for live sync
├── distiller.mjs                   # background process that rewrites memory.md
├── prompts/distill.md              # the prompt that drives distillation
├── scripts/
│   ├── installer.mjs               # cross-platform install/update/uninstall/doctor logic
│   ├── setup.ps1                   # deprecated stub — forwards to install.ps1
│   └── test-e2e.mjs                # e2e tests — no live Claude session needed
└── docs-site/                      # full documentation (Astro Starlight)
```

## Current limitations

1. **Distillation requires Claude Code authentication.** Wyren calls the `claude` CLI using your existing Claude Code session — no separate API key. Memory reads and injection work offline; distillation and git push require network access. Run `claude auth login` if distillation is being skipped silently. Check `.wyren/log` for the error.

2. **Concurrent pushes retry automatically.** If two teammates distill at the same moment, the second push retries with `pull --rebase`. Resolves within one session without data loss.

3. **Transcript format is Claude Code-specific.** Wyren reads Claude Code's JSONL session files directly. If a future Claude Code update changes that format, distillation may skip some turns until Wyren is updated. Monitor `.wyren/log` if memory stops updating after a Claude Code upgrade.

4. **Tier 0 filter may miss purely conversational decisions.** The filter uses weighted scoring across signal categories (decisions, rejections, hacks, scope changes, maintenance flags) plus structural signals (session length, edit count). Most real work sessions pass automatically. Edge case: design discussions with no signal words (e.g. "let's go with dark mode") may not trigger. Fix: use explicit language or run `wyren distill --force --push` manually.

## Docs

Full documentation, architecture diagrams, cost model, and demo walkthrough:

**[ssm-08.github.io/wyren](https://ssm-08.github.io/wyren/)**

- [Install guide](https://ssm-08.github.io/wyren/reference/install/) — step-by-step install for all platforms
- [The problem](https://ssm-08.github.io/wyren/problem/) — why existing tools fall short
- [How it works](https://ssm-08.github.io/wyren/how-it-works/) — full Alice/Bob walkthrough
- [Architecture](https://ssm-08.github.io/wyren/architecture/) — system diagrams and data flow
- [Cost model](https://ssm-08.github.io/wyren/cost-model/) — what it costs to run
- [Demo script](https://ssm-08.github.io/wyren/demo/) — step-by-step demo guide
- [FAQ](https://ssm-08.github.io/wyren/faq/) — known gotchas and common questions
