---
title: The problem
description: Why shared context is the real bottleneck in team hackathons.
---

> **The core insight:** The problem is not that Claude forgets. It's that Claude never knew in the first place.

## The coordination wall

In team hackathons and collaborative sprints, the bottleneck isn't technical skill — it's **shared context**. You end up with one person doing an all-nighter coding, one waiting to make slides, and one doing nothing because they can't get up to speed fast enough. The wall people hit isn't capability. It's coordination.

When multiple people use Claude Code on the same project, every session starts blank. Each person's Claude is an island: **same codebase, zero shared understanding**. Context that lives in one session — why a decision was made, what was tried and rejected, what's intentionally broken — evaporates when that session closes. The next person (or the same person in a new session) inherits code but not comprehension.

The four specific failure modes:

1. **Empty sessions.** Every new Claude opens blank — no memory of what was built, why, or what was intentionally left broken.
2. **Rationale evaporates.** Markdown captures decisions but never the reasoning. Rejected paths, live workarounds, and constraints vanish when a session closes.
3. **Push-pull collaboration.** Teams work in sequence, not parallel. Every handoff has a dead zone while context transfers manually. In a 24-hour hackathon, three handoffs can cost two hours.
4. **Inconsistent Claude behavior.** Different skills and settings mean each person's Claude behaves differently — same repo, different outputs. One teammate gets a table, another gets prose.

**Root cause:** Claude has no shared state across humans or sessions. Every person's Claude is an island.

## Markdown captures conclusions. Reasoning vaporizes.

Teams already use `CLAUDE.md`, `README.md`, architecture docs. Those files capture *conclusions* — the final state of decisions. What's missing is the **reasoning that led to them**:

- Rejected paths ("we tried WebSocket — browser proxy dropped the connection")
- Live workarounds ("`user_id=1` is hardcoded, remove before demo")
- Scope changes ("we cut CSV export at hour 4, added it back at hour 6")
- Open questions ("should memory sync to cloud if git push fails?")

That reasoning is what a new Claude needs to be useful from message one. It's also the thing nobody has time to write down at the moment they have least time.

## What Relay does that existing tools don't

Several tools solve parts of this problem. None address the core gap.

| Capability | Git | `CLAUDE.md` | Claude Projects | Agent Teams | **Relay** |
|---|---|---|---|---|---|
| Syncs code | ✅ | — | — | — | — |
| Persistent shared memory | — | ✅ (static) | ✅ (static) | ❌ | **✅ (live)** |
| Captures reasoning, not just conclusions | — | ❌ | ❌ | ❌ | **✅** |
| Updates automatically | — | ❌ | ❌ | — | **✅** |
| Live cross-human sync | ✅ (code) | ✅ (if committed) | ❌ | ❌ | **✅** |
| Consistent Claude behavior across teammates | — | Partial | — | — | **✅ (broadcast)** |
| Zero-friction new session onboard | — | Partial | Partial | — | **✅ (auto-inject)** |
| Handoff without dead zones | — | — | — | — | **✅** |
| Works across N human operators | ✅ | ✅ | ✅ | ❌ (1 human) | **✅** |

**Why existing tools fall short:**

- **Git** syncs code perfectly but has no mechanism for syncing the *understanding* of that code — the why behind it, the what-not-to-touch, the this-is-intentional flags.
- **`CLAUDE.md`** requires someone to remember to write it, at the moment they have least time. In a hackathon, that person is coding at 2am.
- **Claude Projects** offer shared docs, but context is static and manually uploaded — not continuously distilled from live sessions.
- **Agent Teams** coordinates AI-to-AI task distribution under one human. It doesn't solve N humans each with their own Claude.

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
