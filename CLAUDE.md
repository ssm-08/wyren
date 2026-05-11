# Wyren — Project Context

Wyren is a Claude Code plugin for shared team memory across sessions. Transcripts are distilled in the background; `memory.md` is synced via git and injected as hidden context at every `SessionStart` and on each user turn (`UserPromptSubmit`).

**Audience:** future Claude Code sessions on this repo. Terse; depth lives in the docs site.

## Canonical references

- **Docs site:** `docs-site/` → `https://ssm-08.github.io/wyren/`
- **GitHub:** `https://github.com/ssm-08/wyren` (branch `master`)

## Current state

**v0.4.5 — code audit + docs consistency pass.** All 6 chunks shipped. Full install/uninstall/doctor CLI. Live sync via UserPromptSubmit. npm package: `@ssm-08/wyren` (scoped — unscoped `wyren` blocked by npm similarity check). Install flow: `npm install -g @ssm-08/wyren && wyren install`. Rename pass (2026-05-07): all source files, binary (`bin/wyren.mjs`), state dir (`.wyren/`), slash command (`wyren-handoff`), env vars (`WYREN_*`), function names updated. Prior `@ssm-08/relay` unpublished. Distiller fix (2026-05-08): removed `--bare` (stripped OAuth/keychain → "Not logged in") and `--tools ''` (flag removed from CC CLI). Sync integrity (2026-05-09): `wyren status` shows `Peer pushed: <timestamp> (author, N min ago)` from remote git log of `memory.md`. UPS hook runs ancestry check after pull — if remote `memory.md` was force-pushed (non-linear history), injects a ⚠️ warning into context. Audit pass (2026-05-09): `hooks.json` SessionStart timeout corrected 2s→4s (matches installer); stale `--bare`/`pull --rebase`/`--theirs` references purged from all docs; review-label comment prefixes removed from `sync.mjs`. Tier 0 rebalance (2026-05-11): `EDIT_WEIGHT` 3→4 (per-edit louder, cap 12→16); structural edit tiers reworked `>=2:+2, >=5:+3, >=10:+3` (was `>=3:+2, >=8:+2`). Edits = ground truth; tools now dominate over hypothetical text signals. Text-pattern weights unchanged. Threshold unchanged (3).

**Tests:** 187 unit (~3min) — 185 pass, 2 skip (POSIX-only), 0 flaky-under-load (concurrency=1). 32 e2e (~25s). See `git log` for full history.

**Known flaky:** `fault-e2e-livesync` (Test 1, Test 5) and `sync.test.mjs` fail under concurrent file load (subprocess + git-op contention); `--test-concurrency=1` serializes file execution and prevents this. CI and `npm test` both use it.

## Repo layout

```
bin/wyren.mjs                # CLI: all subcommands (755)
distiller.mjs                # Haiku 4.5, cmd /c claude on Windows, windowsHide:true, no --bare (OAuth required)
hooks/session-start.mjs      # pull (1.5s/0.5s) + inject memory + broadcast (50KB/file, 200KB total cap)
hooks/stop.mjs               # watermark + PID-tracked detached distiller spawn
hooks/user-prompt-submit.mjs # live sync: pull (1.5s) + diff + inject delta
hooks/run-hook.cmd           # polyglot bash+cmd dispatcher (755)
hooks/hooks.json             # hook manifest (SessionStart 4s, Stop 5s, UPS 3s)
commands/wyren-handoff.toml  # /wyren-handoff slash command
lib/sync.mjs                 # GitSync: pull/push/lock, user-file guard in push()
lib/transcript.mjs           # JSONL parse + slice + render
lib/memory.mjs               # atomic read/write
lib/filter.mjs               # Tier 0 weighted scoring (scoreTier0 + hasTier0Signal, dynamic threshold)
lib/diff-memory.mjs          # parseSections, diffMemory, renderDelta, hashMemory
lib/util.mjs                 # isMain (realpathSync junction-safe), readStdin, atomicRename
prompts/distill.md           # distiller system prompt
scripts/installer.mjs        # install/update/uninstall/doctor, BOM-tolerant, npm link (755)
scripts/test-e2e.mjs         # 32 e2e tests, 8 groups (A–H)
scripts/setup.ps1            # DEPRECATED stub — forwards to install.ps1
install.sh                   # macOS/Linux one-liner shim (755)
install.ps1                  # Windows one-liner shim
tests/                       # 173 unit tests (node:test)
docs-site/                   # Astro Starlight docs site
.github/workflows/           # docs.yml (Pages deploy) + ci.yml (unit + e2e matrix)
```

State files (gitignored): `.wyren/state/watermark.json` (Stop-owned), `.wyren/state/ups-state.json` (UPS-owned), `.wyren/state/.lock`, `.wyren/log`.

## Plugin registration (non-obvious — read before touching hooks)

Junction into `~/.claude/plugins/wyren` is NOT sufficient. Claude Code only fires hooks for plugins listed in `installed_plugins.json`. For local dev, wire hooks directly in `~/.claude/settings.json`.

**CRITICAL: `${CLAUDE_PLUGIN_ROOT}` does NOT expand in `settings.json`.** Only works inside a plugin's `hooks/hooks.json`. The installer writes the absolute path. Example:

```json
"hooks": {
  "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "\"C:\\Users\\you\\.claude\\wyren\\hooks\\run-hook.cmd\" session-start", "timeout": 4, "statusMessage": "Loading wyren memory..."}]}],
  "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "\"C:\\Users\\you\\.claude\\wyren\\hooks\\run-hook.cmd\" stop", "timeout": 5}]}],
  "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "\"C:\\Users\\you\\.claude\\wyren\\hooks\\run-hook.cmd\" user-prompt-submit", "timeout": 3}]}]
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

2. **`writeWatermark` retry loop** (`distiller.mjs`). The local `writeWatermark` in distiller.mjs (intentionally not imported from stop.mjs — distiller runs detached) must use the same 5-attempt EPERM/EBUSY/EACCES retry loop with staggered busy-wait as `writeWatermarkAtomic`. A bare `fs.renameSync` on Windows will EPERM-crash on transient file contention, leaving `distiller_running: true` stuck forever. Do NOT replace with `atomicRename` from lib/util.mjs — self-containment is required.

2a. **UPS write order** (`user-prompt-submit.mjs`). Snapshot (`last-injected-memory.md`) must be written BEFORE `ups-state.json`. If killed between the two writes, upsState-first means `last_injected_mtime` matches on next run → mtime fast-path skips → delta permanently lost. Snapshot-first means next run re-diffs and gets an empty delta — benign.

3. **Broadcast size cap** (`session-start.mjs`). `readBroadcastDir` caps at 50 KB/file and 200 KB total. Large skill files (code templates, PDFs) would otherwise inject megabytes into every session. Don't remove the cap.

4. **`push()` user-file guard** (`sync.mjs`). Before committing, `push()` detects staged files outside `.wyren/` and temporarily unstages them, commits wyren-only changes, then re-stages. Without this, wyren would commit and push user code under a `[wyren] memory update` message. Don't replace this with a bare `git commit`.

5. **Lock steal uses `'wx'` not `'w'`** (`sync.mjs lock()`). When stealing a stale lock (> 60s), the code unlinks first, then opens with `'wx'` (exclusive). Using `'w'` (truncate, non-exclusive) allows two processes to both steal simultaneously — TOCTOU race.

6. **Idle trigger uses `last_turn_at`** (`stop.mjs`). `shouldDistill`'s idle check reads `state.last_turn_at`, NOT `last_distilled_at`. `last_turn_at` is set by every `updateWatermark` call, so idle fires even before the first distillation. `last_distilled_at` is only set after a successful distill.

7. **`WYREN_TIER0_THRESHOLD` is dynamic** (`filter.mjs`). Read via `getThreshold()` at call time, not at module load. Tests can set the env var after importing and get the updated value.

8. **`distiller_pid` must be cleared with `distiller_running`**. Both `writeWatermark(clearRunning:true)` and `resetWatermarkTurns` delete `distiller_pid` alongside `distiller_running`. A stale PID could match a future unrelated process on PID reuse.

## Non-obvious — docs site

1. **Base path is env-driven.** Astro reads `WYREN_BASE` (default `/wyren`). CI sets it from `${{ github.event.repository.name }}`. Rename repo → no code change needed.

2. **Root-relative links omit base prefix.** Link to `/problem/` not `/wyren/problem/`. `rehype-base-href` prepends at build time; `astro-base-href-fixup` fixes Starlight hero-action hrefs post-build.

3. **Mermaid is CDN client-side.** `rehype-mermaid-pre.mjs` → `<pre class="mermaid">`; head script loads `mermaid@11` from jsdelivr on `astro:page-load`.

4. **Workflow `paths:` filter is strict.** Only `docs-site/**` or `.github/workflows/docs.yml` changes trigger Pages deploy. Force redeploy: `workflow_dispatch`.

5. **Node 22 pinned in CI.** Don't drop below 22. Local dev on 20+ works.

6. **`.claude/` is gitignored.** Team memory lives in `.wyren/memory.md`, not `.claude/`.

## Coding conventions

- **Node.js ESM `.mjs`. Zero runtime deps** — stdlib only. `@anthropic-ai/sdk` is fallback-only.
- **Preferred AI call: `claude -p`** — do NOT use `--bare`; it strips OAuth/keychain auth and causes "Not logged in" in detached processes. Use `--no-session-persistence` instead.
- **Tier 0 filter mandatory** before any API call. ~70% of triggers skip the API entirely.
- **Hooks never block.** SessionStart 2s, UPS 3s, Stop spawns detached. On error: log + `process.exit(0)`.
- **Atomic writes everywhere.** Pattern: write to `.pid.timestamp.tmp`, then retry-`renameSync` via `atomicRename()` in `lib/util.mjs` (5× EPERM/EBUSY/EACCES loop with staggered busy-wait). `distiller.mjs` inlines its own copy — intentionally self-contained, no lib imports.
- **`distiller_running` + PID liveness.** `shouldDistill` calls `process.kill(pid, 0)` — clears stale flag on ESRCH.
- **Windows: `cmd /c claude` not `shell:true`.** Avoids DEP0190, keeps no-injection-surface rule.
- **`git()` helper uses `spawnSync(array)`.** Never shell strings.
- **`push()` scopes commits to `.wyren/`.** Unstages non-wyren staged files before committing, re-stages after. Don't bypass.
- **`installer.mjs` self-contained.** `isMain` inlined — no import from `lib/util.mjs`. Required for bootstrap with only `scripts/` sparse-materialized.
- **`WYREN_TURNS_THRESHOLD` / `WYREN_IDLE_MS`** override distill thresholds (defaults: 5 turns, 120s).

## Commit style

- Type-prefixed: `docs:`, `ci(pages):`, `feat(distiller):`, `fix(hooks):`, `chore:`.
- Subject imperative, under 70 chars. Body explains *why*.
- Trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` when pair-producing.

## Local dev flow

Plugin tests:
```bash
npm test                                    # 173 unit tests (~3min); expect 171 pass, 2 skip, 0 flaky
npm run test:e2e                            # 32 e2e tests (~25s, no Claude API)
node scripts/test-e2e.mjs --only stop       # filter to one group
node scripts/test-e2e.mjs --verbose         # dump stdout/stderr on failure
node --test tests/fault-e2e-livesync.test.mjs  # run flaky test in isolation to verify it passes
wyren doctor                                # verify hooks wired correctly
```

Docs site:
```bash
cd docs-site && npm install   # first time
npm run dev                   # http://localhost:4321/wyren/
npm run build                 # static HTML → dist/
```

## Session wrap-up (when user says "ready to clear" / "update context" / "wrap up")

1. **CLAUDE.md** — update "Current state" block (version, test counts, new bugs fixed). Don't add changelog bullets — just update facts.
2. **README.md** — update commands table, known issues, install description if changed.
3. **docs-site pages** — update stale pages: `reference/cli.md`, `reference/hooks.md`, `roadmap/overview.md`, `faq.md`.
4. **`~/.claude/projects/.../memory/wyren_project.md`** — rewrite status, test counts, critical details to reflect current state.
5. **`~/.claude/projects/.../memory/MEMORY.md`** — update index descriptions.
6. **New memory files if needed** — feedback, decisions, references learned this session.
7. **Commit + verify** — `git status` clean, `git log --oneline origin/master..HEAD` shows unpushed. Tell user to push.

Only then confirm "safe to clear."

## What's out of scope (don't build these yet)

Next planned specs: distillation quality, CLAUDE.md compatibility, reliability (`wyren doctor` deep checks), sync robustness, decision traceability.

Don't build: cloud sync backend, dashboard UI, MCP RAG server, permissions/auth, Cursor/Windsurf support, real-time per-turn sync, CRDT merge strategies. All designed-for but out of scope.

## Long-term architectural direction — persistent graph

`memory.md` is currently a culled, fixed-size file. The v2 vision: replace culling with rendering. A persistent knowledge graph stores every entry forever; `memory.md` becomes a viewport — a session-relevant slice rendered on demand. Nothing is discarded. The 60-line cap becomes a rendering limit, not a storage limit.

**What this unlocks:**
- Decisions persist through connections, not manual retention
- Cross-time, cross-domain connectivity: past decisions resurface when relevant, regardless of when or who made them
- Reasoning is queryable — not just what is known, but why, what it impacts, what's been tried

**Mental model:** before = memory is what survived culling. After = memory is everything, selectively rendered by relevance.

`memory.md` stays as the rendered output format (backwards-compatible with v1). The graph is the backing store. Do not build until a storage layer spec exists.
