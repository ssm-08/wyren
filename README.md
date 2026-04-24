# Relay

Shared brain for teams using Claude Code. One memory, every session warm.

> **Git made code collaboration possible. Relay does the same for the AI working alongside your team.**

## The problem

Every Claude Code session starts blank. On a team this breaks down fast: each person's Claude gives conflicting advice because it doesn't know what was decided yesterday, what approaches failed, or what shortcuts are still in the code. You spend the first 10 minutes of every session re-briefing an AI that should already know.

The core insight: the problem isn't that Claude forgets — it's that Claude never knew in the first place.

## Why not CLAUDE.md?

`CLAUDE.md` is written by hand. It captures what you choose to document — usually the final decision, rarely the reasoning behind it. It doesn't update on its own, it doesn't know what your teammates did, and it doesn't capture the things nobody has time to write down at the moment they matter most.

|  | Updates automatically | Captures reasoning | Syncs across teammates |
|---|---|---|---|
| `CLAUDE.md` | ❌ | ❌ | ✅ (if committed) |
| Claude Projects | ❌ | ❌ | ✅ |
| **Relay** | ✅ | ✅ | ✅ |

Relay is what `CLAUDE.md` would be if it wrote itself.

## How it works

Relay keeps a shared file in your git repo: `.relay/memory.md`. Every session reads from it at startup. Every session writes to it while you work.

**Reading** — at session start, Relay pulls the latest `.relay/memory.md` from git and quietly feeds it to Claude before you type anything. Claude already knows the context.

**Writing** — while you work, Relay watches your conversation in the background. After every few turns it pulls out what matters — decisions made, approaches that didn't pan out, temporary hacks — rewrites the file, and pushes it to git. You never notice it happening.

**Live sync** — if a teammate pushes new memory while your session is already open, Relay picks it up automatically. Before each prompt you send, it checks for updates and injects only the new sections into Claude's context. No restart needed.

The file is plain text. Read or edit it any time:
```bash
cat .relay/memory.md
```

Watch the writing happen live:
```bash
tail -f .relay/log
```

## Install

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/ssm-08/relay/master/install.sh | sh
```

**Windows (PowerShell):**

```powershell
iwr -useb https://raw.githubusercontent.com/ssm-08/relay/master/install.ps1 | iex
```

Clones Relay to `~/.claude/relay/`, wires the hooks, and registers `relay` on PATH via `npm install -g`. Idempotent — safe to re-run.

## Init (per repo, once)

```bash
cd your-project
relay init
git add .relay .gitignore
git commit -m "chore: init relay"
git push
```

Teammates just need the plugin installed. They don't run `init` again.

## Commands

```bash
relay init                            # bootstrap this repo (.relay/, .gitignore entries)
relay status                          # memory size, last distillation, sync state
relay log [--lines N]                 # tail distiller log (default 50 lines)
relay distill [--force] [--push]      # run distillation manually
relay broadcast-skill <file>          # share a skill file with all teammates
relay install                         # install hooks on a new machine (called by install.sh/ps1)
relay update                          # pull latest Relay from GitHub
relay uninstall                       # fully remove Relay from this machine
relay doctor                          # verify install is working
relay --version                       # print relay version
relay --help                          # show usage

/relay-handoff                        # slash command: write a handoff note and push
```

## Dev install (from local clone)

```bash
# macOS / Linux — from the relay repo root
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
│   └── relay-handoff.toml          # /relay-handoff slash command
├── bin/relay.mjs                   # CLI: init | status | distill | install | update | ...
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

## Known issues

1. **Auth required.** Relay calls AI using your existing Claude Code login — no separate API key. If you're not signed in (`claude auth login`), distillation is skipped. Memory injection still works; only writes are blocked.

2. **Push conflicts.** If two teammates distill at the same moment and both try to push, the second one retries automatically with the latest version. In practice it resolves within one session without losing anything.

3. **Claude Code transcript format.** Relay reads Claude Code's session files directly. If a future Claude Code update changes that format, distillation may skip some turns until Relay is updated. Check `.relay/log` if memory stops updating.

4. **Tier 0 filter may miss purely conversational decisions.** The filter uses weighted scoring across signal categories (decisions, rejections, hacks, scope changes, maintenance flags) plus structural signals (session length, edit count). Most real work sessions pass. Edge case: design choices with no signal words (e.g. "let's go with dark mode") may not trigger. Workaround: use explicit language or run `relay distill --force --push` manually.

## Docs

Full documentation, architecture diagrams, cost model, and demo walkthrough:

**[ssm-08.github.io/relay](https://ssm-08.github.io/relay/)**

- [The problem](https://ssm-08.github.io/relay/problem/) — why existing tools fall short
- [How it works](https://ssm-08.github.io/relay/how-it-works/) — full Alice/Bob walkthrough
- [Architecture](https://ssm-08.github.io/relay/architecture/) — system diagrams and data flow
- [Cost model](https://ssm-08.github.io/relay/cost-model/) — what it costs to run
- [Demo script](https://ssm-08.github.io/relay/demo/) — step-by-step demo guide
- [FAQ](https://ssm-08.github.io/relay/faq/) — known gotchas and common questions
