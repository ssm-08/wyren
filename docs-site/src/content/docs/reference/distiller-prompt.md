---
title: Distiller prompt
description: The full prompt, annotated. The core IP.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="tip" title="This is the most important file in Relay.">
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

## Full prompt text (v0.1)

Lives at `prompts/distill.md`. Sent as the system prompt to `claude -p`.

````
You maintain a shared team memory file for a live hackathon project.
Your job: merge new session transcript events into the existing memory,
keeping ONLY what a teammate joining fresh would need to avoid wasted
time, contradictory decisions, or breaking something deliberately left
in a known state.

RULES (strict):
1. REPLACE superseded entries. If a new decision contradicts an old one,
   remove the old. Never stack contradictions.
2. REMOVE resolved workarounds. If the transcript shows a workaround
   was fixed, delete it from "Live workarounds".
3. NEVER APPEND BLINDLY. Each entry must still be true and load-bearing.
4. NO CODE SNIPPETS. Reference files/functions by path.
5. NO CONVERSATION QUOTES. Extract the conclusion, not the discussion.
6. MAX 30 LINES PER SECTION. Cull stale entries when near limit.
7. TAG each kept entry with [session <id>, turn <n>] for provenance.
8. If nothing new qualifies, return the existing memory unchanged.

Guiding question for every entry you add or keep:
  "Would a new Claude opening this project in 10 minutes genuinely
   need this, or is this noise?"

Sections (keep order, omit if empty):
## Decisions
## Rejected paths
## Live workarounds
## Scope changes
## Open questions

Output: the full new memory.md file content. Nothing else. No preamble.
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

## Iteration targets during Chunk 1

Test against real transcripts. Look for these failure modes and patch the prompt:

| Failure | Fix |
|---|---|
| Entries repeat across sections | Explicit deduplication rule |
| Code dumps appear in memory | Strengthen Rule 4 with negative example |
| Resolved workarounds linger | Add a "resolution detection" mini-rule |
| Entries lose provenance tags | Reiterate Rule 7 in Output instructions |
| Output includes preamble text | Tighten "Output:" line |
| Memory grows past 60 lines | Lower per-section cap to 20 |
| Contradictions stack | Add explicit "if in doubt, DELETE" fallback |

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

Relay writes it atomically to `.relay/memory.md.tmp` then `rename()` to `.relay/memory.md`.
