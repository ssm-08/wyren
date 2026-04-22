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

The file is plain text. Read or edit it any time:
```bash
cat .relay/memory.md
```

Watch the writing happen live:
```bash
tail -f .relay/log
```

## Install

```
/plugins add ssm-08/relay
```

## Init (per repo, once)

```bash
cd your-project
relay init
git add .relay/memory.md
git commit -m "chore: init relay"
git push
```

_`relay` is the CLI alias — set it up via Dev install below._

Teammates just need the plugin installed. They don't run `init` again.

## Commands

```bash
relay status                          # memory size, last distillation, sync state
relay distill [--force] [--push]      # run distillation manually
relay broadcast-skill <file>          # share a skill file with all teammates

/relay-handoff                        # slash command: write a handoff note and push
```

## Dev install (local symlink)

```bash
# Windows (run as admin, PowerShell)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\plugins\relay" -Target (Get-Location).Path

# macOS / Linux
ln -s "$(pwd)" ~/.claude/plugins/relay
```

## Repo layout

```
├── .claude-plugin/plugin.json      # plugin manifest
├── hooks/
│   ├── session-start.mjs           # reads memory + broadcast, injects as context
│   └── stop.mjs                    # triggers distiller after N turns
├── commands/
│   └── relay-handoff.toml          # /relay-handoff slash command
├── bin/relay.mjs                   # CLI: init | status | distill | broadcast-skill
├── lib/
│   ├── sync.mjs                    # git pull / push / lock
│   ├── transcript.mjs              # reads and slices session transcripts
│   ├── memory.mjs                  # reads and writes memory.md
│   └── filter.mjs                  # pre-filters transcripts before calling AI
├── distiller.mjs                   # background process that rewrites memory.md
├── prompts/distill.md              # the prompt that drives distillation
└── docs-site/                      # full documentation (Astro Starlight)
```

## Known issues

1. **Auth required.** Relay calls AI using your existing Claude Code login — no separate API key. If you're not signed in (`claude auth login`), distillation is skipped. Memory injection still works; only writes are blocked.

2. **Push conflicts.** If two teammates distill at the same moment and both try to push, the second one retries automatically with the latest version. In practice it resolves within one session without losing anything.

3. **Claude Code transcript format.** Relay reads Claude Code's session files directly. If a future Claude Code update changes that format, distillation may skip some turns until Relay is updated. Check `.relay/log` if memory stops updating.

## Docs

Full documentation, architecture diagrams, cost model, and demo walkthrough:

**[ssm-08.github.io/relay](https://ssm-08.github.io/relay/)**

- [The problem](https://ssm-08.github.io/relay/problem/) — why existing tools fall short
- [How it works](https://ssm-08.github.io/relay/how-it-works/) — full Alice/Bob walkthrough
- [Architecture](https://ssm-08.github.io/relay/architecture/) — system diagrams and data flow
- [Cost model](https://ssm-08.github.io/relay/cost-model/) — what it costs to run
- [Demo script](https://ssm-08.github.io/relay/demo/) — step-by-step demo guide
- [FAQ](https://ssm-08.github.io/relay/faq/) — known gotchas and common questions
