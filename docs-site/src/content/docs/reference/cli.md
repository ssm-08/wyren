---
title: CLI reference
description: Every bin/relay command and flag — what actually ships.
---

The `relay` CLI is part of the plugin. Pure Node, zero runtime dependencies.

`relay install` registers the CLI globally via `npm install -g .` — `relay <command>` works from any directory after install. If for some reason `relay` isn't on PATH (e.g. `npm`'s global bin isn't in your shell's PATH), invoke directly:

```bash
node ~/.claude/relay/bin/relay.mjs <command>
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
- `SessionStart`, `Stop`, and `UserPromptSubmit` entries in `~/.claude/settings.json` using the absolute path to the Relay clone (not `${CLAUDE_PLUGIN_ROOT}` — that variable only expands inside a plugin's own `hooks.json`, not in `settings.json`).
- Backs up existing `settings.json` to `settings.json.relay-backup-<timestamp>`.
- Registers the `relay` CLI globally via `npm install -g .` so `relay <command>` works from any directory.

Idempotent — safe to re-run. Detects and normalises stale hook entries from previous installs.

## `relay update`

Pull the latest Relay from GitHub and re-patch settings if the hook shape changed.

```bash
relay update [--force]
```

Uses `git fetch + reset --hard FETCH_HEAD` (survives force-pushes). `--force` overrides dirty-tree guard.

## `relay uninstall`

Fully remove Relay from this machine.

```bash
relay uninstall [--dry-run]
```

Removes:
- Plugin link at `~/.claude/plugins/relay`
- Relay hook entries from `settings.json` (foreign entries preserved)
- Global `relay` CLI registration (`npm uninstall -g relay`)
- Relay clone at `~/.claude/relay/`

After uninstall, `relay` is gone from PATH. Open a new terminal to confirm.

## `relay doctor`

Verify the install is healthy.

```bash
relay doctor [--home <path>]
```

Checks:
- Plugin link exists and points to a valid Relay checkout.
- `relay status` exits 0 from the linked directory.
- `settings.json` has exactly one Relay `SessionStart`, `Stop`, and `UserPromptSubmit` entry each.
- On POSIX: `hooks/run-hook.cmd` is executable.

Exit codes: `0` all checks passed, `1` one or more issues found (issues printed to stdout).

## `relay init`

Bootstrap a repo for Relay.

```bash
relay init
```

Creates:
- `.relay/memory.md` — seeded from `CLAUDE.md` if present in the repo root (first 8 KB, one-time import, not kept in sync); otherwise an empty `# Relay Memory` stub
- `.relay/broadcast/` + `.gitkeep` so git tracks the empty dir
- `.relay/broadcast/skills/` + `.gitkeep` so broadcast skills land in a pre-tracked dir
- Appends `.relay/state/` and `.relay/log` to `.gitignore` (creates the file if absent)

**Idempotent.** If `.relay/` already exists, prints `Relay already initialized.` and exits 0 without touching anything.

## `relay status`

Print current memory, distillation, injection, sync, and lock state.

```bash
relay status
```

Example output (actual format):

```
Memory:     .relay/memory.md  (1.2 KB, 23 lines)
Distilled:  2026-04-22T14:30:00.000Z (4 min ago)
Last UUID:  7a2e-...
Progress:   2 / 5 turns until next distill
Injected:  2026-04-22T14:31:00.000Z (3 min ago via session-start)
Transcript: /Users/alice/.claude/projects/.../7a2e.jsonl
Remote:     origin → https://github.com/team/project.git
```

Lock line only appears when the lock is held (`Lock:  held (3s old)`). Not shown in normal state.

`Distilled`/`Progress` fields come from `.relay/state/watermark.json`. `Injected` is derived from the latest `injection:` event in `.relay/log`.

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

## `relay log`

Tail the Relay log — useful for debugging distillation and injection flow.

```bash
relay log [--lines <n>]
```

| Flag | Effect |
|---|---|
| `--lines <n>` / `-n <n>` | Number of lines to show from the end of the log (default `50`). |

Reads `.relay/log` in the current repo. If the log exceeds the line limit, prints an omission notice first so you know lines were cut. If no log exists yet, prints a short message and exits 0.

## `relay --version`

Print the installed Relay version.

```bash
relay --version   # or: relay -v
```

Reads `version` from `package.json` in the Relay installation. Example output:

```
relay 0.4.0
```

## `relay --help`

Print the command reference and exit 0.

```bash
relay --help   # or: relay -h
```

Running `relay` with no arguments also shows help (exit 0). Running `relay <unknown>` shows `relay: unknown command '<unknown>'` followed by help, then exits 1.

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
| `RELAY_TURNS_THRESHOLD` | `5` | Override the turn count that triggers automatic distillation. Set to `1` for faster test cycles. Unset to restore the default. |
| `RELAY_IDLE_MS` | `120000` | Override the idle-time trigger window in milliseconds (default 2 min). E.g. `30000` for 30-second idle trigger during testing. |
| `RELAY_TIER0_THRESHOLD` | `3` | Minimum score for a transcript slice to pass the Tier 0 filter. Lower values distill more aggressively; raise to reduce API calls on noisy repos. |
| `CLAUDE_PLUGIN_ROOT` | set by Claude Code | Where the hook dispatcher looks up `distiller.mjs`. Never set manually. |
| `RELAY_HOME` | `~/.claude/` | Override Relay's home directory. Takes precedence over `CLAUDE_HOME`. Mainly for testing. |
| `CLAUDE_HOME` | `~/.claude/` | Alternative home override when `RELAY_HOME` is unset. |

To disable the plugin temporarily, use `/plugins disable relay` in Claude Code.

## Not yet implemented

These were in early drafts but haven't been wired up:

- `RELAY_DISABLE` env var for silencing hooks
- `RELAY_MODEL` / `RELAY_DEEP_MODEL` env vars — model is hard-coded to Haiku 4.5 via `--model` arg to `distiller.mjs`
- `--deep` / `--no-push` / `--name` flags
- Automatic Tier 2 Sonnet re-compression on a timer or on `memory.md` size
