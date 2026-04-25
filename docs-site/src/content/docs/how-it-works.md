---
title: How it works
description: End-to-end walkthrough — Alice and Bob share one brain.
---

## The short version

Claude Code starts every session with no memory. For solo work, that's fine — you re-brief Claude at the start. For a team it breaks down: two people's Claudes give conflicting advice because neither knows what the other worked on.

Relay's fix is a shared file in your git repo: `.relay/memory.md`. It holds what matters — decisions made, approaches that didn't work, temporary hacks still in the code. Claude reads it silently at every startup. No briefing needed, no special prompts, no change to how you work.

Here's the data flow:

```
Your conversation
       ↓  (background, every ~5 turns)
 distiller.mjs  →  .relay/memory.md  →  git push
                         ↓  (at every new session start)
               teammate's Claude Code
```

The file is plain markdown — you can open it, read it, and edit it directly. Everything else in Relay is engineering to keep that file accurate and in sync.

---

The rest of this page walks through the full sequence step by step.

---

## T=0 — Install once

Alice and Bob each run the one-liner on their machines (see [Install guide](/reference/install/)). The installer clones Relay to `~/.claude/relay/`, patches `~/.claude/settings.json` with the three hooks, and registers `relay` on PATH. No further setup per session.

## T=1 — Initialize the repo

Alice runs `relay init` inside the repo:

```bash
$ relay init
✔ Created .relay/memory.md (empty stub)
✔ Created .relay/broadcast/
✔ Appended .relay/state/ and .relay/log to .gitignore
✔ Verified git remote is configured (origin)

Next: git add .relay/ && git commit -m "Add Relay" && git push
```

She commits and pushes. Bob pulls. They're ready.

## T=2 — Alice opens Claude Code

Claude Code fires the `SessionStart` hook. `session-start.mjs`:

1. Calls `RelaySync.pull()` → `git fetch`, then `git checkout FETCH_HEAD -- .relay/` (path-scoped, 1.5s cap).
2. Reads `.relay/memory.md` and any files under `.relay/broadcast/`.
3. Prints a JSON envelope to stdout with `hookSpecificOutput.additionalContext` containing the merged memory + broadcast content.

Claude Code ingests that text as **hidden system context**. Alice's Claude now knows the project state before she types a word.

## T=3 — Alice works

Alice chats with Claude. Over 10 turns she:

- Decides to **use SQLite**, not Postgres (too heavy for scope).
- Tries a **WebSocket approach** — browser proxy drops the long-lived connection. Abandons it. Switches to SSE.
- Installs a **`user_id=1` hardcoding** in `/dashboard` for fast iteration.

Every assistant turn fires the `Stop` hook. `stop.mjs`:

- Appends the turn's UUID to `.relay/state/watermark.json` (per-machine, not git-tracked).
- After 5 new turns (or 2 min idle), spawns `distiller.mjs` **detached**. The turn itself is never blocked.

## T=3b — Live sync on every user prompt

While Alice works, the `UserPromptSubmit` hook fires on each prompt she sends — before Claude sees it:

1. `git fetch` then `git checkout FETCH_HEAD -- .relay/memory.md` (1.5s cap, 3s hook budget).
2. Computes a section-aware diff against the memory version injected at `SessionStart`.
3. If there's new content (a teammate pushed a distilled update mid-session), injects only the **delta** as `additionalContext`.

If Bob is working concurrently and his distiller pushes an update, Alice's next prompt picks it up automatically — no restart required. Sessions stay warm without polling.

## T=4 — Distiller runs in background

`distiller.mjs`:

1. Reads the transcript JSONL from the `transcript_path` hook input.
2. Slices from the last-processed UUID to the end.
3. Runs **Tier 0 regex filter** — skips if no signal words (`decide`, `won't`, `workaround`, `rejected`, ...) found. Kills ~70% of triggers for free.
4. For slices with signal: shells out to `claude -p` (headless Claude Code) with the distiller prompt + current memory + transcript slice.
5. Gets back a full new `memory.md` — hygiene-respecting (replaces superseded entries, removes resolved workarounds, never blindly appends).
6. Atomic write (`.tmp` + rename).
7. `RelaySync.push()` → `git add .relay/memory.md && git commit && git push`. Retries on rebase conflict.
8. Updates watermark.

Alice's `.relay/memory.md` now contains:

```markdown
# Relay Memory

## Decisions
- SQLite over Postgres — lightweight, no external DB needed  [session 7a2e, turn 12]

## Rejected paths
- WebSocket for live sync — browser proxy drops long-lived conn; switched to SSE

## Live workarounds
- `/dashboard` hardcodes `user_id=1` — remove before demo

## Scope changes
- Dropped: CSV export (stretch, unblocked for v2)
```

## T=5 — Bob opens Claude Code

Bob opens Claude Code in his clone. `SessionStart` fires:

1. `git fetch`, then `git checkout FETCH_HEAD -- .relay/` — picks up Alice's `.relay/memory.md`.
2. Reads the file, emits `additionalContext`.
3. Claude Code injects it as hidden system context.

Bob's first prompt: *"what's the state?"*

Claude's first message:

> I see Alice picked **SQLite** over Postgres and tried **WebSocket unsuccessfully** (switched to SSE because the browser proxy dropped the connection). There's a hardcoded `user_id=1` workaround in `/dashboard` that needs removing before demo. CSV export was cut but is unblocked for v2. Where do you want to start?

Zero context re-establishment. Bob picks up where Alice stopped.

## That's the loop

Everything else in the implementation plan is engineering to make that loop reliable across:

- **Flaky networks** — timeboxed hooks, best-effort sync, log-and-continue on failure.
- **Concurrent distillation** — advisory lock + retry-on-rebase.
- **Long transcripts** — watermark-based slicing, never re-read what was already processed.
- **Cost pressure** — Tier 0 regex filter kills free triggers; Haiku for routine; Sonnet for cleanup.

## Next

See the [architecture](/architecture/) for the system diagram, or jump to the [roadmap](/roadmap/overview/) to see what ships when.
