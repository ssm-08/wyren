# Wyren — Code Check + Docs Update Multi-Agent Prompts

> One Orchestrator audits the full repo and writes a TASK_MANIFEST.md. Three Specialists execute in
> parallel: one fixes code issues, one updates README/CLAUDE.md, one updates the docs site. Orchestrator
> does a final consistency pass. No agent touches another's files.

---

## How to Run This

1. **Open SESSION 1 (Orchestrator)** — paste into a fresh Claude Code session in the Wyren repo root.
   Wait for it to produce `AUDIT_NOTES.md` and `TASK_MANIFEST.md`.
2. **Open SESSION 2, 3, and 4 in parallel** — three Claude Code sessions simultaneously, each in the
   Wyren repo root. They read the manifest and execute their scope.
3. **Return to SESSION 1** — paste the "Phase 3" block to do the final integration review.

---

# SESSION 1 — ORCHESTRATOR

```
You are the code-check + docs-update orchestrator for Wyren (https://github.com/ssm-08/wyren).

Wyren is a Claude Code plugin for shared team memory across sessions. Transcripts are distilled
in the background; `.wyren/memory.md` is synced via git and injected as hidden context at every
SessionStart and on each user turn (UserPromptSubmit). v0.4.4 on master.

## Your role

You coordinate — you do NOT edit files directly. Your job:
1. Audit the full repo for code issues, stale docs, and bloat.
2. Write AUDIT_NOTES.md and TASK_MANIFEST.md for 3 specialist agents.
3. After specialists complete, do a final integration review.

## Phase 1 — Audit

Read every file in these locations, in this order:

**Code:**
- bin/wyren.mjs (CLI subcommands)
- distiller.mjs
- hooks/session-start.mjs, hooks/stop.mjs, hooks/user-prompt-submit.mjs
- lib/sync.mjs, lib/memory.mjs, lib/filter.mjs, lib/diff-memory.mjs, lib/transcript.mjs, lib/util.mjs

**Tests:**
- tests/ (all *.test.mjs files — skim for stale test names, skipped blocks, coverage gaps)
- scripts/test-e2e.mjs (e2e test descriptions — check for stale group names or missing coverage)

**Docs / Info pages:**
- README.md
- CLAUDE.md
- docs-site/src/content/docs/reference/cli.md
- docs-site/src/content/docs/reference/hooks.md
- docs-site/src/content/docs/roadmap/overview.md
- docs-site/src/content/docs/faq.md
- docs-site/src/content/docs/how-it-works.md

Think like:
- A developer filing a bug report: "what's wrong, inconsistent, or undocumented?"
- A first-time reader of the docs: "does this match what the code actually does?"
- A code reviewer prioritizing correctness over style

Document findings across these categories:

### Category 1 — Code bugs / broken state (must fix)
Known broken state already logged (verify these still exist, then document):
- `remote_diverged` in sync.mjs exits 0 with no recovery message — should print
  "run `git fetch && git rebase origin/master`, then re-run `wyren distill --push`"
- Duplicate `# Wyren Memory` header in lib/memory.mjs template — cosmetic but shows in cold-start injection
- `wyren distill --push` flag not in --help output (bin/wyren.mjs)

Look for any additional: dead code, stale constants, wrong exit codes, missing error messages.

### Category 2 — Docs / README staleness (high ROI)
v0.4.4 shipped these features. Check if docs reflect them:
- `wyren status` now shows "Peer pushed: <timestamp>" from remote git log
- UPS (UserPromptSubmit) runs ancestry check after pull — warns + injects on force-push detection
- `wyren distill` nags when --push is omitted after successful distill
- hooks/hooks.json timeouts: SessionStart=4s, Stop=5s, UPS=3s
- Test counts: 185 pass / 187 total (2 skip POSIX-only), 32 e2e

Check for any commands table entries, hook descriptions, or behavior explanations that don't
match current code.

### Category 3 — Bloat / token waste (nice to have)
- Comments that explain WHAT, not WHY (project convention: no what-comments)
- Multi-line comment blocks that can be trimmed
- Unused variables, imports, or dead branches
- Docs sections that duplicate information already elsewhere

## Phase 2 — Write TASK_MANIFEST.md

Create TASK_MANIFEST.md at the repo root. Structure it as 3 clearly delimited sections.

Each section must:
- List exact files to read and modify
- List files the agent MUST NOT touch
- Give specific, unambiguous action items (not suggestions)
- Include exact wording where the text matters

### Agent A — Code Quality
Scope: bin/wyren.mjs, distiller.mjs, hooks/, lib/, scripts/installer.mjs
Do NOT touch: README.md, CLAUDE.md, docs-site/, tests/, package.json

### Agent B — README & CLAUDE.md
Scope: README.md, CLAUDE.md
Do NOT touch: docs-site/, bin/, hooks/, lib/, distiller.mjs, tests/, package.json

### Agent C — Docs Site
Scope: docs-site/src/content/docs/ (all .md/.mdx files)
Do NOT touch: README.md, CLAUDE.md, bin/, hooks/, lib/, distiller.mjs, tests/

## Phase 3 — Final Integration Review (run AFTER all agents complete)

After agents have made their changes, verify:
1. `wyren distill --push` is documented consistently in README, CLAUDE.md, and docs-site CLI ref.
2. Test counts (185/187, 32 e2e) are consistent across CLAUDE.md and any docs page that mentions them.
3. Hook timeouts (4s/5s/3s) are consistent across docs and hooks.json.
4. `wyren status` "Peer pushed:" feature is mentioned in README and/or docs where status is described.
5. No file was touched by more than one agent (check git diff groupings).
6. The three known broken-state items (remote_diverged, duplicate header, --help gap) were addressed.

Write a brief REVIEW_NOTES.md: what was fixed, what was skipped, any outstanding issues.

## Constraints

- Do NOT edit any source files during Phase 1 or 2.
- Do NOT invent features or roadmap items. Only document what exists in code.
- Do NOT add changelog bullets to README or CLAUDE.md — update facts in place.
- Flag as "out of scope" anything that would require a new feature to fix.

## Output format

Produce:
1. AUDIT_NOTES.md — your findings (specialists will read this)
2. TASK_MANIFEST.md — 3 agent sections, formatted so each section is clearly delimited

Begin with the audit now. Read files first, then write both documents.
```

---

# SESSION 2 — SPECIALIST A: CODE QUALITY

```
You are Specialist Agent A, working on Wyren (https://github.com/ssm-08/wyren).

Wyren is a Claude Code plugin for shared team memory. Your domain is code quality — you own the
source files and fix real bugs, not style issues.

## Your scope

You own: bin/wyren.mjs, distiller.mjs, hooks/session-start.mjs, hooks/stop.mjs,
hooks/user-prompt-submit.mjs, lib/sync.mjs, lib/memory.mjs, lib/filter.mjs, lib/diff-memory.mjs,
lib/transcript.mjs, lib/util.mjs, scripts/installer.mjs

Do NOT modify: README.md, CLAUDE.md, docs-site/, tests/, package.json, TASK_MANIFEST.md,
AUDIT_NOTES.md

## Step 1 — Read first

Before touching anything, read:
- TASK_MANIFEST.md (your specific task list from the Orchestrator)
- AUDIT_NOTES.md (context on known issues)
- bin/wyren.mjs
- lib/sync.mjs
- lib/memory.mjs
- hooks/user-prompt-submit.mjs
- hooks/stop.mjs

## Step 2 — Fix known broken-state items

These are confirmed bugs. Fix each one:

**Bug 1: remote_diverged exits 0 silently**
In lib/sync.mjs, find where `remote_diverged` is returned or where the distiller detects
divergence. After detecting divergence, print (to stderr):
  `[wyren] Remote and local memory diverged. Run: git fetch && git rebase origin/master, then re-run: wyren distill --push`
Then exit with a non-zero code if this is a blocking condition, or exit 0 if fail-open is required.
Check how other error paths handle this — match the pattern.

**Bug 2: Duplicate `# Wyren Memory` header in lib/memory.mjs template**
Find the template string used for cold-start memory injection in lib/memory.mjs.
It likely has `# Wyren Memory` appearing twice — once in the template header and once in the
section content. Remove the duplicate so only one `# Wyren Memory` header appears.

**Bug 3: `wyren distill --push` missing from --help**
In bin/wyren.mjs, find the `distill` subcommand's help text. Add `--push` to the options list
with the description: "Commit and push memory.md after distillation."
Match the formatting style of other flags (--force, etc.).

## Step 3 — Audit and clean additional issues

After fixing the known bugs, look for:
- Dead code: variables declared but never used, branches that can never execute
- Stale constants: hardcoded values that should match current defaults (turns threshold=5, idle=120s,
  timeouts=4s/5s/3s — verify these match hooks/hooks.json)
- Wrong exit codes: any error path that exits 0 when it should exit non-zero (or vice versa)
- Bloated comments: multi-line comment blocks explaining WHAT code does (project convention: no
  what-comments; only WHY comments when non-obvious)

Remove dead code and stale what-comments. Do NOT remove comments that explain why (hidden
constraints, workarounds, invariants). When in doubt, keep the comment.

## Step 4 — Verify atomicRename usage

Check that all file writes in hooks/ and lib/ use the atomicRename pattern:
  write to .pid.timestamp.tmp → rename via atomicRename()
Any bare fs.writeFileSync or fs.renameSync (not inside the retry loop) on state files is a bug.
Flag but do NOT fix without confidence — write a note in NOTES_for_orchestrator.md if unsure.

## Constraints

- Zero new features. Fix only what exists.
- No style refactors. Touch only lines with real issues.
- No new dependencies. stdlib only.
- Do NOT modify test files or package.json.
- If a fix requires changing test expectations, write "NEEDS_TEST_UPDATE: <description>" in
  NOTES_for_orchestrator.md instead of changing the test.
- Match existing code style exactly (spawnSync arrays, windowsHide:true, fail-open hooks).
```

---

# SESSION 3 — SPECIALIST B: README & CLAUDE.md

```
You are Specialist Agent B, working on Wyren (https://github.com/ssm-08/wyren).

Wyren is a Claude Code plugin for shared team memory. Your domain is README.md and CLAUDE.md —
the two primary info files that humans and future Claude sessions read first.

## Your scope

You own: README.md, CLAUDE.md

Do NOT modify: docs-site/, bin/, hooks/, lib/, distiller.mjs, tests/, package.json,
scripts/, TASK_MANIFEST.md, AUDIT_NOTES.md

## Step 1 — Read first

Before touching anything, read:
- TASK_MANIFEST.md
- AUDIT_NOTES.md
- README.md (full)
- CLAUDE.md (full)
- package.json (for current version number)
- hooks/hooks.json (for current timeout values)

## Step 2 — Update README.md

**Commands table** — verify each row matches bin/wyren.mjs exactly. Check:
- `wyren status` description should mention "Peer pushed" timestamp: "Shows memory file size,
  when distillation last ran, git sync state, and when a teammate last pushed memory."
- `wyren distill [--force] [--push]` — verify `--push` is listed in the command syntax and
  description says "commits and pushes the result."
- Any commands added or removed since last README update — add/remove rows to match.

**Current limitations** — verify the 4 numbered items still reflect current behavior:
- Item 1 (distillation requires Claude Code auth): still accurate — keep as-is.
- Item 2 (concurrent pushes retry): still accurate — keep as-is.
- Item 3 (transcript format JSONL): still accurate — keep as-is.
- Item 4 (Tier 0 filter): check that the description of weighted scoring categories matches
  lib/filter.mjs. If the categories have changed, update the list.
- If any limitation was fixed in v0.4.4, remove it or mark resolved.

**Do NOT** add a changelog section, version history, or "what's new" block. Update facts in place.

## Step 3 — Update CLAUDE.md

**Current state block** (the first paragraph under "Current state"):
- Version must read: v0.4.4
- Add mention of sync integrity features shipped: "Sync integrity v0.4.4: `wyren status` shows
  Peer pushed timestamp; UPS ancestry check detects force-push and warns + injects on violation;
  distiller nags when --push omitted."
- Test counts: "Tests: 187 unit (~3min) — 185 pass, 2 skip (POSIX-only), 0 flaky-under-load
  (concurrency=1). 32 e2e (~25s)."

**Known broken state section** — verify these 3 items still appear and are accurate:
1. `remote_diverged` exits 0 with no recovery guidance
2. Duplicate `# Wyren Memory` header in template (lib/memory.mjs)
3. `wyren distill --push` not in `--help` output
If Agent A (code quality) has already fixed any of these, remove the corresponding item.
(You cannot know what Agent A did — leave all 3 in place. Orchestrator will reconcile in Phase 3.)

**Session wrap-up section** — verify the 7-step checklist still matches what actually needs doing.
If any step references a file that no longer exists or a task that's now automated, update it.

**Repo layout** — verify the file tree matches actual repo structure. Check:
- hooks/run-hook.cmd present? (check if it exists)
- Any files added/removed since last update?

## Constraints

- Do NOT add markdown sections, headers, or changelog bullets.
- Do NOT invent features. Only describe what exists.
- Update facts in place — same structure, accurate content.
- Do NOT modify anything outside README.md and CLAUDE.md.
- If a test count or version is uncertain, leave a comment: <!-- VERIFY: X --> inline.
```

---

# SESSION 4 — SPECIALIST C: DOCS SITE

```
You are Specialist Agent C, working on Wyren (https://github.com/ssm-08/wyren).

Wyren is a Claude Code plugin for shared team memory. Your domain is the docs site at
docs-site/src/content/docs/ — the public-facing documentation at https://ssm-08.github.io/wyren/.

## Your scope

You own: docs-site/src/content/docs/ (all .md and .mdx files)

Do NOT modify: README.md, CLAUDE.md, bin/, hooks/, lib/, distiller.mjs, tests/, package.json,
scripts/, TASK_MANIFEST.md, AUDIT_NOTES.md

## Step 1 — Read first

Before touching anything, read:
- TASK_MANIFEST.md
- AUDIT_NOTES.md
- docs-site/src/content/docs/reference/cli.md
- docs-site/src/content/docs/reference/hooks.md
- docs-site/src/content/docs/roadmap/overview.md
- docs-site/src/content/docs/faq.md
- docs-site/src/content/docs/how-it-works.md
- hooks/hooks.json (for current timeout values)
- bin/wyren.mjs (to verify CLI commands exist as documented)

## Step 2 — Update reference/cli.md

This is the most likely stale file. Check and update:

**Commands table / entries:**
- `wyren status`: add that it now shows "Peer pushed: <timestamp>" from remote git log.
  Description: "Shows memory file size, last distillation time, git sync state, and when a
  teammate last pushed memory to the remote."
- `wyren distill`: verify `--push` flag is documented. If missing, add:
  `--push` — Commit and push memory.md after successful distillation.
  `--force` — Skip Tier 0 signal filter and distill unconditionally.
- Any commands added or removed: match bin/wyren.mjs exactly.

**Version:** update to v0.4.4 if any version string appears.

## Step 3 — Update reference/hooks.md

Verify hook descriptions and timeouts match hooks/hooks.json:
- SessionStart: timeout 4s. Behavior: pull + inject memory + inject broadcast files (50KB/file cap,
  200KB total cap).
- Stop: timeout 5s. Behavior: watermark + PID-tracked detached distiller spawn.
- UserPromptSubmit: timeout 3s. Behavior: pull (1.5s) + section-aware diff + inject delta only.
  Also runs ancestry check after pull — warns + injects on force-push detection (fail-open).

If the docs describe UPS as "inject full memory on update" (old behavior), update to "inject only
changed sections (delta)."

If force-push detection is not mentioned, add a note under UserPromptSubmit:
  "Force-push guard: after each pull, UPS checks ancestry of the remote memory commit. If the
  remote was force-pushed (non-ancestor), it warns the user and injects the full current memory."

## Step 4 — Update roadmap/overview.md

Add or verify these items appear as "shipped" (not planned):
- Live sync via UserPromptSubmit (section-aware delta injection)
- Fault injection test suite (network, corruption, concurrency, e2e)
- Full deployability: npm install + wyren install one-liner
- Sync integrity: Peer pushed timestamp in wyren status + force-push detection in UPS

Do NOT add items to the roadmap that aren't yet built. Do NOT remove items marked as future work.

## Step 5 — Update faq.md

Check for any FAQ entries that reference outdated behavior:
- If there's an entry about "how does live sync work" that describes session-boundary-only sync
  (old behavior), update it to describe per-turn UPS sync.
- If there's an entry about "what happens if two teammates push at the same time" — verify it
  describes the force-push ancestry check behavior added in v0.4.4.
- Do NOT add new FAQ entries unless AUDIT_NOTES.md specifically calls for them.

## Step 6 — Scan how-it-works.md

Verify the "Writing" section describes the current distill trigger accurately:
- Tier 0 weighted scoring (not simple regex) filters low-signal turns.
- Distiller spawns detached after N turns OR idle timeout.
- Result is committed and pushed (if --push) or local-only (default).

If the page still describes a simple regex filter or doesn't mention weighted scoring, update it.
Keep the explanation high-level — this is user-facing docs, not implementation detail.

## Constraints

- Do NOT change the docs site structure, navigation config, or Astro config files.
- Do NOT add new pages or sections.
- Do NOT invent features. Only document what exists in code.
- Do NOT copy-paste large code blocks from source — docs should explain behavior, not reproduce source.
- Match existing doc style (frontmatter format, heading levels, link style).
- If you find a docs page that is severely outdated and would take more than 30 minutes to fully
  update, write a note in NOTES_for_orchestrator.md instead of attempting a partial update.
```

---

## Agent Coordination Notes

### File Ownership Table

| File / Directory | Owner |
|---|---|
| bin/wyren.mjs | Agent A |
| distiller.mjs | Agent A |
| hooks/session-start.mjs | Agent A |
| hooks/stop.mjs | Agent A |
| hooks/user-prompt-submit.mjs | Agent A |
| lib/*.mjs | Agent A |
| scripts/installer.mjs | Agent A |
| README.md | Agent B |
| CLAUDE.md | Agent B |
| docs-site/src/content/docs/ | Agent C |
| TASK_MANIFEST.md | Orchestrator only |
| AUDIT_NOTES.md | Orchestrator only |
| REVIEW_NOTES.md | Orchestrator only |
| NOTES_for_orchestrator.md | Agents A/C (write), Orchestrator (read) |
| tests/ | No agent (read-only) |
| package.json | No agent (read-only) |
| hooks/hooks.json | No agent (read-only reference) |

### Cross-Agent Communication

If Agent A or Agent C spots something that affects another agent's scope:
- Write a one-liner to `NOTES_for_orchestrator.md`: `[Agent A → B]: distill --push now exits 1 on failure; README limitations item 1 may need update.`
- Do NOT edit the other agent's files.
- Orchestrator reconciles in Phase 3.

### Execution Order

1. SESSION 1 (Orchestrator Phase 1 + 2) — produces AUDIT_NOTES.md + TASK_MANIFEST.md
2. SESSION 2, 3, 4 (Specialists) — run in parallel after manifest exists
3. SESSION 1 (Orchestrator Phase 3) — final review after specialists complete
