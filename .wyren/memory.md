## Decisions
- Wyren project: all 6 chunks + installer v1 shipped and live on master [session c02d8414, turn 30]
- 165 tests passing (164 unit, 1 skipped POSIX-only): includes UserPromptSubmit Group I + fault-injection suites (network/git, corruption, concurrency, e2e); all pass, zero failures [session ee77f650, turn 38]
- Two-system end-to-end verified: System A distilled + pushed; System B pulled + injected at SessionStart [session c02d8414, turn 320]
- Installer architecture: Approach A (two shell shims + shared Node helper in scripts/installer.mjs). Shell scripts thin; all logic in Node. macOS/Linux symlink, Windows junction, no admin required. CLI: `npm install -g` registers wyren globally on install; `wyren update` re-registers CLI on update; `npm uninstall -g wyren` (fail-open) removes plugin link, settings.json entries, global CLI registration, and wyren clone directory at `~/.claude/wyren/`. Settings.json hook commands use absolute repoDir paths. [session 12e443d5, turn 193; updated ee77f650, turn 7]
- setup.ps1 is a deprecation stub — real install via install.sh (macOS) or install.ps1 (Windows) [session 12e443d5, turn 265]
- UserPromptSubmit hook: B's session receives A's memory changes on every user turn via pull (1.5s fetch + 500ms checkout, 3s hook timeout, fail-open) + section-aware diffing. Same prompt injection if pull completes; else next UPS retries. Replaces session-boundary-only sync. [session 12e443d5, turn 6; updated ee77f650, turn 2]
- UPS owns `.wyren/state/ups-state.json`, Stop owns `watermark.json` — separate state files eliminate read-modify-write race where concurrent UPS + Stop hooks clobbered watermark keys. [session 12e443d5, turn 36]
- Fault injection testing shipped: 4 new suites (fault-network, fault-corruption, fault-concurrency, fault-e2e-livesync), 53 new tests. Found and fixed 2 bugs: EISDIR crash in buildInjection (corrupted memory path), watermark race condition (UPS + Stop shared state file). [session 12e443d5, turn 36]
- windowsHide:true on all spawnSync calls — prevents random cmd windows on Windows across distiller.mjs, hooks/stop.mjs, and all new hooks. [session 12e443d5, turn 36]
- hooks/stop.mjs: shouldDistill validates distiller_running flag via PID liveness check (process.kill(pid, 0)) to prevent stuck state from OS kill; distiller_pid stored in watermark [session ee77f650, turn 8]
- hooks/stop.mjs: TURNS_THRESHOLD (default 5) and IDLE_MS (default 120s) overridable via WYREN_TURNS_THRESHOLD and WYREN_IDLE_MS env vars — set before IDE launch for faster test cycles [session ee77f650, turn 5]

## Rejected paths
- Approach B (pure bash + pure PowerShell): Already hit PS 5.1 gotchas; bash equivalents (readlink -f diff BSD/GNU, sed-based JSON) compound. Drift between parallel scripts guaranteed. [session 12e443d5, turn 75]
- Approach C (Node-only, thin shell wrappers): `node <(curl)` pattern fragile across proxies, auth, signature verification. Requires pre-verification steps. Approach A keeps platform logic in thin shells where it belongs. [session 12e443d5, turn 75]

## Scope changes
- Deployability v1 shipped 2026-04-23: install.sh, install.ps1, scripts/installer.mjs, wyren install/update/uninstall/doctor CLI subcommands, CI matrix (ubuntu unit tests + macos/windows e2e), 26 new installer unit tests, Group H (6 e2e tests) [session 12e443d5, turn 425]
- Live sync v1 shipped 2026-04-23: UserPromptSubmit hook (hooks/user-prompt-submit.mjs), lib/diff-memory.mjs, Group I (5 new e2e tests), hooks.json wired for UserPromptSubmit, plugin version 0.4.0 [session 12e443d5, turn 209]
- Fault injection testing shipped 2026-04-23: 4 new test suites, 53 tests, 2 bugs found + fixed (EISDIR, watermark race). Test total now 165 (164 unit + 1 skipped POSIX-only). [session ee77f650, turn 38]
- Git sync push() robustness (2026-04-24): stages memory.md and broadcast paths separately; if broadcast dir doesn't exist (first init on new machine), memory.md still commits instead of silently failing [session 6b7ed01f, turn 65]
- Git sync rebase conflict handling (2026-04-24): _rebase() checks out both memory.md and broadcast from FETCH_HEAD after conflict resolution, preventing broadcast state corruption after forced push [session 6b7ed01f, turn 65]
- Test coverage for transcript.mjs (2026-04-24): unit tests added, going from zero coverage to 17 tests covering readTranscriptLines, sliceSinceUuid, lastUuid, renderForDistiller [session 6b7ed01f, turn 65]
- Stop hook distiller state fix (2026-04-24): turns_since_distill reset made conditional on successful spawnDistiller()—if spawn fails (no PID returned), turn counter accumulates toward next trigger instead of resetting [session 6b7ed01f, turn 76]
