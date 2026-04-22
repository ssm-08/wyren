---
title: memory.md schema
description: Sections, hygiene rules, and a worked example.
---

`memory.md` is plain markdown. Humans read it directly. Claude ingests it as `additionalContext`. Git diffs are clean.

## Sections (in order)

| Section | What goes here |
|---|---|
| `## Decisions` | Committed choices: stack, patterns, scope. |
| `## Rejected paths` | Things tried and abandoned, with why. |
| `## Live workarounds` | Known hacks, stubs, hardcodes — with what "done" looks like. |
| `## Scope changes` | Added / dropped / deferred items. |
| `## Open questions` | Unresolved decisions the team is carrying. |
| `## Handoff notes` | (optional) Human-authored via `/relay-handoff`. Bypasses distiller. |

Empty sections are omitted by the distiller.

## Hygiene rules (enforced by distiller prompt)

1. **REPLACE superseded entries.** If a new decision contradicts an old one, delete the old. Never stack contradictions.
2. **REMOVE resolved workarounds.** If the transcript shows a workaround was fixed, delete it.
3. **NEVER APPEND BLINDLY.** Every kept entry must still be true and load-bearing.
4. **NO code snippets. NO conversation quotes.** Reference files by path, extract conclusions only.
5. **MAX 30 lines per section.** Cull stale entries aggressively.
6. **TAG each entry** with `[session <id>, turn <n>]` for provenance.

## Example (live snapshot)

```markdown
# Relay Memory
_Last distilled: 2026-04-21T14:32Z by session 7a2e-… (Tier 1 Haiku)_

## Decisions
- SQLite over Postgres — hackathon scope, no external DB  [session 7a2e, turn 12]
- Auth via magic-link, no OAuth — saves 3h  [session 3f1b, turn 8]
- SSE for live sync (not WebSocket)  [session 7a2e, turn 19]

## Rejected paths
- Tried WebSocket for live sync — browser proxy drops long-lived conn  [session 7a2e, turn 17]
- Considered shared Redis — setup cost > value for 2-person demo  [session 3f1b, turn 14]

## Live workarounds
- `auth.py` skips email send, logs magic link to stdout — wire SMTP before demo  [session 3f1b, turn 22]
- Hardcoded `user_id=1` in `/dashboard` route — remove after session table ships  [session 7a2e, turn 31]

## Scope changes
- Dropped: CSV export (stretch goal, unblocked for v2)  [session 7a2e, turn 8]
- Added: keyboard shortcuts (requested by demo reviewer)  [session 3f1b, turn 41]

## Open questions
- Should memory sync to cloud if git push fails?  [raised session 3f1b]
```

## Why markdown, not JSON?

| Reason | Markdown wins |
|---|---|
| **Claude ingestion** | Native context format. No schema hints needed. |
| **Human readable** | Teammates can open and grok instantly. No tool required. |
| **Git diffs** | Line-oriented, semantically meaningful. |
| **Parser brittleness** | Distiller output doesn't need strict validation. |
| **Human edits** | Anyone can fix a typo or add a note. Round-trip safe. |

JSON would require: (a) a schema, (b) a renderer for humans, (c) a validator for distiller output, (d) tooling to merge. Markdown skips all of it.

## Editing memory.md by hand

Safe. Relay distiller treats existing content as "the trusted starting state" and merges new signal into it — it won't nuke human edits unless they contradict transcript evidence.

If you want something preserved permanently (e.g. a hand-crafted team charter), put it in `.relay/broadcast/` instead. Files under `broadcast/` are injected as context at every SessionStart but are never read or rewritten by the distiller — they stay exactly as you wrote them. Skills specifically live in `.relay/broadcast/skills/` and trigger an acknowledgment instruction; regular files anywhere else under `broadcast/` inject without the acknowledgment.

## Size budget

Target: under 60 lines for a 1-day hackathon. If it grows past that, the distiller is instructed to cull aggressively on the next run. Sonnet Tier 2 specifically checks line count and triggers on violation.
