---
title: CLI reference
description: Every bin/relay command, flag, and output shape.
---

The `relay` CLI is installed as part of the plugin. It's pure Node, zero deps.

## `relay init`

Bootstrap a repo for Relay.

```bash
relay init [--force]
```

Creates:
- `.relay/memory.md` (empty stub with header)
- `.relay/broadcast/` (empty dir)
- Appends `.relay/state/` and `.relay/log` to `.gitignore`

Verifies:
- `git remote` is configured (warns if not — plugin will run local-only).

`--force` overwrites existing `.relay/memory.md`.

## `relay status`

Print current state.

```bash
relay status
```

Example output:

```
Relay v0.1.0
─────────────────────────────────────
Repo:         /Users/alice/todo-app
Memory:       .relay/memory.md (23 lines, 1.2 KB)
Broadcast:    3 files (frontend-conventions, CLAUDE.md, +1)
Last distill: 4 min ago (session 7a2e-…)
Watermark:    47 / 52 turns processed
Git remote:   origin (push OK)
Sync:         clean (no pending changes)
Lock:         free
Log tail:     .relay/log
```

Exits nonzero if anything is broken (no remote, lock stuck, memory unreadable).

## `relay distill`

Manually trigger a distillation, usually for debugging.

```bash
relay distill                     # run now if signals present
relay distill --force             # skip Tier 0 filter, always call API
relay distill --deep              # use Tier 2 (Sonnet) instead of Tier 1 (Haiku)
relay distill --dry-run           # print what would happen, no writes
relay distill --transcript <path> # override transcript source
```

Writes to `.relay/memory.md` atomically. Pushes via GitSync unless `--no-push`.

## `relay broadcast-skill`

Ship a local skill file to teammates.

```bash
relay broadcast-skill <path> [--name <name>]
```

Examples:

```bash
relay broadcast-skill ./skills/frontend-conventions.md
# ✔ Copied to .relay/broadcast/skills/frontend-conventions.md
# ✔ Committed and pushed

relay broadcast-skill ./team-CLAUDE.md --name CLAUDE.md
# Special: a file named CLAUDE.md lands in .relay/broadcast/CLAUDE.md
# and is treated as authoritative override.
```

## `relay log`

Tail the Relay log.

```bash
relay log              # last 50 lines
relay log -f           # follow (like tail -f)
relay log --since 1h   # lines from last hour
```

## `relay --version`

```bash
relay --version
# relay 0.1.0 (plugin)
```

## `relay --help`

```bash
relay --help
# Shows the full command list with brief descriptions.
```

## Non-zero exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure (message on stderr) |
| 2 | Not initialized (`.relay/` missing) |
| 3 | Git not configured |
| 4 | Distiller failed (check `.relay/log`) |
| 5 | Lock stuck or held by another process |
