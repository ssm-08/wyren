---
title: The problem
description: Why shared context is the real bottleneck in team hackathons.
---

## The coordination wall

In team hackathons and collaborative sprints, the bottleneck isn't technical skill — it's **shared context**. You end up with one person doing an all-nighter coding, one waiting to make slides, and one doing nothing because they can't get up to speed fast enough. The wall people hit isn't capability. It's coordination.

When multiple people use Claude Code on the same project, every session starts blank. Each person's Claude is an island: **same codebase, zero shared understanding**. Context that lives in one session — why a decision was made, what was tried and rejected, what's intentionally broken — evaporates when that session closes. The next person (or the same person in a new session) inherits code but not comprehension.

## Markdown captures conclusions. Reasoning vaporizes.

Teams already use `CLAUDE.md`, `README.md`, architecture docs. Those files capture *conclusions* — the final state of decisions. What's missing is the **reasoning that led to them**:

- Rejected paths ("we tried WebSocket — browser proxy dropped the connection")
- Live workarounds ("`user_id=1` is hardcoded, remove before demo")
- Scope changes ("we cut CSV export at hour 4, added it back at hour 6")
- Open questions ("should memory sync to cloud if git push fails?")

That reasoning is what a new Claude needs to be useful from message one. It's also the thing nobody has time to write down at the moment they have least time.

## What Relay does that existing tools don't

| Tool | Captures code? | Captures conclusions? | Captures reasoning? | Works across humans? |
|---|---|---|---|---|
| Git | ✅ | — | — | ✅ |
| `CLAUDE.md` | — | ✅ (manual) | — | ✅ |
| Claude Projects | — | ✅ (static) | — | ✅ |
| Agent Teams | — | — | — | ❌ (1 human) |
| **Relay** | — | ✅ (auto) | ✅ (auto, distilled) | ✅ |

Relay's differentiator is **human-to-human coordination *through* AI** — not one human orchestrating many AIs, but many humans each with their own Claude, sharing one brain.

## What "useful from message one" means

The success bar for Relay is a blind A/B test:

> Open Claude Code on a 4-hour-old project you haven't seen.
>
> - **Without Relay:** "What would you like to work on?"
> - **With Relay:** "I see the team picked SQLite and rejected Postgres. There's a hardcoded `user_id=1` workaround in `/dashboard` that needs removing before demo. Where do you want to start?"

The difference isn't technical — it's conversational warmth. Claude treating you like a teammate who just stepped out, not a stranger.

## Next

Read [how it works](/how-it-works/) for the end-to-end Alice/Bob walkthrough.
