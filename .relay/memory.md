# Relay Memory
<!-- Populated by distiller. Edit manually to seed context. -->

## Decisions
- Relay project: all 6 chunks + installer v1 shipped and live on master [session c02d8414, turn 30]
- 106 tests passing (79 unit + 27 e2e): full pipeline tested including installer install/update/uninstall/doctor [session current]
- Two-system end-to-end verified: System A distilled + pushed; System B pulled + injected at SessionStart [session c02d8414, turn 320]
- Installer uses `fs.symlinkSync('junction')` on Windows — no admin required; all logic in scripts/installer.mjs, shell scripts are thin shims [session current]
- Hook command uses `${CLAUDE_PLUGIN_ROOT}` form (not absolute path); old setup.ps1 absolute entries auto-migrated on re-install [session current]
- setup.ps1 is a deprecation stub — real install via install.sh (macOS) or install.ps1 (Windows) [session current]

## Scope changes
- Deployability v1 shipped 2026-04-23: install.sh, install.ps1, scripts/installer.mjs, relay install/update/uninstall/doctor CLI subcommands, CI matrix (ubuntu+macos+windows) [session current]
- Old plan docs (docs/superpowers/plans/ + specs/) deleted — shipped, no longer load-bearing [session current]
