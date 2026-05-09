# Dev B — Wyren Simulation Session

**Replace `<BASE_PATH>` below with the path printed by `node sim/setup.mjs`.**

```
BASE_PATH = <BASE_PATH>
```

---

**Your role:** You are Developer B. You cold-started — you have no memory of any prior
conversation. Wyren's SessionStart hook should have injected what Developer A distilled.
You implement follow-on work based only on what Wyren tells you. You **NEVER** read Dev
A's prompt or Dev A's log entries — Wyren is the only communication channel. You also
**never** read Dev A's commit messages directly: only what Wyren surfaced counts as a
valid signal.

**Logging rule:** After every numbered step below, append the logging block (defined at
the bottom of this prompt) to `$BASE_PATH/wyren-sim-log.md`. Use a single Write or Edit
tool call per block. Do not interleave reads and writes mid-block.

**Working directory:** Your Claude Code session must be opened with `workspace-b/` as
the CWD — the path that `node sim/setup.mjs` printed under "Workspace B". Wyren hooks
read `cwd` from stdin; opening Claude Code in the wrong directory means no injection.

---

## Round 0 — Bootstrap

### Step 1 — Cold start

This is your first turn. Quoting the SessionStart injection **is the test**. Wyren's
SessionStart hook should have pulled the remote and injected Dev A's distilled memory
as a `system-reminder` block. It looks like:

```
# Wyren Memory
...
```

Quote the injected block **verbatim** in the **Wyren said:** section of your log entry.
If the injection is empty or absent — especially if Dev A has already distilled and pushed —
that is a **finding**: log it as confusing and mark the staleness detection condition as
FAIL in the eventual report.

If the injection **does** reflect what A did (feature choice, architectural decision), that
is a PASS for the SessionStart injection path.

Log Step 1.

---

## Round 1 — Follow-on feature

### Step 2 — Bootstrap your transcript

Run a brief session opener — any short task — so Claude Code writes a transcript. This
sets `last_transcript` in the watermark, which `wyren distill` needs later.

Example: ask Claude to summarize the counter app in one sentence.

Log Step 2 (no wyren CLI output expected; log what Wyren injected on this turn, if
anything changed from Step 1).

### Step 3 — Choose a dependent feature

Based **only** on what Wyren injected about Dev A's decision, pick a **dependent**
follow-on improvement. Examples:

- If A added persistence → B adds a "clear storage" button
- If A added dark mode → B detects and follows system color-scheme preference
- If A added undo → B adds redo
- If A added keyboard shortcuts → B adds a visible shortcut legend
- If A added animation → B adds a preference toggle to disable it

If Wyren's injection gave you no signal about what A chose, note that as a finding and
improvise independently.

Log Step 3.

### Step 4 — Implement

Edit or create only files inside this workspace's counter-app working tree. Never
modify any Wyren plugin source file (anything under `.wyren/`, `bin/`, `hooks/`,
`lib/`, `scripts/`).

Log Step 4.

### Step 5 — Commit

Stage only the files you changed:

```
git add sim/starter/index.html sim/starter/app.js sim/starter/style.css
git commit -m "feat: <your one-line summary>"
```

Log Step 5 with exact git output and exit code.

### Step 6 — Distill and push

> **Prerequisite:** `wyren distill` needs `last_transcript` in the watermark. Step 2
> should have created one. If this step fails with "No transcript found", have any brief
> exchange first, then re-run.

If `wyren` is on your PATH:
```
wyren distill --force --push
```

If not, ask the human for the Wyren repo path, then:
```
node <WYREN_REPO>/bin/wyren.mjs distill --force --push
```

Log Step 6 with **full** stdout, stderr, and exit code. A `0` exit means success. A `2`
exit means sync lock was busy — retry once.

After distill completes, run `wyren status` and include that output in the same CLI
output block.

### Step 7 — Halt

Print exactly:

> `Round 1 done. Waiting for human GO Round 2.`

Do not proceed until the human says "GO Round 2".

Log Step 7.

---

## Round 2 — Simultaneous edit

### Step 8 — Add a "set to zero" button

When the human says "GO Round 2", read the current state of the counter app. Add a
**"set to zero"** button (distinct from a reset button — Dev A may be adding "reset"
at the same time).

Developer A is doing this concurrently in their session — the race is intentional.
Implement and save your change.

Log Step 8.

### Step 9 — Commit and distill

```
git add sim/starter/index.html sim/starter/app.js sim/starter/style.css
git commit -m "feat: add set-to-zero button"
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

## Round 3 — Conflict recovery observation

### Step 11 — Receive A's force-push

When the human says "GO Round 3" (after Dev A has force-pushed a corrupted `memory.md`),
your next user turn triggers the UPS hook. The hook will pull from the remote — which
now contains A's bogus marker — and diff against your last injection.

Quote what Wyren injected **verbatim**. Answer these questions in your log entry:

- Is the bogus marker `BOGUS-CONFLICT-MARKER-FROM-A` visible in what Wyren showed you?
- Did Wyren warn you about the diverged history? (Check `.wyren/log` for any error lines.)
- Did the sync log show a rebase or forced-fetch recovery path?

Run:
```
cat .wyren/log
```
(On Windows: `Get-Content .wyren/log`)

Log Step 11 with all observations and the log tail.

### Step 12 — Halt

Print exactly:

> `Round 3 done. Waiting for human GO Round 4.`

Log Step 12.

---

## Round 4 — Staleness check

### Step 13 — Observe stale memory

When the human says "GO Round 4", send any prompt. Your UPS hook fires, pulls from the
remote, and diffs.

Dev A ran `wyren distill --force` (without `--push`) before this round. Their updated
`memory.md` was **not** pushed to the remote. That means the remote does not have A's
Round 4 changes.

Quote what Wyren injected verbatim. Answer these questions:

- Does the injection reflect A's latest changes (Round 4 marker)?
- Does anything in the injection signal that A's memory may be stale or out of date?
- Is there any Wyren status indicator, timestamp, or warning that suggests freshness?

Run:
```
wyren status
```

Note whether the "Distilled:" or "Remote:" fields give any hint of staleness. Currently,
Wyren does not signal staleness when a peer skips `--push` — **that is a real UX
finding**. Log it explicitly if confirmed.

Log Step 13 with full observations and `wyren status` output.

### Step 14 — Halt

Print exactly:

> `Round 4 done. Awaiting A's final report.`

Log Step 14.

---

## Final

### Step 15 — Done

When the human says "GO Final", run `wyren status` one last time and log what it shows.
Then write your final log entry:

> `Done. Awaiting A's report.`

Dev A will write the combined `wyren-sim-report.md`. Your job is complete.

Log Step 15.

---

## Logging contract

After every numbered step, append this block to `$BASE_PATH/wyren-sim-log.md`.
Use a **single** Write or Edit tool call per block.

````
## B — Step N (<short label>)

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
