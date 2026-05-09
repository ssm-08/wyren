# Integration Review Notes — v0.4.5

## What was fixed

### Code (Agent A)
- `hooks/hooks.json` SessionStart timeout: 2s → 4s (matches installer, fixes tight-timeout kills)
- `lib/sync.mjs`: Removed `I1:`/`I3:`/`I4:` review-label comment prefixes (3 lines)
- `distiller.mjs`: Trimmed 2-line planning note to 1-line comment

### README + CLAUDE.md (Agent B)
- CLAUDE.md: Version bumped v0.4.3→v0.4.4 (by agent), then v0.4.4→v0.4.5 (post-review)
- CLAUDE.md: v0.4.4 + v0.4.5 features added to current state paragraph
- README.md: Limitation #2 rewritten — no more `pull --rebase` reference
- README.md: `wyren status` table entry updated with `Peer pushed:`

### Docs site (Agent C + post-review)
- `cli.md`: `Peer pushed:` in status example; version example 0.4.1→0.4.4; `--force` description updated
- `hooks.md`: SessionStart budget 2s→4s; UPS force-push detection step added
- `roadmap/overview.md`: `--bare`→`--no-session-persistence` in Chunk 1; v0.4.3+v0.4.4+v0.4.5 post-ship entries added
- `faq.md`: `pull --rebase` and `--theirs` replaced with accurate recovery description; "Tier 0 weighted signal filter" throughout
- `how-it-works.md`: "Tier 0 regex filter"→weighted; step 7 push description; "retry-on-rebase"→"safe HEAD recovery"

## Originally-known broken-state items — verified not reverted
- `remote_diverged` recovery message: ✅ still present in bin/wyren.mjs L268–275
- Duplicate `# Wyren Memory` header: ✅ still stripped in session-start.mjs L77
- `--push` in `--help`: ✅ still in HELP_TEXT

## Cross-file consistency check
- `wyren distill --push`: in README commands table ✅, cli.md flag table ✅, CLAUDE.md ✅
- Test counts 185/187 + 32 e2e: CLAUDE.md ✅, roadmap v0.4.3 entry ✅, roadmap v0.4.5 entry ✅
- Hook timeouts 4s/5s/3s: hooks.json ✅, hooks.md ✅, CLAUDE.md ✅, installer.mjs ✅
- `Peer pushed:`: README ✅, cli.md ✅

## Outstanding / skipped
- `roadmap/4-git-sync.md` and `roadmap/5-broadcast.md` still reference old rebase-based pseudocode — left intentionally (historical spec docs, not user-facing guidance)
- `demo.md` "Git rebase + retry" line — minor, in a demo Q&A table; left for now
- No file touched by more than one agent (verified by agent scope constraints)
- npm version bump (`package.json`) — deferred to user
