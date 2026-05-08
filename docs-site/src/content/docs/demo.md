---
title: Demo script
description: Four-minute, two-laptop walkthrough. Rehearse verbatim.
---

import { Steps } from '@astrojs/starlight/components';

## Setup

- Two laptops, screen-shared.
- Both have Wyren installed (see [Install guide](/reference/install/)).
- Test repo on GitHub with Wyren initialized (`wyren init` done, committed, pushed).
- Claude Code open on both laptops, pointed at the test repo.
- Text editor side-by-side showing `.wyren/memory.md` live on laptop A.

## The script

<Steps>

1. **Frame the problem (20s).**

   > "When two people hack on the same repo with Claude Code, each session starts blank. All the reasoning behind decisions — what you tried, what you rejected, what's intentionally broken — disappears when you close the tab. Wyren fixes that."

2. **Laptop A: make meaningful decisions (90s).**

   Type into Claude Code on laptop A:

   > "We're building a todo app. Walk me through stack picks — DB, auth, real-time sync."

   Guide the conversation so Claude (with your nudging):
   - **Decides SQLite** over Postgres (scope / simplicity).
   - **Tries WebSocket** for live sync, rejects it after discovering the browser proxy drops it; switches to SSE.
   - **Hardcodes `user_id=1`** in `/dashboard` as a fast-iteration workaround.

   Keep it conversational — the point is showing real reasoning, not scripted lines.

3. **Show the memory file live (30s).**

   Close the session on laptop A. Switch to the text editor showing `.wyren/memory.md`. It should now contain:

   ```markdown
   ## Decisions
   - SQLite over Postgres — simpler, no external DB needed
   - SSE for live sync

   ## Rejected paths
   - WebSocket — browser proxy drops long-lived connection

   ## Live workarounds
   - `/dashboard` hardcodes `user_id=1` — remove before demo
   ```

   Narrate: *"That file was distilled by Claude in the background while we talked. Nobody wrote it. It auto-pushed to git."*

4. **Laptop B: warm start (60s).**

   Switch to laptop B. Open a fresh Claude Code session in the repo. Type:

   > "What's the state?"

   Claude's first reply (target — this is what Wyren delivers):

   > *"I see the team picked SQLite over Postgres and tried WebSocket unsuccessfully (switched to SSE because the browser proxy dropped the connection). There's a hardcoded `user_id=1` workaround in `/dashboard` that needs removing before demo. Where do you want to start?"*

   Narrate: *"Bob's Claude just named every decision Alice's Claude made — 30 seconds after Alice closed her laptop. No handoff meeting. No docs written by hand."*

5. **Broadcast demo (45s).**

   Still on laptop B, run:

   ```bash
   wyren broadcast-skill ./team-skills/frontend-conventions.md
   ```

   Narrate the output: *"Pushed a new skill to the team. Next time anyone opens a session, they'll have it."*

   Switch back to laptop A. Open a fresh Claude Code session. Claude's first message announces something close to:

   > *"Loaded 1 team skill(s): `frontend-conventions`."*

   The exact phrasing comes from the acknowledgment instruction Wyren injects alongside the broadcast content — Claude follows it but may paraphrase.

   Narrate: *"One person writes a skill. Everyone inherits it. No chat messages, no 'hey did you see'."*

6. **Closing line (10s).**

   > "Multiple humans. One brain. Zero workflow change."

</Steps>

## Total runtime

Target: **under 4 minutes**. If over, cut step 5 (broadcast) — the core story is steps 1-4 + closing.

## What to have ready as fallback

- **Pre-recorded screen video** of the full flow — if live demo fails, play it.
- **Memory.md screenshot** showing a rich pre-distilled example.
- **Git log screenshot** showing the auto-commits.

## Q&A prep

| Likely question | Short answer |
|---|---|
| "What if two people distill at once?" | Git rebase + retry + advisory lock. Seen zero merge conflicts in stress tests. |
| "How much does this cost?" | $0 under the preferred path (rides Claude Code auth). See [Cost model](/cost-model/). |
| "Doesn't this spam git history?" | Scoped to `.wyren/` path. Main code history untouched. Optional daily squash. |
| "What about privacy? My transcripts leak?" | Transcripts stay local. Only the *distilled* memory is pushed — no verbatim conversation. |
| "Does this scale beyond short sprints?" | Yes — same plugin, same git sync, same distillation loop. Cloud sync and per-user permissions are the natural additions for larger teams. See [Future](/future/). |
| "Why not an MCP server?" | MCPs are tool-invocable only — can't inject at SessionStart. Hook is the right surface. MCP for on-demand query is a great addition later. |
