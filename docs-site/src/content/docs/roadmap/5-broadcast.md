---
title: Chunk 5 — Broadcast + polish + demo
description: Hours 32-44. Skills/CLAUDE.md broadcast, /relay-handoff, README, demo rehearsal.
---

**Status: ✅ shipped.** `relay broadcast-skill` CLI live. Session-start appends an acknowledgment instruction when broadcast skills are present. `/relay-handoff` slash command ships. 46 unit tests green.

## Goal

Ship the wow-moment demo feature (skill broadcast), add a manual handoff escape hatch, polish README + known issues, rehearse the demo.

## Files (as shipped)

| File | Purpose |
|---|---|
| `hooks/session-start.mjs` | Counts non-`.gitkeep` files in `.relay/broadcast/skills/` and appends an acknowledgment instruction when any exist |
| `commands/relay-handoff.toml` | `/relay-handoff` slash command — writes a handoff note and pushes |
| `bin/relay.mjs` | Added `relayBroadcastSkill(targetDir, filePath)` + `broadcast-skill` CLI subcommand |
| `tests/broadcast-skill.test.mjs` | 6 unit tests for the copy logic (null guards, overwrite, dir creation) |
| `tests/session-start.test.mjs` | +2 tests for the acknowledgment injection behavior |
| `README.md` | Rewritten as project overview — comparison table, commands, known issues, docs links |

## Broadcast (the demo feature)

The plumbing already shipped in Chunk 2 (session-start reads `.relay/broadcast/` and appends to `additionalContext`). Chunk 5 adds the CLI to put files there and the acknowledgment instruction so Claude reliably announces what loaded.

### `relay broadcast-skill <file>`

```bash
relay broadcast-skill ./my-skills/frontend-conventions.md
# Broadcast: .relay/broadcast/skills/frontend-conventions.md
# Pushed to remote.
```

Copies a local skill file to `.relay/broadcast/skills/<basename>` (basename-only — no `--name` flag) and pushes via `GitSync.push()` with the normal lock + retry-on-conflict pipeline.

### Acknowledgment instruction

When `session-start.mjs`'s `buildContext` detects non-`.gitkeep` files in `.relay/broadcast/skills/`, it appends this inside the `# Relay Broadcast` section:

```
_Relay: N team skill(s) loaded — `skill-a`, `skill-b`. Acknowledge in your
first response with one line: "Loaded N team skill(s): `skill-a`, `skill-b`."_
```

Demo moment: Alice runs `relay broadcast-skill frontend-style`, Bob opens a fresh session, and Claude's first message says *"Loaded 1 team skill(s): `frontend-style`."* — unprompted, because the instruction is in the injected system context.

The full "authoritative override" framing from early drafts (wrapping broadcast CLAUDE.md with team-override markers) was not implemented. Broadcast content is still injected, but Claude treats it as regular context, not a hard override.

## `/relay-handoff` slash command

`commands/relay-handoff.toml`:

```toml
description = "Write a handoff note to .relay/memory.md and push to teammates"
prompt = """
Help the user write a Relay handoff note so teammates pick up where they left off.

Steps:
1. Ask the user: "What should teammates know when they pick this up? ..."
2. Read the current contents of .relay/memory.md.
3. Get the current UTC time by running: node -e "console.log(new Date().toISOString())"
4. Build the handoff entry (timestamp + user text, or "(no note)" if skipped).
5. Prepend under "## Handoff notes" section (or create the section) — newest-first.
6. Write atomically (.tmp + rename).
7. Run: node bin/relay.mjs distill --push
   Fallback: git add + commit + push.
8. Confirm success.
"""
```

Human-authored notes beat distillation for explicit leave-behinds — "stopping for dinner, here's what's next." The entry lives in `.relay/memory.md` under `## Handoff notes` and is preserved verbatim on future distills (the distiller treats it as trusted starting state).

## Error surfaces

- `bin/relay status` — memory size, last distill time, watermark, git state, lock status.
- `bin/relay distill --force` — manual distill for debugging.
- **All hook scripts:** on any uncaught error, write to `.relay/log` and `process.exit(0)`. Never block Claude Code on a Relay failure.

## Demo script (rehearse verbatim)

1. **Setup:** two laptops, screen shared, same repo open.
2. **Laptop A:** "We're building a todo app. Let's discuss the stack."
   - Claude + user pick SQLite, reject Postgres (too heavy).
   - Install `user_id=1` workaround in `/dashboard` for fast iteration.
3. Close laptop A's session. **Show `.relay/memory.md` live-updated** (open it in a text editor side-by-side).
4. **Laptop B:** fresh session. Ask "what's the state?"
   - First message names SQLite, rejected Postgres, `user_id=1` workaround.
5. Laptop B drops a skill file via `relay broadcast-skill frontend-style`.
6. **Laptop A:** fresh session. Claude announces *"Loaded team skill: frontend-style."*
7. **Closing line:** *"Multiple humans. One brain. Zero workflow change."*

Target runtime: under 4 minutes.

## README

Copy-paste install steps a stranger can follow:

```bash
# 1. Install plugin (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/ssm-08/relay/master/install.sh | sh

# Windows
# iwr -useb https://raw.githubusercontent.com/ssm-08/relay/master/install.ps1 | iex

# 2. In your repo (one teammate, once)
relay init
git add .relay .gitignore && git commit -m "Add Relay" && git push

# 3. Teammates pull. Open Claude Code. Done.
```

## Exit criteria

- Full scripted demo runs end-to-end **under 4 minutes, zero manual intervention**.
- README has copy-paste install steps that a stranger can execute.
- `known-issues.md` documents: (a) `claude -p` auth needed, (b) rare rebase conflict, (c) transcript version pin.
- Fallback demo video recorded and editable.
