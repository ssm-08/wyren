---
title: Chunk 5 — Broadcast + polish + demo
description: Hours 32-44. Skills/CLAUDE.md broadcast, /relay-handoff, README, demo rehearsal.
---

## Goal

Ship the wow-moment demo feature (skills + CLAUDE.md broadcast), polish error surfaces, write README + scripted demo, rehearse.

## Files

| File | Purpose |
|---|---|
| `hooks/session-start.mjs` | Enhance broadcast reading — explicit authoritative headers |
| `commands/handoff.md` | `/relay-handoff` slash command (stretch) |
| `bin/relay` | Add `relay broadcast-skill <name>` |
| `README.md` | Installation + demo script |
| `docs/known-issues.md` | Document the 3 gotchas |

## Broadcast (the demo feature)

The plumbing already shipped in Chunk 2 (session-start reads `.relay/broadcast/` and appends to `additionalContext`). Chunk 5 adds:

### `relay broadcast-skill <file>`

```bash
relay broadcast-skill ./my-skills/frontend-conventions.md
# ✔ Copied to .relay/broadcast/skills/frontend-conventions.md
# ✔ Committed and pushed
# Teammates will receive on their next SessionStart
```

Copies a local skill file to `.relay/broadcast/skills/` and commits via `GitSync`.

### Authoritative broadcast headers

Session-start wraps broadcast content with explicit markers so Claude treats broadcast `CLAUDE.md` as team override:

```
# Team Broadcast (authoritative — overrides local CLAUDE.md)

<content of .relay/broadcast/CLAUDE.md>

---

# Team Skills (loaded from broadcast)

Acknowledge loaded skills in your first response:
"Loaded N team skill(s) from broadcast: <list>."
```

Demo moment: Alice runs `relay broadcast-skill frontend-conventions`, Bob's next session prints *"Loaded 1 team skill: frontend-conventions."* in first message.

## `/relay-handoff` slash command (stretch)

```
---
description: Leave a handoff note for teammates
---

Ask the user for a brief handoff note. Then prepend it to
.relay/memory.md under a ## Handoff notes section, commit, push.
Bypass the distiller — preserve human authorship verbatim.
```

Human-authored notes beat distillation for explicit leave-behinds. Great for "stopping for dinner, here's what's next."

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
# 1. Install plugin
claude /plugins add https://github.com/ssm-08/relay

# 2. In your repo
relay init
git add .relay && git commit -m "Add Relay" && git push

# 3. Teammates pull. Open Claude Code. Done.
```

## Exit criteria

- Full scripted demo runs end-to-end **under 4 minutes, zero manual intervention**.
- README has copy-paste install steps that a stranger can execute.
- `known-issues.md` documents: (a) `claude -p` auth needed, (b) rare rebase conflict, (c) transcript version pin.
- Fallback demo video recorded and editable.
