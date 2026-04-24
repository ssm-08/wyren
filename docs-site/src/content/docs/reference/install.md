---
title: Install
description: One-liner install. Two minutes. One shared brain.
---

## Prerequisites

- Claude Code installed on every teammate's machine.
- Git remote for the target repo (GitHub, GitLab, or self-hosted — any works).
- Node.js 20+ and Git on PATH (bundled with recent Claude Code installs).

## Step 1 — Install the plugin

Every teammate runs once on their machine:

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/ssm-08/relay/master/install.sh | sh
```

**Windows (PowerShell):**

```powershell
iwr -useb https://raw.githubusercontent.com/ssm-08/relay/master/install.ps1 | iex
```

This clones Relay to `~/.claude/relay/`, creates a plugin link, and patches `~/.claude/settings.json` with the `SessionStart` and `Stop` hooks.

:::note
The installer preserves any existing entries in `settings.json`. It backs up your file before writing.
:::

### Developer / local install

If you already have the repo cloned (e.g. you're contributing to Relay), pass `--from-local`:

```bash
# macOS / Linux — from the relay repo root
./install.sh --from-local .

# Windows
.\install.ps1 --from-local .

# Or directly via Node (any OS):
node scripts/installer.mjs install --from-local .
```

### Testing without touching your real `~/.claude/`

```bash
# macOS / Linux
node scripts/installer.mjs install --from-local . --home /tmp/fake-home
node scripts/installer.mjs doctor --home /tmp/fake-home
node scripts/installer.mjs uninstall --home /tmp/fake-home

# Windows
node scripts/installer.mjs install --from-local . --home "$env:TEMP\fake-home"
```

## Step 2 — Initialize the repo

One teammate, once per repo:

```bash
cd <your-repo>
relay init
```

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

That's it. Next time anyone opens Claude Code in this repo, the `SessionStart` hook kicks in automatically. Memory injects, background distillation begins, and git syncs the results.

## Verifying the install

```bash
relay doctor
```

Expected output when everything is wired correctly:

```
[relay] doctor: all checks passed
```

Or check full state:

```bash
relay status
```

## Updating

```bash
relay update
```

Pulls the latest Relay from GitHub, re-patches `settings.json` if the hook shape changed, and verifies the install.

## Uninstalling

From the machine:

```bash
relay uninstall
```

Removes: plugin link, Relay entries from `settings.json`, global `relay` CLI registration, and the `~/.claude/relay/` clone.

From a repo you want to stop tracking:

```bash
rm -rf .relay
# remove .relay/state/ and .relay/log lines from .gitignore
git commit -am "remove Relay"
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `RELAY_SKIP_PULL` | unset | If set, `GitSync.pull()` returns immediately. Use for offline/local-only demos or slow-network environments. |
| `RELAY_TURNS_THRESHOLD` | `5` | Turn count that triggers automatic distillation. Set to `1` for faster test cycles. |
| `RELAY_IDLE_MS` | `120000` | Idle-time distillation trigger in ms (default 2 min). |
| `RELAY_TIER0_THRESHOLD` | `3` | Minimum score to pass the Tier 0 filter. Lower = more API calls; higher = fewer. |
| `CLAUDE_PLUGIN_ROOT` | set by Claude Code | Where the hook dispatcher looks up `distiller.mjs`. Don't set this yourself. |
| `RELAY_HOME` | `~/.claude/` | Override the Relay home directory (useful for testing). Takes precedence over `CLAUDE_HOME`. |
| `CLAUDE_HOME` | `~/.claude/` | Alternative home override. Used when `RELAY_HOME` is not set. |

## Troubleshooting

See [FAQ](/faq/) for common issues.

### `relay` command not found

Add an alias:

```bash
# bash/zsh
alias relay='node ~/.claude/relay/bin/relay.mjs'

# PowerShell
Set-Alias relay "$env:USERPROFILE\.claude\relay\bin\relay.mjs"
```

### settings.json comments were removed

The installer writes clean JSON. If you had hand-written comments in `settings.json`, they were stripped on install. A timestamped backup was created at `~/.claude/settings.json.relay-backup-<timestamp>`.

### macOS: "Command Line Tools" dialog on first install

Click "Install" and re-run `install.sh` — this only happens once.
