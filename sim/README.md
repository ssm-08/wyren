# Wyren Two-Session Simulation

A self-contained harness that runs two real Claude Code sessions as simulated
developers (Dev A and Dev B) collaborating on a counter app. The sessions
communicate exclusively through Wyren's synced `.wyren/memory.md` — no
direct messages, no shared state other than the git remote. The sim validates
the full loop: session work → distill → push → pull → inject at next turn.

---

## Prerequisites

- Wyren installed globally and wired:
  ```
  npm install -g @ssm-08/wyren && wyren install
  ```
- Confirm hooks are live:
  ```
  wyren doctor
  ```
- Two terminal windows capable of running Claude Code (can be the same
  machine; each window gets its own `cwd`).
- Working directory: repo root (`C:\...\Vibejam` or wherever you cloned).
- Branch: `feature/two-session-sim`.

---

## Quick start

1. **Scaffold** two clones around a local bare repo:
   ```
   node sim/setup.mjs
   ```
   Setup prints paths for `dev-a` and `dev-b` and writes `sim/.last-base`.

2. **Open Session A** — Claude Code window 1:
   ```
   cd <base>/dev-a
   ```
   Paste the contents of `sim/prompts/dev-a.md` as your first message.

3. **Open Session B** — Claude Code window 2:
   ```
   cd <base>/dev-b
   ```
   Paste the contents of `sim/prompts/dev-b.md` as your first message.

4. **Conduct the rounds** — follow the "GO" cues in each prompt file. After
   each round, check `<base>/wyren-sim-log.md` for the shared log appended
   by each session.

5. **Tear down** when done:
   ```
   node sim/teardown.mjs --yes
   ```

---

## What the sim tests

| Step | What fires | What to verify |
|------|-----------|----------------|
| Session A starts | `SessionStart` hook pulls + injects memory | A's context block shows Wyren memory |
| A makes edits, session ends | `Stop` hook triggers distiller | `.wyren/memory.md` updated on `dev-a` |
| Distiller pushes | `git push origin HEAD` to bare repo | Bare repo has new commit |
| B's next turn | `UserPromptSubmit` pulls + injects delta | B's context block shows A's changes |
| B makes edits | Same distill → push cycle | A sees B's work on next session start |

---

## Stress conditions

| Scenario | How to trigger | Expected behavior |
|----------|---------------|------------------|
| Simultaneous distill | Both sessions hit Stop at same time | One acquires `distill-trigger.lock`; second skips (lock exits 0, tries next turn) |
| Push conflict | Both push before either pulls | Wyren's rebase recovery handles non-fast-forward; one session wins, other retries |
| Stale memory at UPS | B turns before distill completes | Previous memory injected this turn; fresh delta injected on next UPS |
| Cold start (no watermark) | Remove `.wyren/state/` before session | Session starts cleanly; distill triggers after threshold turns |

---

## Troubleshooting

**Memory not injected at SessionStart:**
- Run `wyren doctor` — confirms hooks are wired in `~/.claude/settings.json`.
- Check `hooks.json` timeout is `4` (not `0`). A `0`-second timeout aborts
  the hook immediately.
- Check `.wyren/log` in the clone for pull errors (network, permission).

**Both sessions append to the log at the same time and lines interleave:**
This is expected — `wyren-sim-log.md` has no write lock. Lines from concurrent
appends may interleave at byte boundaries. Manually reorder them after the
fact, or have each session write a separate file (edit the prompts).

**`git push` fails in setup.mjs:**
Most common cause: git's default branch (`main`) doesn't match `master`.
`setup.mjs` uses `git init -b master` with a `symbolic-ref` fallback. Check
git version (`git --version`) — if < 2.28, the fallback runs automatically.
If push still fails, check the bare repo: `git -C <base>/bare.git branch -a`.

**`wyren init` errors inside setup.mjs:**
Ensure `bin/wyren.mjs` is executable and the repo's `node_modules` are
present (no `node_modules` needed — wyren has zero runtime deps).

---

## Notes

- This harness does not require a GitHub remote. The shared remote is a local
  bare git repo (`file:///...`), identical to how `tests/fault-e2e-livesync.test.mjs`
  scaffolds multi-repo tests.
