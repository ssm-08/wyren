---
title: Roadmap — how Relay was built
description: Six build chunks plus post-ship phases. All shipped.
---

import { Badge } from '@astrojs/starlight/components';

## Timeline

| Chunk | Hours | Name | Status |
|---|---|---|---|
| [0](/roadmap/overview/#chunk-0) | Pre-build | Documentation site | <Badge text="Shipped" variant="success" /> |
| [1](/roadmap/1-distiller/) | 0-6 | Distiller quality gate | <Badge text="Shipped" variant="success" /> |
| [2](/roadmap/2-skeleton/) | 6-14 | Plugin skeleton + injection | <Badge text="Shipped" variant="success" /> |
| [3](/roadmap/3-distillation/) | 14-22 | Distiller wired to Stop hook | <Badge text="Shipped" variant="success" /> |
| [4](/roadmap/4-git-sync/) | 22-32 | Git sync layer | <Badge text="Shipped" variant="success" /> |
| [5](/roadmap/5-broadcast/) | 32-44 | Broadcast + polish + demo | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--deployability-v1) | 2026-04-23 | Cross-platform installer | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--live-sync--fault-hardening) | 2026-04-23 | Live sync + fault hardening | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--code-review--live-testing-polish) | 2026-04-23 | Code review + live testing polish | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--filter-upgrade--install-polish) | 2026-04-24 | Weighted Tier 0 + install polish | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--windows-ci-fix) | 2026-04-24 | Windows CI fix | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--e2e-fixes--cli-polish) | 2026-04-24 | E2E fixes + CLI polish | <Badge text="Shipped" variant="success" /> |
| [Post-ship](/roadmap/overview/#post-ship--parallel-code-review--integration) | 2026-04-24 | Parallel code review + integration | <Badge text="Shipped" variant="success" /> |

## How the build was sequenced

1. **Each chunk had exit criteria.** The next chunk did not start until current criteria passed.
2. **Chunk 1 was the go/no-go gate.** If distiller quality had failed, the project would have pivoted to handoff-only. All downstream infra depends on it.
3. **Living docs discipline.** Each chunk ended with a docs update. Docs shipped with code.

## Chunk 0 — Documentation site (this site)

**Goal:** every teammate can read this site cold and answer: what is Relay, what problem, what's the stack, what ships when, how much it costs, how to install.

**Stack:** Astro Starlight → GitHub Pages. Markdown content, built-in search, dark mode, Mermaid diagrams.

**Exit criteria:**
- Deployed URL reachable; sidebar + search + dark mode all work.
- Unseen teammate reads site for 10 min and can answer five core questions unaided.
- Site committed + pushed; Actions green.

## Chunk 1 — Distiller quality gate (Hours 0-6) ✅

**Gate passed.** `distiller.mjs` + `lib/transcript.mjs` + `lib/memory.mjs` + `prompts/distill.md`. Tested on a real 828-line planning transcript: 34-line final memory, hygiene test passed (resolved item correctly dropped on incremental pass), blind A/B 3/3 non-obvious facts captured.

Key detail: subprocess runs with `claude -p --bare` — strips global plugins/hooks so only the distill prompt reaches the model.

[Full Chunk 1 detail + test results →](/roadmap/1-distiller/)

## Chunk 2 — Plugin skeleton + injection (Hours 6-14) ✅

**Shipped.** Plugin hooks wired via `~/.claude/settings.json`. `SessionStart` hook reads `.relay/memory.md` + broadcast files, injects as `additionalContext`. `relay init` sets up `.relay/` structure. 17 unit tests green. E2E verified via hook pipe test.

New files: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/run-hook.cmd`, `hooks/session-start.mjs`, `hooks/stop.mjs` (stub), `bin/relay.mjs`, `lib/util.mjs`.

[Full Chunk 2 detail →](/roadmap/2-skeleton/)

## Chunk 3 — Distiller wired into Stop hook (Hours 14-22) ✅

**Shipped.** `stop.mjs` spawns distiller detached after 5 turns (or 2min idle since last distillation). Tier 0 regex filter in `lib/filter.mjs` skips API calls when the transcript slice has no signal words or Edit/Write tool use. Default model changed to Haiku 4.5. `distiller_running` lock prevents concurrent runs. 29 unit tests green.

Key detail: the Tier 0 regex matches the *rendered* transcript format (`[tool_use Edit]`), not raw JSONL — a subtle but important distinction since the distiller operates on rendered prose, not the raw event stream.

[Full Chunk 3 detail →](/roadmap/3-distillation/)

## Chunk 4 — Git sync layer (Hours 22-32) ✅

**Shipped.** `lib/sync.mjs` — `GitSync` with `pull()` (fetch + scoped checkout of `.relay/` files, 3s timeout, `RELAY_SKIP_PULL` escape), `push()` (commit + retry-on-conflict, `reset --mixed FETCH_HEAD` on conflict so local HEAD stays in sync — no infinite re-conflict loop), `lock()` (atomic `openSync('wx')`, 60s stale-steal). Session-start pulls before injecting context; distiller pushes after atomic write. `relay status` and `relay distill [--force|--push|--dry-run]` CLI commands. 38 unit tests green (including two-machine conflict scenario).

Key implementation detail: conflict resolution uses `reset --mixed FETCH_HEAD` rather than `--theirs + rebase --continue`. Safer on Windows (no GIT_EDITOR needed), leaves working tree untouched outside `.relay/`, and correctly advances local HEAD to remote tip.

[Full Chunk 4 detail →](/roadmap/4-git-sync/)

## Chunk 5 — Broadcast + polish + demo (Hours 32-44) ✅

**Shipped.** Skills/CLAUDE.md broadcast via `.relay/broadcast/`. `relay broadcast-skill <name>` CLI copies a local skill file to `.relay/broadcast/skills/` for teammates to receive on their next `SessionStart`. Session-start injects broadcast content as additional context; an acknowledgment instruction prompts Claude to announce loaded skills in its first message. 46 unit tests green (6 broadcast-skill + 9 session-start + rest from prior chunks).

**Exit criteria:** full scripted demo runs end-to-end in under 4 minutes without intervention.

[Full Chunk 5 detail →](/roadmap/5-broadcast/)

## Post-ship — Deployability v1 (2026-04-23) ✅

**Shipped.** Cross-platform installer closes the biggest adoption blocker — teammates on macOS had no automated install path.

New files: `install.sh` (macOS/Linux one-liner), `install.ps1` (Windows one-liner), `scripts/installer.mjs` (shared Node logic — preflight, symlink/junction, settings.json JSONC-tolerant patch, atomic write, verify, update, uninstall, doctor).

New CLI subcommands: `relay install`, `relay update`, `relay uninstall`, `relay doctor`. `setup.ps1` shrunk to deprecation stub. CI matrix added: ubuntu unit tests + macOS + Windows e2e. Heavy code review caught 3 Important bugs before merge.

Test totals after this work: **79 unit tests + 27 e2e tests = 106 total.**

[Install guide →](/reference/install/)

## Post-ship — Live sync + fault hardening (2026-04-23) ✅

**Shipped.** B's running session now receives A's new memory automatically — no restart required.

New files: `hooks/user-prompt-submit.mjs` (`UserPromptSubmit` hook — pulls `.relay/memory.md` on each user turn with a **1.5s fetch cap** + **3s hook budget**, diffs against a stored snapshot, injects only the delta as `additionalContext`), `lib/diff-memory.mjs` (pure section-aware diff + hash utilities, no deps).

State file: `.relay/state/ups-state.json` — owned exclusively by the UPS hook (stores snapshot hash + last-pull timestamp). `RELAY_SKIP_PULL=1` skips the pull; diff still runs from disk.

**Fault injection testing** caught two bugs before they reached users: (1) EISDIR crash when `.relay/state/` directory exists but `ups-state.json` is absent; (2) watermark race between Stop hook and UPS — resolved by giving each hook exclusive ownership of its own state file. `windowsHide: true` added to remaining `spawnSync` calls.

New test files: `tests/fault-network.test.mjs`, `tests/fault-corruption.test.mjs`, `tests/fault-concurrency.test.mjs`, `tests/fault-e2e-livesync.test.mjs` (53 fault tests).

Test totals after this work: **131 unit tests + 32 e2e tests = 163 total.**

## Post-ship — Code review + live testing polish (2026-04-23) ✅

**Shipped.** Two-machine live test surfaced 9 additional bugs; systematic code review caught 9 more. All fixed before any second user touched the plugin.

Key fixes:
- **Installer**: `${CLAUDE_PLUGIN_ROOT}` doesn't expand in `settings.json` (only in plugin `hooks.json`) — installer now writes absolute repoDir path. UTF-8 BOM in `settings.json` (written by PowerShell) crashed the JSONC parser — stripped on read. `relay install` + `relay update` now register the `relay` CLI globally via `npm install -g`; `relay uninstall` deregisters and deletes the clone.
- **UPS hook**: fetch timeout 1s→1.5s, hook budget 2s→3s — fixes timeouts on higher-latency connections.
- **Stop hook**: `distiller_running` could get permanently stuck if the OS killed the distiller process mid-flight — PID liveness check added to `shouldDistill`. `RELAY_TURNS_THRESHOLD` + `RELAY_IDLE_MS` env vars added for test-cycle acceleration.
- **sync.mjs**: `resetWatermarkTurns` used non-atomic write and didn't clear `distiller_running` on conflict recovery — both fixed.
- **Tests**: `RELAY_ROOT` in three fault test files used raw URL pathname (spaces → `%20` → ENOENT); `fault-concurrency` had a hardcoded machine path. All fixed with `fileURLToPath`.

Test totals unchanged: **131 unit + 32 e2e = 163 total** (all passing).

## Post-ship — Filter upgrade + install polish (2026-04-24) ✅

**Shipped.** Tier 0 filter overhauled from a simple presence-check regex to a weighted scoring system. Parallel agent session delivered the changes; reviewer session caught and fixed 4 bugs before merge; installer files polished.

Key changes:
- **`lib/filter.mjs`**: `scoreTier0()` — categorized signal weights (1–3), structural scoring on raw JSONL lines (session length, avg user message length, edit count), `RELAY_TIER0_THRESHOLD` env var (default 3), `MultiEdit` tool detection. `hasTier0Signal()` is backwards-compatible, logs score + breakdown to `.relay/log`.
- **`distiller.mjs`**: passes raw `sliced` lines to `hasTier0Signal` so structural signals score correctly.
- **`bin/relay.mjs`**: `relay init` seeds `memory.md` from `CLAUDE.md` if present (8 KB cap, skips empty/directory, one-time import).
- **Install files**: executable bits set in git (`100644→100755`) for `bin/relay.mjs`, `hooks/run-hook.cmd`, `install.sh`, `scripts/installer.mjs`; `install.sh` now respects `RELAY_HOME`; `install.ps1` `$Args→$RelayArgs` (PS reserved variable), `$clone` quoted for space-in-path safety; `installer.mjs` surfaces npm stderr on CLI registration failure.
- **Reviewer fixes**: `scoreTier0(null/undefined)` no longer throws; `EISDIR` crash when `CLAUDE.md` is a directory; empty `CLAUDE.md` skipped; `test-e2e.mjs` H1/H4 assertions updated for absolute-path installer (stale `${CLAUDE_PLUGIN_ROOT}` check).

Test totals: **137 unit (136 pass, 1 skip POSIX-only) + 32 e2e = 169 total.**

## Post-ship — Windows CI fix (2026-04-24) ✅

**Shipped.** Two targeted fixes to make CI green on Windows Server 2022.

1. **`scripts/installer.mjs` `inspectLink()`** — extracted `stripWinPathPrefix()` helper strips both `\\?\` (Win32 extended) and `\??\` (NT namespace) prefixes from `readlinkSync` output. Windows Server 2022 returns the NT-namespace form; the old code only stripped Win32-form, causing junction idempotency false-positives and install failures.

2. **`tests/fault-network.test.mjs` test 59** — switched remote URL from `git://localhost:9/nonexistent.git` to `file:///nonexistent-relay-test-remote`. The `git://` scheme spawns network helpers on Windows that held a handle to the temp directory, causing `rmSync` to throw `EBUSY`. The `file://` scheme fails immediately with no helpers spawned.

Test totals unchanged: **169 total, CI green on all platforms.**

## Post-ship — E2E fixes + CLI polish (2026-04-24) ✅

**Shipped.** Two e2e test fixes plus CLI quality-of-life improvements.

- **G18 fix**: `spawnStopHooks` gets an `extraEnv` parameter; G18 passes `RELAY_TURNS_THRESHOLD: '100'` so Windows process-startup stagger cannot accumulate to the default threshold of 5 and trigger a distiller reset mid-test.
- **H4 fix**: old hook seed hardcoded the actual `RELAY_ROOT` path, causing the test to always fail on any dev machine other than the original. Replaced with a fictional path.
- **`relay log [--lines N]`**: tail the distiller log from any directory (`default 50 lines`). `-n` shorthand supported.
- **`relay --version` / `-v`**: print `relay <version>` from `package.json`.
- **`relay --help` / `-h`**: print command reference; `relay` with no args also shows help (exit 0). Unknown commands print `relay: unknown command '<X>'` + help to stderr (exit 1).

Test totals: **169 total, e2e 32/32.**

## Post-ship — Parallel code review + integration (2026-04-24) ✅

**Shipped.** Three-agent parallel review pass caught logic, reliability, and quality-of-life issues. 28 additional unit tests added.

Key changes:
- **`sync.mjs` `push()`**: stages paths separately so absence of `.relay/broadcast/` dir no longer aborts the `memory.md` push. `_rebase()` also checks out `.relay/broadcast` from `FETCH_HEAD`.
- **`stop.mjs`**: skips setting `distiller_running` / resetting `turns_since_distill` if spawn produces no PID. Prevents stuck-forever state on failed spawn.
- **`lib/filter.mjs`**: NaN guard on `RELAY_TIER0_THRESHOLD` parse (falls back to default `3`).
- **`distiller.mjs`**: lock error handling consolidated — any failure skips push and exits conservatively.
- **`relay status`**: shows human-readable progress (`N/5 turns until next distill`); lock line hidden when not held; init hint updated to `git add .relay/`.
- **`tests/transcript.test.mjs`**: new file — 17 tests covering `lib/transcript.mjs` (previously zero coverage).
- 11 additional tests across stop, filter, session-start, and fault-corruption test files.

Test totals: **165 unit (164 pass, 1 skip POSIX-only) + 32 e2e = 197 total.**

## Post-ship — Install file cleanup (2026-05-06) ✅

**Shipped.** Installed clone now contains only runtime files — no internal docs, no installer shims.

- **`cleanInstall()`**: deletes `CLAUDE.md`, `README.md`, `install.sh`, `install.ps1` from clone after every clone or update. These are not needed at runtime; `CLAUDE.md` in particular contains internal project context that should not ship to users.
- **`git update-index --skip-worktree`**: set on every deleted file so `git diff HEAD` stays clean and `relay update` doesn't refuse with "local changes detected."
- **Heal step**: before the dirty check in `cloneOrUpdate`, any `ROOT_FILES_TO_REMOVE` missing from disk have skip-worktree applied — handles upgrades from old installs that deleted files without marking them.
- **`applySparse()`**: runs in both the clone and update paths of `cloneOrUpdate`. Cone mode excludes `tests/`, `docs-site/`, `.github/`. Always called after `git reset --hard` (which clears skip-worktree bits).
- **`installer.mjs` self-contained**: `isMain` inlined, no import from `lib/util.mjs`. Required for bootstrap reliability when only `scripts/` is sparse-materialized.
- **Bootstrap shims**: `install.sh` and `install.ps1` do a plain `git clone --depth=1`. Installer owns the full sparse + cleanup lifecycle via the update path of `cloneOrUpdate`.
