## Decisions
- Relay project: all 6 chunks + installer v1 shipped and live on master [session c02d8414, turn 30]
- 127 tests passing (95 unit + 32 e2e): full pipeline including live-sync UserPromptSubmit Group I (5 new e2e tests) [session 12e443d5, turn 209]
- Two-system end-to-end verified: System A distilled + pushed; System B pulled + injected at SessionStart [session c02d8414, turn 320]
- Installer architecture: Approach A (two shell shims + shared Node helper in scripts/installer.mjs). Shell scripts thin; all logic in Node. macOS/Linux symlink, Windows junction, no admin required. `${CLAUDE_PLUGIN_ROOT}` form for hook command; auto-migrates old absolute-path entries [session 12e443d5, turn 193]
- setup.ps1 is a deprecation stub — real install via install.sh (macOS) or install.ps1 (Windows) [session 12e443d5, turn 265]
- UserPromptSubmit hook: B's session receives A's memory changes on every user turn via tight-cap pull (1.5s: 1s fetch + 500ms checkout, fail-open) + section-aware diffing. Same prompt injection if pull completes; else next UPS retries. Replaces session-boundary-only sync. [session 12e443d5, turn 6]

## Rejected paths
- Approach B (pure bash + pure PowerShell): Already hit PS 5.1 gotchas; bash equivalents (readlink -f diff BSD/GNU, sed-based JSON) compound. Drift between parallel scripts guaranteed. [session 12e443d5, turn 75]
- Approach C (Node-only, thin shell wrappers): `node <(curl)` pattern fragile across proxies, auth, signature verification. Requires pre-verification steps. Approach A keeps platform logic in thin shells where it belongs. [session 12e443d5, turn 75]

## Scope changes
- Deployability v1 shipped 2026-04-23: install.sh, install.ps1, scripts/installer.mjs, relay install/update/uninstall/doctor CLI subcommands, CI matrix (ubuntu unit tests + macos/windows e2e), 26 new installer unit tests, Group H (6 e2e tests) [session 12e443d5, turn 425]
- Live sync v1 shipped 2026-04-23: UserPromptSubmit hook, lib/diff-memory.mjs, Group I (5 new e2e tests), hooks.json wired for UserPromptSubmit, plugin version 0.4.0 [session 12e443d5, turn 209]
- Old plan docs (docs/superpowers/plans/*.md + specs/*.md for chunks 2,4,5) deleted — shipped, no longer load-bearing [session 12e443d5, turn 475]
