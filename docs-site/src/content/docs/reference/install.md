---
title: Install
description: Five commands. Two minutes. One shared brain.
---

## Prerequisites

- Claude Code installed on every teammate's machine.
- Git remote for the target repo (GitHub, GitLab, or self-hosted — any works).
- Node.js 20+ (bundled with recent Claude Code installs).

## Step 1 — Install the plugin

Every teammate runs once:

```bash
claude /plugins add https://github.com/ssm-08/relay
```

This installs `~/.claude/plugins/relay/` and registers the `SessionStart` + `Stop` hooks automatically.

Verify:

```bash
claude /plugins list
# should show: relay v0.1.0
```

## Step 2 — Initialize the repo

One teammate, once per repo:

```bash
cd <your-repo>
relay init
```

_`relay` is the CLI alias. After `/plugins add`, the binary is at `~/.claude/plugins/relay/bin/relay.mjs`. If that path isn't on your `$PATH`, use the full path — e.g. `node ~/.claude/plugins/relay/bin/relay.mjs init`. Or set up an alias (see [Dev install](#dev-install) below)._

This creates:

```
.relay/
├── memory.md               # git-tracked, empty stub
├── broadcast/              # git-tracked (.gitkeep)
│   └── skills/             # git-tracked (.gitkeep)
└── state/                  # NOT tracked — per-machine
```

And appends to `.gitignore`:

```
.relay/state/
.relay/log
```

## Step 3 — Commit and push

```bash
git add .relay .gitignore
git commit -m "Add Relay shared memory"
git push
```

## Step 4 — Teammates pull

```bash
git pull
```

That's it. Next time anyone opens Claude Code in this repo, `SessionStart` hook kicks in automatically. Memory injects, background distillation begins, git syncs the results.

## Verifying the install

```bash
relay status
```

Example output:

```
Memory:     .relay/memory.md  (1.2 KB, 23 lines)
Distilled:  2026-04-22T14:30:00.000Z (4 min ago)
Last UUID:  7a2e-...
Watermark:  turns_since_distill=2, distiller_running=false
Transcript: /Users/alice/.claude/projects/.../7a2e.jsonl
Remote:     origin → https://github.com/team/project.git
Lock:       not held
```

## Dev install

If you're iterating on the plugin locally (or just want `relay` on your `$PATH` for shell convenience), symlink the checkout into the plugins directory:

```bash
# Windows (PowerShell, run as Admin)
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.claude\plugins\relay" `
  -Target (Get-Location).Path

# macOS / Linux
ln -s "$(pwd)" ~/.claude/plugins/relay
```

Then add an alias (optional):

```bash
# bash/zsh
alias relay='node ~/.claude/plugins/relay/bin/relay.mjs'

# PowerShell
Set-Alias relay "$env:USERPROFILE\.claude\plugins\relay\bin\relay.mjs"
```

## Uninstall

```
/plugins remove relay
```

In a repo you want to stop tracking:

```bash
rm -rf .relay
# remove .relay/state/ and .relay/log lines from .gitignore
git commit -am "remove Relay"
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `RELAY_SKIP_PULL` | unset | If set, `GitSync.pull()` returns immediately. Use for offline/local-only demos or slow-network environments. |
| `CLAUDE_PLUGIN_ROOT` | set by Claude Code | Where the hook dispatcher looks up `distiller.mjs`. Don't set this yourself. |

Other env vars from early drafts (`RELAY_MODEL`, `RELAY_DISABLE`, `RELAY_TURN_THRESHOLD`, etc.) are not wired up — see [CLI reference → Not yet implemented](/reference/cli/#not-yet-implemented).

## Troubleshooting

See [FAQ](/faq/) for common issues.
