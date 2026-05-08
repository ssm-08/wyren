---
title: Chunk 2 — Plugin skeleton + injection
description: Hours 6-14. Install the plugin, inject memory at SessionStart. No distiller, no git.
---

import { Badge } from '@astrojs/starlight/components';

<Badge text="Shipped" variant="success" />

## Goal

Plugin hooks wired in `~/.claude/settings.json`. `SessionStart` hook reads `.wyren/memory.md` and emits it as `additionalContext`. No distiller wired yet, no git sync yet — just the injection pipe.

## Files shipped

| File | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Plugin metadata (name, version, author, repo) |
| `hooks/hooks.json` | Hook definitions — SessionStart + Stop → `run-hook.cmd` |
| `hooks/run-hook.cmd` | Windows/Unix polyglot: finds `node`, runs `.mjs` hook |
| `hooks/session-start.mjs` | Reads memory.md + broadcast/, emits `additionalContext` |
| `hooks/stop.mjs` | Stub — increments watermark turn counter only |
| `bin/wyren.mjs` | CLI: `wyren init` creates `.wyren/` structure |
| `lib/util.mjs` | Shared `readStdin` + `isMain` helpers |

## How injection works

```
Claude Code fires SessionStart
  → run-hook.cmd session-start
    → node hooks/session-start.mjs
      → reads .wyren/memory.md
      → reads .wyren/broadcast/* (skips .gitkeep)
      → emits JSON to stdout:
        {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
  → Claude receives memory as hidden context before first message
```

## Install

Plugin hooks are wired via `install.sh` / `install.ps1` (see [Install guide](/reference/install/)).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/ssm-08/wyren/master/install.sh | sh

# Windows
iwr -useb https://raw.githubusercontent.com/ssm-08/wyren/master/install.ps1 | iex
```

## Init (per repo)

```bash
wyren init
git add .wyren/memory.md .gitignore
git commit -m "chore: init wyren"
git push
```

## Manual memory seeding

Until Chunk 3 wires the distiller, edit `.wyren/memory.md` directly:

```markdown
# Wyren Memory

## Decisions
- Use SQLite (rejected Postgres — too heavy)

## Live workarounds
- user_id hardcoded to 1 in /dashboard [session abc1, turn 3]
```

Every teammate's next session starts with this context injected silently.

## Exit criteria ✅

- Plugin installs cleanly, hooks fire, injection works in a fresh Claude Code session.
- Editing `memory.md` is reflected in the next session.
- SessionStart hook completes in under 500ms.
- 17 unit tests pass.

## What's next — Chunk 3

`stop.mjs` stub becomes real: spawns `distiller.mjs` detached after 5 turns. Tier 0 regex filter skips ~70% of triggers. Memory updates live during a session without any manual editing.

[Chunk 3 detail →](/roadmap/3-distillation/)
