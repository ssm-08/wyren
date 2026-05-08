---
title: Chunk 5 — Broadcast + polish + demo
description: Hours 32-44. Skills/CLAUDE.md broadcast, /wyren-handoff, README, demo rehearsal.
---

**Status: ✅ shipped.** `wyren broadcast-skill` CLI live. Session-start appends an acknowledgment instruction when broadcast skills are present. `/wyren-handoff` slash command ships. 46 unit tests green.

## Goal

Ship the wow-moment demo feature (skill broadcast), add a manual handoff escape hatch, polish README + known issues, rehearse the demo.

## Files (as shipped)

| File | Purpose |
|---|---|
| `hooks/session-start.mjs` | Counts non-`.gitkeep` files in `.wyren/broadcast/skills/` and appends an acknowledgment instruction when any exist |
| `commands/wyren-handoff.toml` | `/wyren-handoff` slash command — writes a handoff note and pushes |
| `bin/wyren.mjs` | Added `wyrenBroadcastSkill(targetDir, filePath)` + `broadcast-skill` CLI subcommand |
| `tests/broadcast-skill.test.mjs` | 6 unit tests for the copy logic (null guards, overwrite, dir creation) |
| `tests/session-start.test.mjs` | +2 tests for the acknowledgment injection behavior |
| `README.md` | Rewritten as project overview — comparison table, commands, known issues, docs links |

## Broadcast (the demo feature)

The plumbing already shipped in Chunk 2 (session-start reads `.wyren/broadcast/` and appends to `additionalContext`). Chunk 5 adds the CLI to put files there and the acknowledgment instruction so Claude reliably announces what loaded.

### `wyren broadcast-skill <file>`

```bash
wyren broadcast-skill ./my-skills/frontend-conventions.md
# Broadcast: .wyren/broadcast/skills/frontend-conventions.md
# Pushed to remote.
```

Copies a local skill file to `.wyren/broadcast/skills/<basename>` (basename-only — no `--name` flag) and pushes via `GitSync.push()` with the normal lock + retry-on-conflict pipeline.

### Acknowledgment instruction

When `session-start.mjs`'s `buildContext` detects non-`.gitkeep` files in `.wyren/broadcast/skills/`, it appends this inside the `# Wyren Broadcast` section:

```
_Wyren: N team skill(s) loaded — `skill-a`, `skill-b`. Acknowledge in your
first response with one line: "Loaded N team skill(s): `skill-a`, `skill-b`."_
```

Demo moment: Alice runs `wyren broadcast-skill frontend-style`, Bob opens a fresh session, and Claude's first message says *"Loaded 1 team skill(s): `frontend-style`."* — unprompted, because the instruction is in the injected system context.

The full "authoritative override" framing from early drafts (wrapping broadcast CLAUDE.md with team-override markers) was not implemented. Broadcast content is still injected, but Claude treats it as regular context, not a hard override.

## `/wyren-handoff` slash command

`commands/wyren-handoff.toml`:

```toml
description = "Write a handoff note to .wyren/memory.md and push to teammates"
prompt = """
Help the user write a Wyren handoff note so teammates pick up where they left off.

Steps:
1. Ask the user: "What should teammates know when they pick this up? ..."
2. Read the current contents of .wyren/memory.md.
3. Get the current UTC time by running: node -e "console.log(new Date().toISOString())"
4. Build the handoff entry (timestamp + user text, or "(no note)" if skipped).
5. Prepend under "## Handoff notes" section (or create the section) — newest-first.
6. Write atomically (.tmp + rename).
7. Run: node bin/wyren.mjs distill --push
   Fallback: git add + commit + push.
8. Confirm success.
"""
```

Human-authored notes beat distillation for explicit leave-behinds — "stopping for dinner, here's what's next." The entry lives in `.wyren/memory.md` under `## Handoff notes` and is preserved verbatim on future distills (the distiller treats it as trusted starting state).

## Error surfaces

- `bin/wyren status` — memory size, last distill time, watermark, git state, lock status.
- `bin/wyren distill --force` — manual distill for debugging.
- **All hook scripts:** on any uncaught error, write to `.wyren/log` and `process.exit(0)`. Never block Claude Code on a Wyren failure.

## Demo script (rehearse verbatim)

1. **Setup:** two laptops, screen shared, same repo open.
2. **Laptop A:** "We're building a todo app. Let's discuss the stack."
   - Claude + user pick SQLite, reject Postgres (too heavy).
   - Install `user_id=1` workaround in `/dashboard` for fast iteration.
3. Close laptop A's session. **Show `.wyren/memory.md` live-updated** (open it in a text editor side-by-side).
4. **Laptop B:** fresh session. Ask "what's the state?"
   - First message names SQLite, rejected Postgres, `user_id=1` workaround.
5. Laptop B drops a skill file via `wyren broadcast-skill frontend-style`.
6. **Laptop A:** fresh session. Claude announces *"Loaded team skill: frontend-style."*
7. **Closing line:** *"Multiple humans. One brain. Zero workflow change."*

Target runtime: under 4 minutes.

## README

Copy-paste install steps a stranger can follow:

```bash
# 1. Install plugin (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/ssm-08/wyren/master/install.sh | sh

# Windows
# iwr -useb https://raw.githubusercontent.com/ssm-08/wyren/master/install.ps1 | iex

# 2. In your repo (one teammate, once)
wyren init
git add .wyren .gitignore && git commit -m "Add Wyren" && git push

# 3. Teammates pull. Open Claude Code. Done.
```

## Exit criteria

- Full scripted demo runs end-to-end **under 4 minutes, zero manual intervention**.
- README has copy-paste install steps that a stranger can execute.
- `known-issues.md` documents: (a) `claude -p` auth needed, (b) rare rebase conflict, (c) transcript version pin.
- Fallback demo video recorded and editable.
