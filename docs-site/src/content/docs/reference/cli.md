---
title: CLI reference
description: Every bin/relay command and flag — what actually ships.
---

The `relay` CLI is part of the plugin. Pure Node, zero runtime dependencies.

After install, the binary is at `~/.claude/relay/bin/relay.mjs`. If `relay` isn't on your `$PATH`, either invoke it directly (`node ~/.claude/relay/bin/relay.mjs <command>`) or create an alias:

```bash
# bash/zsh
alias relay='node ~/.claude/relay/bin/relay.mjs'

# PowerShell
Set-Alias relay "$env:USERPROFILE\.claude\relay\bin\relay.mjs"
```

## `relay install`

Install Relay hooks on this machine. Called automatically by `install.sh` / `install.ps1` — you rarely need to run this directly.

```bash
relay install [--from-local <path>] [--home <path>] [--dry-run]
```

| Flag | Effect |
|---|---|
| `--from-local <path>` | Use an existing local Relay checkout instead of cloning. Pass `.` from inside the repo. |
| `--home <path>` | Override `~/.claude/` location. Useful for testing without touching your real install. |
| `--dry-run` | Print what would happen. No writes. |
| `--force` | Overwrite a dirty working tree when updating the clone. |

Creates:
- Junction (Windows) or symlink (macOS) at `~/.claude/plugins/relay` → Relay clone.
- `SessionStart` + `Stop` entries in `~/.claude/settings.json` using `${CLAUDE_PLUGIN_ROOT}` form.
- Backs up existing `settings.json` to `settings.json.relay-backup-<timestamp>`.

Idempotent — safe to re-run. Detects and normalises old `setup.ps1`-style absolute-path hook entries.

## `relay update`

Pull the latest Relay from GitHub and re-patch settings if the hook shape changed.

```bash
relay update [--force]
```

Uses `git fetch + reset --hard FETCH_HEAD` (survives force-pushes). `--force` overrides dirty-tree guard.

## `relay uninstall`

Remove Relay hooks from this machine. Preserves `~/.claude/relay/` clone (faster reinstall).

```bash
relay uninstall [--dry-run]
```

Removes plugin link and strips Relay entries from `settings.json`. Foreign hook entries are preserved. To also delete the clone: `relay uninstall && rm -rf ~/.claude/relay`.

## `relay doctor`

Verify the install is healthy.

```bash
relay doctor [--home <path>]
```

Checks:
- Plugin link exists and points to a valid Relay checkout.
- `relay status` exits 0 from the linked directory.
- `settings.json` has exactly one Relay `SessionStart` and one `Stop` entry.
- On POSIX: `hooks/run-hook.cmd` is executable.

Exit codes: `0` all checks passed, `1` one or more issues found (issues printed to stdout).

## `relay init`

Bootstrap a repo for Relay.

```bash
relay init
```

Creates:
- `.relay/memory.md` — empty stub with `# Relay Memory` header
- `.relay/broadcast/` + `.gitkeep` so git tracks the empty dir
- `.relay/broadcast/skills/` + `.gitkeep` so broadcast skills land in a pre-tracked dir
- Appends `.relay/state/` and `.relay/log` to `.gitignore` (creates the file if absent)

**Idempotent.** If `.relay/` already exists, prints `Relay already initialized.` and exits 0 without touching anything.

## `relay status`

Print current memory, watermark, sync, and lock state.

```bash
relay status
```

Example output (actual format):

```
Memory:     .relay/memory.md  (1.2 KB, 23 lines)
Distilled:  2026-04-22T14:30:00.000Z (4 min ago)
Last UUID:  7a2e-...
Watermark:  turns_since_distill=2, distiller_running=false
Transcript: /Users/alice/.claude/projects/.../7a2e.jsonl
Remote:     origin → https://github.com/team/project.git
Lock:       not held
```

If the repo isn't initialized, prints `Relay not initialized in this repo. Run: relay init` and exits 0.

## `relay distill`

Run the distiller manually — useful for debugging, forced updates, or explicit handoff.

```bash
relay distill [--force] [--dry-run] [--push] [--transcript <path>]
```

| Flag | Effect |
|---|---|
| `--force` | Bypass the Tier 0 regex filter — call the API even if no signal words are found. |
| `--dry-run` | Print what would happen. No writes. |
| `--push` | After a successful distill, `git add .relay/` + commit + push via `GitSync`. **Default is no push** — distiller writes `memory.md` locally only. |
| `--transcript <path>` | Override the transcript source. Defaults to the last transcript recorded in the watermark. |

Exit codes: `0` on success, `1` on distiller failure, `2` if `--push` was requested but the sync lock was held by another process.

## `relay broadcast-skill`

Copy a local skill file into `.relay/broadcast/skills/` and push to the team.

```bash
relay broadcast-skill <file>
```

Example:

```bash
relay broadcast-skill ./team-style.md
# Broadcast: .relay/broadcast/skills/team-style.md
# Pushed to remote.
```

The basename of the source file becomes the destination name. Existing files with the same name are overwritten.

Exit codes: `0` on success, `1` if relay isn't initialized / the source file is missing / push fails, `2` if the sync lock is held.

## `/relay-handoff` (slash command)

Not part of the CLI — invoked inside Claude Code:

```
/relay-handoff
```

Claude asks for a handoff note (press Enter to skip), prepends it under a `## Handoff notes` section of `.relay/memory.md`, and pushes. Bypasses the distiller — your text lands verbatim. The command definition lives at `commands/relay-handoff.toml`.

## Environment variables

| Var | Default | Effect |
|---|---|---|
| `RELAY_SKIP_PULL` | unset | If set, `GitSync.pull()` returns immediately. Useful for offline / local-only demos or slow-network environments. |
| `CLAUDE_PLUGIN_ROOT` | set by Claude Code | Where the hook dispatcher looks up `distiller.mjs`. Never set manually. |
| `RELAY_HOME` | `~/.claude/` | Override Relay's home directory. Takes precedence over `CLAUDE_HOME`. Mainly for testing. |
| `CLAUDE_HOME` | `~/.claude/` | Alternative home override when `RELAY_HOME` is unset. |

To disable the plugin temporarily, use `/plugins disable relay` in Claude Code.

## Not yet implemented

These were in early drafts but haven't been wired up:

- `relay log`, `relay --version`, `relay --help` subcommands
- `RELAY_DISABLE` env var for silencing hooks
- `RELAY_MODEL` / `RELAY_DEEP_MODEL` env vars — model is hard-coded to Haiku 4.5 via `--model` arg to `distiller.mjs`
- `RELAY_TURN_THRESHOLD` / `RELAY_IDLE_MS` — thresholds are constants in `hooks/stop.mjs` (5 turns, 2 minutes)
- `--deep` / `--no-push` / `--name` flags
- Automatic Tier 2 Sonnet re-compression on a timer or on `memory.md` size
