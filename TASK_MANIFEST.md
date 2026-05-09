# Wyren Task Manifest — 2026-05-09

Read AUDIT_NOTES.md first for full context, evidence, and line numbers.

Each section is a self-contained brief for one specialist agent. Agents must not touch files outside their scope.

---

## ═══════════════════════════════════
## AGENT A — Code Quality
## ═══════════════════════════════════

**Scope (read + modify):**
- `hooks/hooks.json`
- `lib/sync.mjs`
- `distiller.mjs`

**Must NOT touch:**
- README.md, CLAUDE.md, docs-site/, tests/, package.json, bin/, hooks/session-start.mjs, hooks/stop.mjs, hooks/user-prompt-submit.mjs

---

### Task A1 — Fix `hooks.json` SessionStart timeout (REQUIRED)

**File:** `hooks/hooks.json`  
**Change:** Line 10, `"timeout": 2` → `"timeout": 4`

**Why:** The installer (`scripts/installer.mjs` L214) writes `timeout: 4` to every user's `settings.json`. The `hooks.json` plugin manifest still says `2`. These must match. The 4s is intentional: `session-start.mjs` spends up to 1.5s on git fetch + 0.5s on checkout + Node startup; 2s is too tight and causes hook kills on slower machines. This was the root of the "SessionStart timeout fix" in v0.4.3 — the installer was updated but `hooks.json` was not.

**After change, verify:** Stop timeout (5) and UPS timeout (3) are unchanged.

---

### Task A2 — Remove stale review-label prefixes in `sync.mjs` (BLOAT)

**File:** `lib/sync.mjs`

Find every comment that starts with `// I1:`, `// I3:`, or `// I4:` and remove only the `Ix: ` prefix. Keep the rest of the comment text unchanged.

Example:
```
// I1: array args to spawnSync — no shell, no injection surface
```
becomes:
```
// array args to spawnSync — no shell, no injection surface
```

There are 3–4 such comments. Do not change any other comments or code.

---

### Task A3 — Trim planning note in `distiller.mjs` (BLOAT)

**File:** `distiller.mjs`, find lines:
```javascript
  // Model defaults to Haiku 4.5. To override, pass --model to distiller directly (wyren distill
  // does not yet expose WYREN_MODEL env var; that's a planned follow-up).
```

Replace with a single-line comment:
```javascript
  // Defaults to Haiku 4.5; pass --model to override.
```

Do not change any surrounding code.

---

## ═══════════════════════════════════
## AGENT B — README & CLAUDE.md
## ═══════════════════════════════════

**Scope (read + modify):**
- `README.md`
- `CLAUDE.md`

**Must NOT touch:**
- docs-site/, bin/, hooks/, lib/, distiller.mjs, tests/, package.json, scripts/

**Read first:** `AUDIT_NOTES.md` sections README-1, README-2, CLAUDE-1, CLAUDE-2.

---

### Task B1 — Update CLAUDE.md version and current state (REQUIRED)

**File:** `CLAUDE.md`

In the "Current state" block, the first sentence currently says:

> **v0.4.3 — distiller auth fix + SessionStart timeout fix.**

Change to:

> **v0.4.4 — sync integrity: Peer pushed status + UPS force-push detection.**

Then update the surrounding paragraph to cover v0.4.4 features by appending (after the sentence about Distiller fix):

> Sync integrity (2026-05-09): `wyren status` shows `Peer pushed: <timestamp> (author, N min ago)` from remote git log of `memory.md`. UPS hook runs ancestry check after pull — if remote `memory.md` was force-pushed (non-linear history), injects a ⚠️ warning into context.

Do NOT add changelog bullets. Update facts in place.

---

### Task B2 — Fix README.md Limitation #2 (REQUIRED)

**File:** `README.md`

Find this text (around line 155):
```
2. **Concurrent pushes retry automatically.** If two teammates distill at the same moment, the second push retries with `pull --rebase`. Resolves within one session without data loss.
```

Replace with:
```
2. **Concurrent pushes retry automatically.** If two teammates distill at the same moment and one push fails non-fast-forward, Wyren fetches the latest remote, fast-forwards HEAD if safe (no user commits lost), creates a fresh wyren-only commit, and retries — up to 3 attempts. If the branches have diverged (user commits not on remote), Wyren restores remote `.wyren/` files and leaves HEAD untouched. Resolves without data loss in the common case.
```

---

### Task B3 — Add `Peer pushed:` to `wyren status` commands table (REQUIRED)

**File:** `README.md`

Find the `wyren status` row in the Commands table (around line 93):
```
| `wyren status` | Shows memory file size, when distillation last ran, and git sync state. Run this if memory seems stale. |
```

Replace with:
```
| `wyren status` | Shows memory file size, distillation state, last injection, git sync state, and when a teammate last pushed memory (`Peer pushed:`). Run this if memory seems stale. |
```

---

## ═══════════════════════════════════
## AGENT C — Docs Site
## ═══════════════════════════════════

**Scope (read + modify):**
- `docs-site/src/content/docs/reference/cli.md`
- `docs-site/src/content/docs/reference/hooks.md`
- `docs-site/src/content/docs/roadmap/overview.md`
- `docs-site/src/content/docs/faq.md`
- `docs-site/src/content/docs/how-it-works.md`

**Must NOT touch:**
- README.md, CLAUDE.md, bin/, hooks/, lib/, distiller.mjs, tests/, package.json

**Read first:** `AUDIT_NOTES.md` sections CLI-1, CLI-2, HOOKS-1, HOOKS-2, ROAD-1, ROAD-2, FAQ-1, FAQ-2, HIW-1.

**Dependency note:** Task C3 (hooks.md timeout) should be done after confirming Agent A has fixed `hooks.json` to 4s. If in doubt, update to 4s — that is the correct installer value regardless.

---

### Task C1 — Add `Peer pushed:` to `wyren status` example output (REQUIRED)

**File:** `docs-site/src/content/docs/reference/cli.md`

Find the `wyren status` example block (around line 100–113):
```
Remote:     origin → https://github.com/team/project.git
```

Insert a new line immediately after the `Remote:` line and before the closing code fence:
```
Peer pushed:  2026-05-08T09:12:00.000Z (alice, 47 min ago)
```

Also update the prose below the block that describes what each field shows — add a sentence:
> `Peer pushed:` shows the timestamp and author of the last remote commit that touched `.wyren/memory.md`.

---

### Task C2 — Update `wyren --version` example to 0.4.4 (MINOR)

**File:** `docs-site/src/content/docs/reference/cli.md`

Find (around line 161):
```
wyren 0.4.1
```
Replace with:
```
wyren 0.4.4
```

---

### Task C3 — Fix SessionStart hook budget in hooks.md (REQUIRED)

**File:** `docs-site/src/content/docs/reference/hooks.md`

Find (around line 47–48):
```
Internal timeouts cap fetch at **1.5s** and checkout at **0.5s**; hook-level budget is **2s** total.
```
Replace with:
```
Internal timeouts cap fetch at **1.5s** and checkout at **0.5s**; hook-level budget is **4s** total, providing a 2s buffer for Node startup and file I/O.
```

---

### Task C4 — Add force-push detection to UPS behavior list (REQUIRED)

**File:** `docs-site/src/content/docs/reference/hooks.md`

Find the UPS Behavior section numbered list (around line 118–124). It currently has steps 1–5. After step 1 (Pull), insert a new step:

```
1b. If the pull succeeded, compare the last-known remote commit SHA for `.wyren/memory.md` (stored in `ups-state.json`) against the current remote SHA. If the current commit is not a descendant of the last-known commit (non-linear history), set a ⚠️ force-push warning that will be prepended to any injected delta. This protects against a teammate accidentally force-pushing a rewrite of memory.
```

Renumber subsequent steps if your tooling requires it (they do not need strict numbering in Markdown).

---

### Task C5 — Fix `--bare` reference in Roadmap Chunk 1 (REQUIRED)

**File:** `docs-site/src/content/docs/roadmap/overview.md`

Find (around line 47–48):
```
Key detail: subprocess runs with `claude -p --bare` — strips global plugins/hooks so only the distill prompt reaches the model.
```

Replace with:
```
Key detail: subprocess runs with `claude -p --no-session-persistence` — prevents session state from contaminating the distill call. (`--bare` was removed in v0.4.3: it also stripped OAuth/keychain auth, causing "Not logged in" errors in detached processes.)
```

---

### Task C6 — Add post-ship entries for v0.4.3 and v0.4.4 to Roadmap (REQUIRED)

**File:** `docs-site/src/content/docs/roadmap/overview.md`

**Step 1:** Add two rows to the Timeline table after the last existing row (`Post-ship` / Install file cleanup / 2026-05-06):

```markdown
| [Post-ship](/roadmap/overview/#post-ship--distiller-auth-fix-v043) | 2026-05-08 | Distiller auth fix + SessionStart timeout | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--sync-integrity-v044) | 2026-05-09 | Sync integrity: Peer pushed + force-push detection | <Badge text="Shipped" variant="success" /> |
```

**Step 2:** Add two `## Post-ship` sections at the bottom of the file:

```markdown
## Post-ship — Distiller auth fix + SessionStart timeout (v0.4.3, 2026-05-08) ✅

**Shipped.** Two fixes for distiller reliability and hook stability.

- **`distiller.mjs`**: Removed `--bare` flag (stripped OAuth/keychain auth → "Not logged in" in detached processes) and `--tools ''` (flag removed from CC CLI). Now uses `--no-session-persistence` only.
- **`scripts/installer.mjs`**: Raised SessionStart hook timeout from 2s to 4s in the installed `settings.json` entry, providing a 2s buffer for Node startup + git operations above the 2s internal cap.

Test totals: **185 pass / 187 total (2 skip POSIX-only) + 32 e2e.**

## Post-ship — Sync integrity (v0.4.4, 2026-05-09) ✅

**Shipped.** Two observability and safety features for shared memory sync.

- **`bin/wyren.mjs` (`wyren status`)**: Added `Peer pushed:` line — shows timestamp, author, and age of the last remote commit to `.wyren/memory.md`. Requires no network call; reads from `origin/<branch>` ref cached by the last fetch.
- **`hooks/user-prompt-submit.mjs`**: Added ancestry check after each pull. If the remote `memory.md` commit is not a descendant of the last-known remote commit, injects a ⚠️ warning into context: "remote memory.md was force-pushed — treat injected context with extra caution." Fail-open; never blocks the session.
- **`tests/wyren-status.test.mjs`**: New test file — verifies `Peer pushed:` line always appears in `wyren status` output.

Test totals: **185 pass / 187 total (2 skip POSIX-only) + 32 e2e.**
```

---

### Task C7 — Fix faq.md push-retry description (REQUIRED)

**File:** `docs-site/src/content/docs/faq.md`

Find the "What if git push fails?" answer (around line 26–28):
```
Wyren retries with `pull --rebase` up to 3 times. On final failure, the memory update stays local — it'll push on the next successful distill. Teammates are out of sync for one cycle. Documented as acceptable.
```

Replace with:
```
Wyren retries up to 3 times. On conflict, it fetches the latest remote, fast-forwards local HEAD if safe (no user commits diverged), creates a fresh wyren-only commit, and retries. If the branches have diverged (user commits not on remote), Wyren restores remote `.wyren/` files and leaves HEAD untouched — run `git fetch && git rebase origin/<branch>` then `wyren distill --push` to recover. On final failure, the memory update stays local — it will push on the next successful distill.
```

---

### Task C8 — Fix faq.md merge-conflict description (REQUIRED)

**File:** `docs-site/src/content/docs/faq.md`

Find the "How does Wyren handle merge conflicts on `memory.md`?" answer (around line 77–81):
```
If the actual content conflicts on the same lines (rare), Wyren takes `--theirs` (the incoming version) and re-distills locally. Ships the later one.
```

Remove that sentence entirely. The paragraph before it (about non-fast-forward push retry) has already been updated in Task C7. The second paragraph in the answer now reads:

```
If branches have diverged (user commits not on remote), Wyren restores the remote `.wyren/` files and leaves user code untouched. Resolve with `git fetch && git rebase origin/<branch>`, then re-run `wyren distill --push`.
```

---

### Task C9 — Fix "Tier 0 regex filter" in how-it-works.md (MINOR)

**File:** `docs-site/src/content/docs/how-it-works.md`

Find (around line 89):
```
3. Runs **Tier 0 regex filter** — skips if no signal words (`decide`, `won't`, `workaround`, `rejected`, ...) found. Kills ~70% of triggers for free.
```

Replace with:
```
3. Runs **Tier 0 weighted signal filter** — scores the transcript across decision, rejection, hack, scope-change, and structural signals (session length, edit count). Skips the API call if the score falls below threshold. Kills ~70% of triggers for free.
```

---

## Final integration review checklist (orchestrator, post-agents)

After all three agents complete, verify:

- [ ] `hooks.json` SessionStart timeout = 4 (Agent A)
- [ ] `wyren distill --push` is documented consistently in README (commands table + limitation #2), CLAUDE.md, cli.md — all three should have it
- [ ] Test counts 185/187 + 32 e2e appear in CLAUDE.md and roadmap v0.4.4 section
- [ ] Hook timeouts 4s/5s/3s are consistent across hooks.json, hooks.md, CLAUDE.md
- [ ] `Peer pushed:` appears in README commands table, cli.md wyren status example
- [ ] `--bare` is gone from roadmap Chunk 1 and replaced with `--no-session-persistence`
- [ ] faq.md has no remaining references to `--theirs` or `pull --rebase`
- [ ] No file was touched by more than one agent (git diff groupings)
- [ ] Three originally-known broken-state items remain fixed (not reverted by any agent)
