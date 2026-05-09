# Dev A — Wyren Simulation Session

**Replace `<BASE_PATH>` below with the path printed by `node sim/setup.mjs`.**

```
BASE_PATH = <BASE_PATH>
```

---

**Your role:** You are Developer A. You lead the feature work and make architectural
decisions. You collaborate with Developer B in a separate Claude Code session, but you
**NEVER** read their prompt or log entries — Wyren is the only communication channel.

**Logging rule:** After every numbered step below, append the logging block (defined at
the bottom of this prompt) to `$BASE_PATH/wyren-sim-log.md`. Use a single Write or Edit
tool call per block. Do not interleave reads and writes mid-block.

**Working directory:** Your Claude Code session must be opened with `workspace-a/` as
the CWD — the path that `node sim/setup.mjs` printed under "Workspace A". Wyren hooks
read `cwd` from stdin; opening Claude Code in the wrong directory means no injection.

---

## Round 0 — Bootstrap

### Step 1 — Cold start

This is your first turn. Wyren's SessionStart hook should have injected `memory.md`
content as a `system-reminder` block. It looks like:

```
# Wyren Memory
...
```

Quote the injected block **verbatim** in the **Wyren said:** section of your log entry.
If the injection is empty or absent, log `no injection this turn` and mark it as
confusing — that is a real finding.

Log Step 1.

---

## Round 1 — Feature

### Step 2 — Choose a feature

Read these three files:
- `sim/starter/index.html`
- `sim/starter/app.js`
- `sim/starter/style.css`

Pick **one** improvement from this menu (improvise the implementation):
- Persist counter to localStorage
- Dark-mode toggle
- Undo button
- Keyboard shortcuts (+ and -)
- Animated count change

Log Step 2 (no CLI output yet — just log what Wyren injected on this turn, if anything).

### Step 3 — Document the architectural decision

In 2–3 plain-English sentences, explain:
> "Chose X over Y because Z."

This is a positive observation — put it in the **Felt broken** field of the Step 3
log entry (e.g., "No issues — chose localStorage over session state because it survives
page refreshes.").

Log Step 3.

### Step 4 — Implement

Edit or create only files inside this workspace's counter-app working tree
(`sim/starter/` in workspace-a, or wherever the starter files are). Never modify
any Wyren plugin source file (anything under `.wyren/`, `bin/`, `hooks/`, `lib/`,
`scripts/`).

Log Step 4.

### Step 5 — Commit

Stage only the files you changed. Do not use `git add .`:

```
git add sim/starter/index.html sim/starter/app.js sim/starter/style.css
git commit -m "feat: <your one-line summary>"
```

Log Step 5 with the exact git output and exit code.

### Step 6 — Distill and push

> **Prerequisite:** `wyren distill` needs `last_transcript` in the watermark. This is
> written when Claude Code first runs a session. If Step 6 fails with
> "No transcript found", have any brief exchange (ask anything), then re-run.

If `wyren` is on your PATH:
```
wyren distill --force --push
```

If not, ask the human for the Wyren repo path, then:
```
node <WYREN_REPO>/bin/wyren.mjs distill --force --push
```

Log Step 6 with **full** stdout, stderr, and exit code. A `0` exit means distill +
push succeeded. A `2` exit means the sync lock was busy — retry once.

After distill completes, run `wyren status` (or the node equivalent) and include that
output in the same CLI output block.

### Step 7 — Halt

Print exactly:

> `Round 1 done. Waiting for human GO Round 2.`

Do not proceed until the human says "GO Round 2".

Log Step 7 (no CLI output; note in **Felt broken** if anything in Rounds 1–7 felt
underdocumented).

---

## Round 2 — Simultaneous edit

### Step 8 — Add a reset button

When the human says "GO Round 2", read the current state of the counter app. Add a
**"reset"** button to the header that resets the counter to 0.

Developer B is doing this concurrently in their session — the race is intentional.
Implement and save your change.

Log Step 8.

### Step 9 — Commit and distill

```
git add sim/starter/index.html sim/starter/app.js sim/starter/style.css
git commit -m "feat: add reset button"
wyren distill --force --push
```

Log Step 9 with **all** output: git commit, distill stdout/stderr/exit code, and any
non-fast-forward or rebase messages that appear from sync (Wyren rebases on conflict —
log the full block if you see it).

### Step 10 — Halt

Print exactly:

> `Round 2 done. Waiting for human GO Round 3.`

Log Step 10.

---

## Round 3 — Forced conflict

### Step 11 — Corrupt memory.md

When the human says "GO Round 3":

1. Open `.wyren/memory.md` in this workspace.
2. Insert this **exact** line at the very top of the file:
   ```
   BOGUS-CONFLICT-MARKER-FROM-A
   ```
3. Save, stage, commit, and force-push:
   ```
   git add .wyren/memory.md
   git commit -m "test: inject bogus conflict marker"
   git push --force
   ```

Log Step 11 with full git output.

> **Note:** `git push --force` overwrites the remote. This is intentional — the test
> checks whether B's next UPS pull recovers from a diverged history.

### Step 12 — Observe UPS recovery

Wait for the human to say "next turn". On your next user turn the UPS hook fires
automatically (it pulls from the remote and diffs against your last injection). Quote
what Wyren injected **verbatim**. Answer these questions in your log entry:

- Did the bogus marker survive in what Wyren showed you?
- Was it overwritten by B's state?
- Does it coexist with B's content?

Then run:
```
wyren status
```

Log Step 12 with all observations and the `wyren status` output.

### Step 13 — Halt

Print exactly:

> `Round 3 done. Waiting for human GO Round 4.`

Log Step 13.

---

## Round 4 — Stale memory

### Step 14 — Local-only distill

When the human says "GO Round 4":

1. Make a tiny change to the counter app (e.g., add a CSS comment):
   ```css
   /* sim round 4 */
   ```
2. Commit:
   ```
   git add sim/starter/style.css
   git commit -m "chore: round 4 marker"
   ```
3. Distill **without** pushing:
   ```
   wyren distill --force
   ```
   The distiller should succeed (exit 0). Log the **actual** exit code — if it is
   something else, note it as unexpected.

Log Step 14 with full distiller output and exit code.

### Step 15 — Halt without pushing

Do **not** run `--push`. Your updated `memory.md` is committed locally but not synced
to the bare remote. This is the condition Dev B will observe on their next turn.

Print exactly:

> `Round 4 done. Waiting for B's staleness observation, then GO Final.`

Log Step 15.

---

## Final — Report

### Step 16 — Read combined log

When the human says "GO Final", read the entire file `$BASE_PATH/wyren-sim-log.md`.
It contains both your entries (`A — Step N`) and Dev B's entries (`B — Step N`).

### Step 17 — Write report

Create `$BASE_PATH/wyren-sim-report.md` with this exact structure (fill in the
content from the log):

```markdown
# Wyren Two-Session Simulation Report
Date: <ISO 8601 date>
Base: <BASE_PATH>

## Stress conditions

| Condition | Result | Evidence |
| --- | --- | --- |
| Simultaneous distill | PASS / FAIL / PARTIAL | <log entry refs, e.g. "A-Step9, B-Step9"> |
| Memory.md merge conflict recovery | PASS / FAIL / PARTIAL | <log entry refs> |
| Stale memory (no push) detection | PASS / FAIL / PARTIAL | <log entry refs> |

## Friction points
- <one bullet per step where something was slower or more manual than expected>

## Silent failures
- <one bullet per behavior that was confusing, missing, or undocumented>

## Recommendations
- <one bullet per concrete change to the wyren codebase or docs>
```

Log Step 17.

---

## Logging contract

After every numbered step, append this block to `$BASE_PATH/wyren-sim-log.md`.
Use a **single** Write or Edit tool call per block.

````
## A — Step N (<short label>)

**Wyren said:**
```
<verbatim quote of memory injected by SessionStart or UserPromptSubmit
 this turn, or the literal text "no injection this turn">
```

**CLI output:**
```
<verbatim stdout + stderr + exit code from any wyren / git commands run>
```

**Felt broken / silent / confusing?** <one sentence; "no" is fine>
````
