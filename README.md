# Relay

Shared brain for teams using Claude Code. One memory, every session warm.

> Multiple humans. One brain. Zero workflow change.

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

_`relay` is the CLI alias — set it up first via Dev install below (symlink or PATH)._

Teammates just need the plugin installed — they don't run `init` again.

## How it works

Claude Code starts every session fresh — no memory of what came before. For a team, this breaks down fast: two people's Claudes give conflicting advice because neither knows what the other decided, what failed, or what shortcuts are still in the code.

Relay keeps a shared notepad in your git repo: a file called `.relay/memory.md`. Every session reads from it at startup. Every session writes to it while you work.

**Reading** — at the start of every session, Relay pulls the latest `.relay/memory.md` from git and quietly feeds it to Claude before you type anything. Claude already knows the context.

**Writing** — while you work, Relay watches your conversation in the background. After every few turns it pulls out what matters — decisions made, approaches that didn't pan out, temporary hacks — rewrites the file, and pushes it to git. You never notice it happening.

The file is plain text. Read or edit it any time:
```bash
cat .relay/memory.md
```

Watch the writing happen live:
```bash
tail -f .relay/log
```

## Commands

```bash
# Check memory size, last distillation, git sync, lock state
relay status

# Trigger distillation manually (e.g. before handing off)
relay distill [--transcript <path>] [--force] [--dry-run] [--push]

# Broadcast a skill file to all teammates (injected at their next SessionStart)
relay broadcast-skill <file>

# Slash command (inside Claude Code)
/relay-handoff    # write a manual handoff note and push immediately
```

## Demo (4 minutes)

**Setup:** two laptops, same repo, git remote configured.

**Laptop A:**
```bash
cd your-project
relay init
git add .relay && git commit -m "chore: init relay" && git push
```
Open Claude Code. Discuss the stack — pick SQLite, reject Postgres (too heavy), add a `user_id=1` workaround for fast iteration. After 5 turns:
```bash
cat .relay/memory.md    # SQLite decision, Postgres rejection, workaround noted
```

**Laptop B — fresh session:**
Open Claude Code. Ask: *"What's the state of this project?"*

Claude's **first message** names SQLite, mentions the rejected Postgres, flags `user_id=1` — without you saying a word.

**Broadcast a skill:**
```bash
relay broadcast-skill ./my-style-guide.md
```
Open Laptop A in a new session. Claude says: *"Loaded 1 team skill: `my-style-guide`."*

**The pitch:** Multiple humans, one brain, zero workflow change.

## Dev install (local symlink)

```bash
# Windows (run as admin, PowerShell)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\plugins\relay" -Target (Get-Location).Path

# macOS / Linux
ln -s "$(pwd)" ~/.claude/plugins/relay
```

## Repo layout

```
├── .claude-plugin/plugin.json      # Claude Code plugin manifest
├── hooks/
│   ├── hooks.json                  # SessionStart + Stop registrations
│   ├── session-start.mjs           # injects memory.md + broadcast as additionalContext
│   └── stop.mjs                    # watermark + detached distiller spawn
├── commands/
│   └── relay-handoff.toml          # /relay-handoff slash command
├── bin/relay.mjs                   # CLI: init | status | distill | broadcast-skill
├── lib/
│   ├── sync.mjs                    # GitSync — pull, push, lock
│   ├── transcript.mjs              # JSONL parse + slice + render
│   ├── memory.mjs                  # atomic memory.md read/write
│   └── filter.mjs                  # Tier 0 regex signal filter
├── distiller.mjs                   # standalone distiller (Haiku 4.5 default)
├── prompts/distill.md              # distiller system prompt
└── docs-site/                      # Astro Starlight documentation
```

## Known issues

1. **Auth required.** The plugin uses `claude -p` headless mode, which requires the user to be authenticated with Claude Code (`claude auth login`). No separate API key needed, but unauthenticated machines skip distillation — memory injection still works, only writes are blocked.

2. **Rare rebase conflict on simultaneous push.** If two teammates distill at the exact same time and both push, the second gets a rebase conflict. The plugin detects this, advances local HEAD to the remote version, and queues a fresh distillation on the next 5 turns. In practice this resolves within one session without data loss.

3. **Transcript version pinning.** The distiller reads Claude Code's JSONL transcript format. If Claude Code changes its transcript schema, distillation may silently skip turns it can't parse. The plugin logs skipped turns to `.relay/log`. Verified against Claude Code ≥ 1.x (`"version":"2.1.117"` format).
