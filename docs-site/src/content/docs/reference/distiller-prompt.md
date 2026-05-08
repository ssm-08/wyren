---
title: Distiller prompt
description: The full prompt, annotated. The core IP.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="tip" title="This is the most important file in Wyren.">
Infrastructure is easy. Hygiene-respecting distillation is hard. This prompt is where the project succeeds or fails. Iterate aggressively during Chunk 1.
</Aside>

## What the distiller does

The distiller answers one question on each run: **"What would I wish I knew before touching this codebase?"** Not what happened, not what was discussed — specifically: what would prevent a new Claude from wasting time, making contradictory decisions, or breaking something intentionally left in a certain state.

**What it captures:**

- Architectural decisions and the constraints that forced them
- Approaches that were tried and explicitly rejected — and why
- Workarounds currently in the code that look like bugs but are intentional
- Scope that was cut and should not be re-introduced before the demo
- Files or modules that are half-migrated and should not be touched

**What it discards:**

- Every message that doesn't change how a new engineer approaches the code
- Debugging noise, trial and error, exploration without conclusion
- Code snippets — these belong in the repo, not in memory
- Anything already expressed in `CLAUDE.md` or the codebase itself

**Memory hygiene:** the distiller updates and overwrites, it does not append. A workaround noted at hour 2 that gets fixed at hour 5 should not persist. Entries carry a `[session <id>, turn <n>]` tag for provenance, so stale context can be traced back to its source and pruned.

## Full prompt text (current)

Lives at `prompts/distill.md`. Sent as the system prompt to `claude -p`.

````
You maintain a shared team memory file for an active software project. Every teammate's Claude Code session draws from this file to start warm. Your job: merge a new session transcript slice into the existing memory, keeping ONLY what a teammate joining fresh would genuinely need to avoid wasted time, contradictory decisions, or breaking something deliberately left in a known state.

## Hard rules

1. **Replace superseded entries.** If a new decision contradicts an old one, remove the old — never stack contradictions.
2. **Remove resolved workarounds.** If the transcript shows a workaround was fixed or removed, delete it from "Live workarounds".
3. **Never append blindly.** Every entry you keep must still be true and load-bearing right now. Cull stale entries aggressively.
4. **No code snippets.** Reference files/functions by path (e.g. `hooks/session-start.mjs:42`). No copy-pasted code.
5. **No conversation quotes.** Extract the conclusion, not the discussion. No "Alice said…" — just the fact.
6. **Max 30 lines per section.** When near the limit, cull the least load-bearing entry.
7. **Tag provenance.** Append `[session <short-id>, turn <n>]` to every entry you add or keep. Keep tags on existing entries unchanged unless the fact itself is updated.
8. **If nothing new qualifies, return the existing memory unchanged.** Do not rephrase for its own sake.

## The guiding question

For every entry you add or keep, ask:

> Would a new Claude opening this project in 10 minutes genuinely need this, or is this noise?

If the honest answer is "noise," drop it.

## What counts as signal

- **Decisions** — tech picks, architectural choices, scope calls. Only the resolved choice, not the deliberation.
- **Rejected paths** — approaches tried and abandoned, with the one-line reason. Prevents re-litigation.
- **Live workarounds** — deliberate shortcuts currently in the code that look like bugs but are intentional.
- **Scope changes** — things explicitly cut or added mid-build. Keep only if they affect what someone should/shouldn't touch.
- **Open questions** — blocking unknowns the team is still resolving. Remove once answered.

## What is NOT signal (drop even if mentioned)

- Tool-call noise, file lists, grep output, build output.
- Code the assistant wrote (the code is the code — memory is for *why*).
- Commentary on what the model is about to do.
- Generic advice, tutorials, or restated requirements from docs.
- Anything already obvious from `README.md`, `CLAUDE.md`, or a 30-second codebase scan.

## Output format

Output the full new `memory.md` file content. Nothing else. No preamble, no trailing notes, no explanation of changes.

Use these sections in this order. Omit a section entirely if empty (don't leave a bare header).

```
## Decisions
- <fact> [session <id>, turn <n>]

## Rejected paths
- <approach>: <one-line reason> [session <id>, turn <n>]

## Live workarounds
- <file or area>: <what's intentional> [session <id>, turn <n>]

## Scope changes
- <what changed> [session <id>, turn <n>]

## Open questions
- <question> [session <id>, turn <n>]
```

Total memory should stay under ~60 lines on a 2-hour transcript. If you're tempted to add a 31st entry to a section, you should be deleting one first.
````

## Annotated rationale

### Rule 1 — "REPLACE superseded entries"

Without this, the memory accumulates contradictions. "Decided SQLite" and later "Decided Postgres" both stay, and the next reader doesn't know which is current. Hygiene requires the distiller to actively *delete* old decisions when new ones supersede them.

### Rule 2 — "REMOVE resolved workarounds"

The most value-destroying failure mode: a workaround noted at hour 2 that was fixed at hour 5 still appears in memory at hour 8. Future teammates re-investigate something already solved. The distiller must track resolution signals and delete stale workarounds.

### Rule 3 — "NEVER APPEND BLINDLY"

Without this, entries accumulate forever. Memory becomes a log, not a memory. Each distillation should treat every existing entry as up for review.

### Rules 4 & 5 — "NO code snippets, NO conversation quotes"

Conversation and code are the transcript's domain. Memory distills *conclusions*, not *reasoning artifacts*. Including code leaks implementation into what should be a decision log.

### Rule 6 — "MAX 30 LINES PER SECTION"

Forces culling. Without a hard cap, the distiller tends to preserve more than it should.

### Rule 7 — "TAG each entry with [session <id>, turn <n>]"

Provenance. If a teammate questions a decision, they can follow the tag back to the actual conversation.

### Rule 8 — "If nothing new qualifies, return the existing memory unchanged"

Guards against hallucinated changes. The distiller should be stable across no-op runs.

### Guiding question

The north star. Every entry should justify its existence by this question. Written as a first-person thought so Claude reasons internally.

## Failure modes addressed during prompt iteration

These failure modes were caught during testing and patched into the prompt above:

| Failure | Fix applied |
|---|---|
| Entries repeat across sections | Explicit deduplication rule |
| Code dumps appear in memory | "No code snippets" + "What is NOT signal" section |
| Resolved workarounds linger | "Remove resolved workarounds" as Hard Rule 2 |
| Entries lose provenance tags | Rule 7 with explicit tag-preservation instruction |
| Output includes preamble text | "Nothing else. No preamble, no trailing notes" |
| Memory grows past 60 lines | Per-section cap + total-size reminder in output format |
| Contradictions stack | "Never stack contradictions" in Rule 1 |

## Inputs (appended to prompt as user message)

```
<existing-memory>
{{current memory.md content, empty string if first run}}
</existing-memory>

<transcript-slice>
{{rendered transcript since watermark}}
</transcript-slice>

<session-metadata>
session_id: {{short session id}}
current_turn: {{last turn number}}
</session-metadata>
```

Transcript is rendered compactly by `lib/transcript.mjs`:

```
[turn 1, user]: Let's set up the database.
[turn 2, assistant]: I'll use Postgres because [tool_use: Edit db.py]
[turn 3, user]: Too heavy — use SQLite.
[turn 4, assistant]: Switching. [tool_use: Edit db.py]
...
```

Tool-use results are truncated at 500 chars. Pure file-read turns with no user text are elided.

## Output

Full `memory.md` file content. No preamble, no markdown fences around the output, no commentary.

Wyren writes it atomically to `.wyren/memory.md.tmp` then `rename()` to `.wyren/memory.md`.
