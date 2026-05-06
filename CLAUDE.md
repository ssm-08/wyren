# Relay — Project Context

Relay is a Claude Code plugin for shared team memory across sessions. Transcripts are distilled in the background; `memory.md` is synced via git and injected as hidden context at every `SessionStart` and on each user turn (`UserPromptSubmit`).

**Audience:** future Claude Code sessions on this repo. Terse; depth lives in the docs site.

## Canonical references

- **Docs site:** `docs-site/` → `https://ssm-08.github.io/relay/`
- **GitHub:** `https://github.com/ssm-08/relay` (branch `master`)

## Current state

**v0.4.0 — feature-complete.** All 6 chunks shipped (docs site, distiller, plugin skeleton, Stop hook, git sync, broadcast/slash command). Full install/uninstall/doctor CLI. Live sync via UserPromptSubmit. Sparse checkout, npm link, cleanInstall. Code review pass (2026-05-06): 10 bugs fixed (trigger lock ordering, distiller writeWatermark retry, lock TOCTOU, broadcast size cap, push user-file guard, idle trigger field, stale PID cleanup, dynamic filter threshold, markInjection path, resetWatermarkTurns logging). Simplify pass (2026-05-06): 4 quality fixes (filter threshold double-read, stringly-typed sentinel in resetWatermarkTurns, markInjection log prefix, merged duplicate git diff calls in push).

**Tests:** 166 unit (~15s) — 164 pass, 1 skip (POSIX-only), 1 flaky-under-load. 32 e2e (~25s). See `git log` for full history.

**Known flaky:** `fault-e2e-livesync` (Test 1, Test 5) and `sync.test.mjs` fail under concurrent file load (subprocess + git-op contention); `--test-concurrency=1` serializes file execution and prevents this. CI and `npm test` both use it.

## Repo layout

```
bin/relay.mjs                # CLI: all subcommands (755)
distiller.mjs                # Haiku 4.5, cmd /c claude on Windows, windowsHide:true
hooks/session-start.mjs      # pull (1.5s/0.5s) + inject memory + broadcast (50KB/file, 200KB total cap)
hooks/stop.mjs               # watermark + PID-tracked detached distiller spawn
hooks/user-prompt-submit.mjs # live sync: pull (1.5s) + diff + inject delta
hooks/run-hook.cmd           # polyglot bash+cmd dispatcher (755)
hooks/hooks.json             # hook manifest (SessionStart 2s, Stop 5s, UPS 3s)
commands/relay-handoff.toml  # /relay-handoff slash command
lib/sync.mjs                 # GitSync: pull/push/lock, user-file guard in push()
lib/transcript.mjs           # JSONL parse + slice + render
lib/memory.mjs               # atomic read/write
lib/filter.mjs               # Tier 0 weighted scoring (scoreTier0 + hasTier0Signal, dynamic threshold)
lib/diff-memory.mjs          # parseSections, diffMemory, renderDelta, hashMemory
lib/util.mjs                 # isMain (realpathSync junction-safe), readStdin
prompts/distill.md           # distiller system prompt
scripts/installer.mjs        # install/update/uninstall/doctor, BOM-tolerant, npm link (755)
scripts/test-e2e.mjs         # 32 e2e tests, 8 groups (A–H)
scripts/setup.ps1            # DEPRECATED stub — forwards to install.ps1
install.sh                   # macOS/Linux one-liner shim (755)
install.ps1                  # Windows one-liner shim
tests/                       # 166 unit tests (node:test)
docs-site/                   # Astro Starlight docs site
.github/workflows/           # docs.yml (Pages deploy) + ci.yml (unit + e2e matrix)
```

State files (gitignored): `.relay/state/watermark.json` (Stop-owned), `.relay/state/ups-state.json` (UPS-owned), `.relay/state/.lock`, `.relay/log`.

## Plugin registration (non-obvious — read before touching hooks)

Junction into `~/.claude/plugins/relay` is NOT sufficient. Claude Code only fires hooks for plugins listed in `installed_plugins.json`. For local dev, wire hooks directly in `~/.claude/settings.json`.

**CRITICAL: `${CLAUDE_PLUGIN_ROOT}` does NOT expand in `settings.json`.** Only works inside a plugin's `hooks/hooks.json`. The installer writes the absolute path. Example:

```json
"hooks": {
  "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "\"C:\\Users\\you\\.claude\\relay\\hooks\\run-hook.cmd\" session-start", "timeout": 2, "statusMessage": "Loading relay memory..."}]}],
  "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "\"C:\\Users\\you\\.claude\\relay\\hooks\\run-hook.cmd\" stop", "timeout": 5}]}],
  "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "\"C:\\Users\\you\\.claude\\relay\\hooks\\run-hook.cmd\" user-prompt-submit", "timeout": 3}]}]
}
```

Dev install (no touching real `~/.claude/`):
```bash
node scripts/installer.mjs install --from-local . --home /tmp/fake-home
node scripts/installer.mjs doctor --home /tmp/fake-home
node scripts/installer.mjs uninstall --home /tmp/fake-home
```

`run-hook.cmd` is a polyglot bash+cmd file — same file works on both OSes.

## Non-obvious — hooks / plugin

1. **Trigger lock release order** (`stop.mjs`). `distill-trigger.lock` must be unlinked AFTER `distiller_running` is written to `watermark.json`. Unlinking before the write opens a window where a concurrent Stop hook passes the lock and spawns a second distiller. Current code does this correctly — don't move the `unlinkSync` earlier.

2. **`writeWatermark` retry loop** (`distiller.mjs`). The local `writeWatermark` in distiller.mjs (intentionally not imported from stop.mjs — distiller runs detached) must use the same 3-attempt EPERM/EBUSY retry loop as `writeWatermarkAtomic`. A bare `fs.renameSync` on Windows will EPERM-crash on transient file contention, leaving `distiller_running: true` stuck forever.

3. **Broadcast size cap** (`session-start.mjs`). `readBroadcastDir` caps at 50 KB/file and 200 KB total. Large skill files (code templates, PDFs) would otherwise inject megabytes into every session. Don't remove the cap.

4. **`push()` user-file guard** (`sync.mjs`). Before committing, `push()` detects staged files outside `.relay/` and temporarily unstages them, commits relay-only changes, then re-stages. Without this, relay would commit and push user code under a `[relay] memory update` message. Don't replace this with a bare `git commit`.

5. **Lock steal uses `'wx'` not `'w'`** (`sync.mjs lock()`). When stealing a stale lock (> 60s), the code unlinks first, then opens with `'wx'` (exclusive). Using `'w'` (truncate, non-exclusive) allows two processes to both steal simultaneously — TOCTOU race.

6. **Idle trigger uses `last_turn_at`** (`stop.mjs`). `shouldDistill`'s idle check reads `state.last_turn_at`, NOT `last_distilled_at`. `last_turn_at` is set by every `updateWatermark` call, so idle fires even before the first distillation. `last_distilled_at` is only set after a successful distill.

7. **`RELAY_TIER0_THRESHOLD` is dynamic** (`filter.mjs`). Read via `getThreshold()` at call time, not at module load. Tests can set the env var after importing and get the updated value.

8. **`distiller_pid` must be cleared with `distiller_running`**. Both `writeWatermark(clearRunning:true)` and `resetWatermarkTurns` delete `distiller_pid` alongside `distiller_running`. A stale PID could match a future unrelated process on PID reuse.

## Non-obvious — docs site

1. **Base path is env-driven.** Astro reads `RELAY_BASE` (default `/relay`). CI sets it from `${{ github.event.repository.name }}`. Rename repo → no code change needed.

2. **Root-relative links omit base prefix.** Link to `/problem/` not `/relay/problem/`. `rehype-base-href` prepends at build time; `astro-base-href-fixup` fixes Starlight hero-action hrefs post-build.

3. **Mermaid is CDN client-side.** `rehype-mermaid-pre.mjs` → `<pre class="mermaid">`; head script loads `mermaid@11` from jsdelivr on `astro:page-load`.

4. **Workflow `paths:` filter is strict.** Only `docs-site/**` or `.github/workflows/docs.yml` changes trigger Pages deploy. Force redeploy: `workflow_dispatch`.

5. **Node 22 pinned in CI.** Don't drop below 22. Local dev on 20+ works.

6. **`.claude/` is gitignored.** Team memory lives in `.relay/memory.md`, not `.claude/`.

## Coding conventions

- **Node.js ESM `.mjs`. Zero runtime deps** — stdlib only. `@anthropic-ai/sdk` is fallback-only.
- **Preferred AI call: `claude -p --bare`** — `--bare` strips global plugins/hooks from subprocess.
- **Tier 0 filter mandatory** before any API call. ~70% of triggers skip the API entirely.
- **Hooks never block.** SessionStart 2s, UPS 3s, Stop spawns detached. On error: log + `process.exit(0)`.
- **Atomic writes everywhere.** Pattern: write to `.pid.timestamp.tmp`, then retry-`renameSync` (3× EPERM/EBUSY loop).
- **`distiller_running` + PID liveness.** `shouldDistill` calls `process.kill(pid, 0)` — clears stale flag on ESRCH.
- **Windows: `cmd /c claude` not `shell:true`.** Avoids DEP0190, keeps no-injection-surface rule.
- **`git()` helper uses `spawnSync(array)`.** Never shell strings.
- **`push()` scopes commits to `.relay/`.** Unstages non-relay staged files before committing, re-stages after. Don't bypass.
- **`installer.mjs` self-contained.** `isMain` inlined — no import from `lib/util.mjs`. Required for bootstrap with only `scripts/` sparse-materialized.
- **`RELAY_TURNS_THRESHOLD` / `RELAY_IDLE_MS`** override distill thresholds (defaults: 5 turns, 120s).

## Commit style

- Type-prefixed: `docs:`, `ci(pages):`, `feat(distiller):`, `fix(hooks):`, `chore:`.
- Subject imperative, under 70 chars. Body explains *why*.
- Trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` when pair-producing.

## Local dev flow

Plugin tests:
```bash
npm test                                    # 166 unit tests (~15s); expect 164 pass, 1 skip, 1 flaky
npm run test:e2e                            # 32 e2e tests (~25s, no Claude API)
node scripts/test-e2e.mjs --only stop       # filter to one group
node scripts/test-e2e.mjs --verbose         # dump stdout/stderr on failure
node --test tests/fault-e2e-livesync.test.mjs  # run flaky test in isolation to verify it passes
relay doctor                                # verify hooks wired correctly
```

Docs site:
```bash
cd docs-site && npm install   # first time
npm run dev                   # http://localhost:4321/relay/
npm run build                 # static HTML → dist/
```

## Session wrap-up (when user says "ready to clear" / "update context" / "wrap up")

1. **CLAUDE.md** — update "Current state" block (version, test counts, new bugs fixed). Don't add changelog bullets — just update facts.
2. **README.md** — update commands table, known issues, install description if changed.
3. **docs-site pages** — update stale pages: `reference/cli.md`, `reference/hooks.md`, `roadmap/overview.md`, `faq.md`.
4. **`~/.claude/projects/.../memory/relay_project.md`** — rewrite status, test counts, critical details to reflect current state.
5. **`~/.claude/projects/.../memory/MEMORY.md`** — update index descriptions.
6. **New memory files if needed** — feedback, decisions, references learned this session.
7. **Commit + verify** — `git status` clean, `git log --oneline origin/master..HEAD` shows unpushed. Tell user to push.

Only then confirm "safe to clear."

## What's out of scope (don't build these yet)

Next planned specs: distillation quality, CLAUDE.md compatibility, reliability (`relay doctor` deep checks), sync robustness, decision traceability.

Don't build: cloud sync backend, dashboard UI, MCP RAG server, permissions/auth, Cursor/Windsurf support, real-time per-turn sync, CRDT merge strategies. All designed-for but out of scope.
