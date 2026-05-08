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

```bash
npm install -g wyren
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

This installs Wyren globally via npm, creates a plugin link at `~/.claude/plugins/wyren`, and patches `~/.claude/settings.json` with the `SessionStart`, `Stop`, and `UserPromptSubmit` hooks.

:::note
The installer preserves any existing entries in `settings.json`. It backs up your file before writing.
:::

### Developer / local install

If you already have the repo cloned (e.g. you're contributing to Wyren), pass `--from-local`:

```bash
# macOS / Linux — from the wyren repo root
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
wyren init
```

This creates:

```
.wyren/
├── memory.md               # git-tracked, empty stub
├── broadcast/              # git-tracked (.gitkeep)
│   └── skills/             # git-tracked (.gitkeep)
└── state/                  # NOT tracked — per-machine
```

And appends to `.gitignore`:

```
.wyren/state/
.wyren/log
```

## Step 3 — Commit and push

```bash
git add .wyren .gitignore
git commit -m "Add Wyren shared memory"
git push
```

## Step 4 — Teammates pull

```bash
git pull
```

That's it. Next time anyone opens Claude Code in this repo, the `SessionStart` hook kicks in automatically. Memory injects, background distillation begins, and git syncs the results.

## Verifying the install

```bash
wyren doctor
```

Expected output when everything is wired correctly:

```
[wyren] doctor: all checks passed
```

Or check full state:

```bash
wyren status
```

## Updating

```bash
wyren update
```

Runs `npm update -g wyren`, re-patches `settings.json` if the hook shape changed, and verifies the install.

## Uninstalling

From the machine:

```bash
wyren uninstall
```

Removes: plugin link, Wyren entries from `settings.json`, and global `wyren` CLI registration (`npm uninstall -g wyren`).

From a repo you want to stop tracking:

```bash
rm -rf .wyren
# remove .wyren/state/ and .wyren/log lines from .gitignore
git commit -am "remove Wyren"
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `WYREN_SKIP_PULL` | unset | If set, `GitSync.pull()` returns immediately. Use for offline/local-only demos or slow-network environments. |
| `WYREN_TURNS_THRESHOLD` | `5` | Turn count that triggers automatic distillation. Set to `1` for faster test cycles. |
| `WYREN_IDLE_MS` | `120000` | Idle-time distillation trigger in ms (default 2 min). |
| `WYREN_TIER0_THRESHOLD` | `3` | Minimum score to pass the Tier 0 filter. Lower = more API calls; higher = fewer. |
| `CLAUDE_PLUGIN_ROOT` | set by Claude Code | Where the hook dispatcher looks up `distiller.mjs`. Don't set this yourself. |
| `WYREN_HOME` | `~/.claude/` | Override the Wyren home directory (useful for testing). Takes precedence over `CLAUDE_HOME`. |
| `CLAUDE_HOME` | `~/.claude/` | Alternative home override. Used when `WYREN_HOME` is not set. |

## Troubleshooting

See [FAQ](/faq/) for common issues.

### `wyren` command not found

npm's global bin directory may not be on your PATH. Find it with `npm bin -g` and add it to your shell profile. Or reinstall: `npm install -g wyren`.

### settings.json comments were removed

The installer writes clean JSON. If you had hand-written comments in `settings.json`, they were stripped on install. A timestamped backup was created at `~/.claude/settings.json.wyren-backup-<timestamp>`.

### macOS: "Command Line Tools" dialog on first install

Click "Install" and re-run `install.sh` — this only happens once.
