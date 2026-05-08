---
title: CLI reference
description: Every bin/wyren command and flag — what actually ships.
---

The `wyren` CLI is part of the plugin. Pure Node, zero runtime dependencies. Installed globally via `npm install -g @ssm-08/wyren`.

If `wyren` isn't on PATH (e.g. npm's global bin directory isn't in your shell's PATH), find the path with `npm bin -g` and add it, or invoke directly:

```bash
node "$(npm root -g)/@ssm-08/wyren/bin/wyren.mjs" <command>
```

## `wyren install`

Install Wyren hooks on this machine. Called automatically by `install.sh` / `install.ps1` — you rarely need to run this directly.

```bash
wyren install [--from-local <path>] [--home <path>] [--dry-run]
```

| Flag | Effect |
|---|---|
| `--from-local <path>` | Use a local Wyren checkout instead of the npm package. Pass `.` from inside the repo. |
| `--home <path>` | Override `~/.claude/` location. Useful for testing without touching your real install. |
| `--dry-run` | Print what would happen. No writes. |

Creates:
- Junction (Windows) or symlink (macOS) at `~/.claude/plugins/wyren` → npm package dir.
- `SessionStart`, `Stop`, and `UserPromptSubmit` entries in `~/.claude/settings.json` using the absolute path to the package (not `${CLAUDE_PLUGIN_ROOT}` — that variable only expands inside a plugin's own `hooks.json`, not in `settings.json`).
- Backs up existing `settings.json` to `settings.json.wyren-backup-<timestamp>`.

Idempotent — safe to re-run. Detects and normalises stale hook entries from previous installs.

## `wyren update`

Update Wyren to the latest npm version and re-wire hooks.

```bash
wyren update
```

Runs `npm update -g @ssm-08/wyren`, re-patches `settings.json`, and verifies the install. For `--from-local` dev installs, update your checkout manually and re-run `wyren install --from-local <path>`.

## `wyren uninstall`

Fully remove Wyren from this machine.

```bash
wyren uninstall [--dry-run]
```

Removes:
- Plugin link at `~/.claude/plugins/wyren`
- Wyren hook entries from `settings.json` (foreign entries preserved)
- Global `wyren` CLI registration (`npm uninstall -g @ssm-08/wyren`)

After uninstall, `wyren` is gone from PATH. Open a new terminal to confirm.

## `wyren doctor`

Verify the install is healthy.

```bash
wyren doctor [--home <path>]
```

Checks:
- Plugin link exists and points to a valid Wyren checkout.
- `wyren status` exits 0 from the linked directory.
- `settings.json` has exactly one Wyren `SessionStart`, `Stop`, and `UserPromptSubmit` entry each.
- On POSIX: `hooks/run-hook.cmd` is executable.

Exit codes: `0` all checks passed, `1` one or more issues found (issues printed to stdout).

## `wyren init`

Bootstrap a repo for Wyren.

```bash
wyren init
```

Creates:
- `.wyren/memory.md` — seeded from `CLAUDE.md` if present in the repo root (first 8 KB, one-time import, not kept in sync); otherwise an empty `# Wyren Memory` stub
- `.wyren/broadcast/` + `.gitkeep` so git tracks the empty dir
- `.wyren/broadcast/skills/` + `.gitkeep` so broadcast skills land in a pre-tracked dir
- Appends `.wyren/state/` and `.wyren/log` to `.gitignore` (creates the file if absent)

**Idempotent.** If `.wyren/` already exists, prints `Wyren already initialized.` and exits 0 without touching anything.

## `wyren status`

Print current memory, distillation, injection, sync, and lock state.

```bash
wyren status
```

Example output (actual format):

```
Memory:     .wyren/memory.md  (1.2 KB, 23 lines)
Distilled:  2026-04-22T14:30:00.000Z (4 min ago)
Last UUID:  7a2e-...
Progress:   2 / 5 turns until next distill
Injected:  2026-04-22T14:31:00.000Z (3 min ago via session-start)
Transcript: /Users/alice/.claude/projects/.../7a2e.jsonl
Remote:     origin → https://github.com/team/project.git
```

Lock line only appears when the lock is held (`Lock:  held (3s old)`). Not shown in normal state.

`Distilled`/`Progress` fields come from `.wyren/state/watermark.json`. `Injected` is derived from the latest `injection:` event in `.wyren/log`.

If the repo isn't initialized, prints `Wyren not initialized in this repo. Run: wyren init` and exits 0.

## `wyren distill`

Run the distiller manually — useful for debugging, forced updates, or explicit handoff.

```bash
wyren distill [--force] [--dry-run] [--push] [--transcript <path>]
```

| Flag | Effect |
|---|---|
| `--force` | Bypass the Tier 0 regex filter — call the API even if no signal words are found. |
| `--dry-run` | Print what would happen. No writes. |
| `--push` | After a successful distill, `git add .wyren/` + commit + push via `GitSync`. **Default is no push** — distiller writes `memory.md` locally only. |
| `--transcript <path>` | Override the transcript source. Defaults to the last transcript recorded in the watermark. |

Exit codes: `0` on success, `1` on distiller failure, `2` if `--push` was requested but the sync lock was held by another process.

## `wyren log`

Tail the Wyren log — useful for debugging distillation and injection flow.

```bash
wyren log [--lines <n>]
```

| Flag | Effect |
|---|---|
| `--lines <n>` / `-n <n>` | Number of lines to show from the end of the log (default `50`). |

Reads `.wyren/log` in the current repo. If the log exceeds the line limit, prints an omission notice first so you know lines were cut. If no log exists yet, prints a short message and exits 0.

## `wyren --version`

Print the installed Wyren version.

```bash
wyren --version   # or: wyren -v
```

Reads `version` from `package.json` in the Wyren installation. Example output:

```
wyren 0.4.0
```

## `wyren --help`

Print the command reference and exit 0.

```bash
wyren --help   # or: wyren -h
```

Running `wyren` with no arguments also shows help (exit 0). Running `wyren <unknown>` shows `wyren: unknown command '<unknown>'` followed by help, then exits 1.

## `wyren broadcast-skill`

Copy a local skill file into `.wyren/broadcast/skills/` and push to the team.

```bash
wyren broadcast-skill <file>
```

Example:

```bash
wyren broadcast-skill ./team-style.md
# Broadcast: .wyren/broadcast/skills/team-style.md
# Pushed to remote.
```

The basename of the source file becomes the destination name. Existing files with the same name are overwritten.

Exit codes: `0` on success, `1` if wyren isn't initialized / the source file is missing / push fails, `2` if the sync lock is held.

## `/wyren-handoff` (slash command)

Not part of the CLI — invoked inside Claude Code:

```
/wyren-handoff
```

Claude asks for a handoff note (press Enter to skip), prepends it under a `## Handoff notes` section of `.wyren/memory.md`, and pushes. Bypasses the distiller — your text lands verbatim. The command definition lives at `commands/wyren-handoff.toml`.

## Environment variables

| Var | Default | Effect |
|---|---|---|
| `WYREN_SKIP_PULL` | unset | If set, `GitSync.pull()` returns immediately. Useful for offline / local-only demos or slow-network environments. |
| `WYREN_TURNS_THRESHOLD` | `5` | Override the turn count that triggers automatic distillation. Set to `1` for faster test cycles. Unset to restore the default. |
| `WYREN_IDLE_MS` | `120000` | Override the idle-time trigger window in milliseconds (default 2 min). E.g. `30000` for 30-second idle trigger during testing. |
| `WYREN_TIER0_THRESHOLD` | `3` | Minimum score for a transcript slice to pass the Tier 0 filter. Lower values distill more aggressively; raise to reduce API calls on noisy repos. |
| `CLAUDE_PLUGIN_ROOT` | set by Claude Code | Where the hook dispatcher looks up `distiller.mjs`. Never set manually. |
| `WYREN_HOME` | `~/.claude/` | Override Wyren's home directory. Takes precedence over `CLAUDE_HOME`. Mainly for testing. |
| `CLAUDE_HOME` | `~/.claude/` | Alternative home override when `WYREN_HOME` is unset. |

To disable the plugin temporarily, use `/plugins disable wyren` in Claude Code.

## Not yet implemented

These were in early drafts but haven't been wired up:

- `WYREN_DISABLE` env var for silencing hooks
- `WYREN_MODEL` / `WYREN_DEEP_MODEL` env vars — model is hard-coded to Haiku 4.5 via `--model` arg to `distiller.mjs`
- `--deep` / `--no-push` / `--name` flags
- Automatic Tier 2 Sonnet re-compression on a timer or on `memory.md` size
