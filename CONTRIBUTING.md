# Contributing to Wyren

## Issues

- **Bugs:** Use the bug report template. Include wyren version (`wyren --version`), OS, Node
  version, and the exact error output.
- **Features:** Use the feature request template. Describe the problem you're solving, not
  the solution you have in mind.

## Development setup

```bash
git clone https://github.com/ssm-08/wyren.git
cd wyren
# No npm install needed — zero runtime deps
```

Run tests:

```bash
npm test                      # 166 unit tests (~15s)
npm run test:e2e              # 32 e2e tests (~25s, no Claude API)
node --test tests/<file>.mjs  # single test file
```

Expected baseline: 164 pass, 1 skip (POSIX symlink test), 1 flaky under concurrent load (passes
in isolation). Run `node --test tests/fault-e2e-livesync.test.mjs` to verify the flaky test
passes on its own.

## Pull requests

- One logical change per PR.
- Tests: add or update tests for any changed behavior.
- Commit style: type-prefixed (`fix:`, `feat:`, `chore:`, `docs:`, `ci:`), imperative subject
  under 70 chars.
- Do not add runtime dependencies. Wyren is zero-dep by design.

## Code conventions

- Node.js ESM `.mjs` files only.
- Atomic writes everywhere: write to `.pid.timestamp.tmp`, then `renameSync` with a 3–5 attempt
  EPERM/EBUSY retry loop (Windows transient file lock).
- Hook files must exit 0 on any error — they must never break a Claude Code session.
- No shell strings in `spawnSync`/`spawn` calls — always pass argv arrays.
