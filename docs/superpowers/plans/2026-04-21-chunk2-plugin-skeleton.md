# Chunk 2 — Plugin Skeleton + Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Claude Code plugin installable via `/plugins add` that injects `.relay/memory.md` as hidden system context at every `SessionStart`.

**Architecture:** Plugin manifest in `.claude-plugin/plugin.json` (metadata only). Hook definitions in `hooks/hooks.json`. A polyglot `run-hook.cmd` dispatcher finds `node` on PATH and runs the appropriate `.mjs` hook script. `session-start.mjs` reads `.relay/memory.md` + broadcast files from the target repo and emits them as `additionalContext`. `stop.mjs` is a stub that only updates a watermark counter — distiller wiring comes in Chunk 3.

**Tech Stack:** Node.js 22 ESM (`.mjs`), `node:fs`, `node:path`, `node:os`, `node:test` (built-in), `node:assert`. Zero external dependencies. Reuses existing `lib/memory.mjs`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Create | Module type declaration + bin mapping |
| `.claude-plugin/plugin.json` | Create | Plugin metadata for Claude Code |
| `hooks/hooks.json` | Create | Hook event → command mappings |
| `hooks/run-hook.cmd` | Create | Windows/Unix polyglot: finds node, runs `.mjs` hook |
| `hooks/session-start.mjs` | Create | Reads memory.md + broadcast, emits additionalContext |
| `hooks/stop.mjs` | Create | Stub: increments watermark turn counter |
| `bin/relay.mjs` | Create | CLI: `relay init` creates `.relay/` structure |
| `tests/session-start.test.mjs` | Create | Unit tests for session-start logic |
| `tests/stop.test.mjs` | Create | Unit tests for watermark update |
| `tests/relay-init.test.mjs` | Create | Unit tests for relay init |
| `README.md` | Create | Install + usage instructions |

**Not modified:** `distiller.mjs`, `lib/transcript.mjs`, `lib/memory.mjs`, `prompts/distill.md`, `docs-site/**`

---

## Task 1: Package metadata (package.json + plugin.json)

**Files:**
- Create: `package.json`
- Create: `.claude-plugin/plugin.json`

No tests needed — pure config.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "relay",
  "version": "0.2.0",
  "type": "module",
  "description": "Shared team memory across Claude Code sessions",
  "bin": {
    "relay": "./bin/relay.mjs"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create `.claude-plugin/` directory and `plugin.json`**

```bash
mkdir -p .claude-plugin
```

Content of `.claude-plugin/plugin.json`:
```json
{
  "name": "relay",
  "description": "Shared team memory across Claude Code sessions via git-synced memory.md",
  "version": "0.2.0",
  "author": {
    "name": "ssm-08",
    "url": "https://github.com/ssm-08"
  },
  "homepage": "https://github.com/ssm-08/relay",
  "repository": "https://github.com/ssm-08/relay",
  "license": "MIT"
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json .claude-plugin/plugin.json
git commit -m "feat(chunk2): add package.json and plugin manifest"
```

---

## Task 2: Windows/Unix hook dispatcher (`hooks/run-hook.cmd`)

**Files:**
- Create: `hooks/run-hook.cmd`

This polyglot file is interpreted differently by bash vs cmd.exe:
- **bash**: `: << 'CMDBLOCK'` is a no-op heredoc (reads and discards batch section). Bash code after `CMDBLOCK` executes.
- **cmd.exe**: `:` is a label (line skipped). Batch block runs. `exit /b` prevents cmd from executing the bash section.

- [ ] **Step 1: Create `hooks/` directory**

```bash
mkdir -p hooks
```

- [ ] **Step 2: Create `hooks/run-hook.cmd`**

```
: << 'CMDBLOCK'
@echo off
setlocal
node "%CLAUDE_PLUGIN_ROOT%\hooks\%1.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/$1.mjs"
exit $?
```

- [ ] **Step 3: On Unix, make it executable**

```bash
chmod +x hooks/run-hook.cmd
```

- [ ] **Step 4: Verify on Windows (manual spot-check)**

In PowerShell or cmd, set `CLAUDE_PLUGIN_ROOT` to the repo root and run:
```
set CLAUDE_PLUGIN_ROOT=C:\Users\Shree Sai\Documents\Vibejam
hooks\run-hook.cmd --version
```
Expected: Node version printed (because `node --version.mjs` will fail, but the dispatcher found node). Real verification comes in Task 6 E2E test.

- [ ] **Step 5: Commit**

```bash
git add hooks/run-hook.cmd
git commit -m "feat(chunk2): add Windows/Unix polyglot hook dispatcher"
```

---

## Task 3: Hook definitions (`hooks/hooks.json`)

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
            "timeout": 5,
            "statusMessage": "Loading relay memory..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" stop",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat(chunk2): add hook definitions for SessionStart and Stop"
```

---

## Task 4: `hooks/session-start.mjs` (TDD)

**Files:**
- Create: `tests/session-start.test.mjs`
- Create: `hooks/session-start.mjs`

### 4a — Write the failing tests

- [ ] **Step 1: Create `tests/session-start.test.mjs`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Will fail until hooks/session-start.mjs exists
import { buildContext, readBroadcastDir } from '../hooks/session-start.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
}

test('buildContext returns empty string when .relay dir is missing', () => {
  const dir = makeTmpDir();
  try {
    const result = buildContext(dir);
    assert.equal(result, '');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext returns memory content when memory.md exists', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.relay', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    const result = buildContext(dir);
    assert.ok(result.includes('Use SQLite'), `Expected memory content, got: ${result}`);
    assert.ok(result.includes('Relay Memory'), `Expected "Relay Memory" header, got: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext returns empty string when memory.md is blank', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.relay', 'memory.md'), '   \n', 'utf8');
    const result = buildContext(dir);
    assert.equal(result, '');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readBroadcastDir returns empty string when dir missing', () => {
  const result = readBroadcastDir('/nonexistent/relay-test-broadcast-dir');
  assert.equal(result, '');
});

test('readBroadcastDir includes file contents with broadcast header', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'style.md'), '# Style guide\nUse 2-space indent.\n', 'utf8');
    const result = readBroadcastDir(dir);
    assert.ok(result.includes('broadcast: style.md'), `Expected broadcast header, got: ${result}`);
    assert.ok(result.includes('Style guide'), `Expected file content, got: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext includes both memory and broadcast when both exist', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay', 'broadcast'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.relay', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    fs.writeFileSync(path.join(dir, '.relay', 'broadcast', 'team.md'), '# Team notes\nStandup at 9am.\n', 'utf8');
    const result = buildContext(dir);
    assert.ok(result.includes('Relay Memory'), `Missing memory header in: ${result}`);
    assert.ok(result.includes('Relay Broadcast'), `Missing broadcast header in: ${result}`);
    assert.ok(result.includes('Use SQLite'), `Missing memory content in: ${result}`);
    assert.ok(result.includes('Team notes'), `Missing broadcast content in: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext omits broadcast section when broadcast dir is empty', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay', 'broadcast'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.relay', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    // broadcast dir exists but is empty
    const result = buildContext(dir);
    assert.ok(!result.includes('Relay Broadcast'), `Should not include broadcast section, got: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
node --test tests/session-start.test.mjs
```

Expected: Error like `Cannot find module '../hooks/session-start.mjs'`

### 4b — Implement `hooks/session-start.mjs`

- [ ] **Step 3: Create `hooks/session-start.mjs`**

```javascript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readMemory } from '../lib/memory.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function readBroadcastDir(broadcastDir) {
  if (!fs.existsSync(broadcastDir)) return '';
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(broadcastDir);
  if (files.length === 0) return '';
  return files
    .map((f) => {
      const name = path.relative(broadcastDir, f).replace(/\\/g, '/');
      const content = fs.readFileSync(f, 'utf8');
      return `## broadcast: ${name}\n\n${content.trim()}`;
    })
    .join('\n\n---\n\n');
}

export function buildContext(cwd) {
  const relayDir = path.join(cwd, '.relay');
  if (!fs.existsSync(relayDir)) return '';

  const memory = readMemory(path.join(relayDir, 'memory.md'));
  const broadcast = readBroadcastDir(path.join(relayDir, 'broadcast'));

  const parts = [];
  if (memory.trim()) parts.push(`# Relay Memory\n\n${memory.trim()}`);
  if (broadcast.trim()) parts.push(`# Relay Broadcast\n\n${broadcast.trim()}`);

  return parts.join('\n\n---\n\n');
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd } = input;
    const context = buildContext(cwd);
    if (!context) process.exit(0);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: context,
        },
      }) + '\n'
    );
  } catch (e) {
    process.stderr.write(`[relay] session-start error: ${e.message}\n`);
    process.exit(0);
  }
}

main();
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
node --test tests/session-start.test.mjs
```

Expected output: all 7 tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start.mjs tests/session-start.test.mjs
git commit -m "feat(chunk2): session-start hook injects memory.md as additionalContext"
```

---

## Task 5: `hooks/stop.mjs` stub (TDD)

**Files:**
- Create: `tests/stop.test.mjs`
- Create: `hooks/stop.mjs`

### 5a — Write the failing tests

- [ ] **Step 1: Create `tests/stop.test.mjs`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { updateWatermark } from '../hooks/stop.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
}

test('updateWatermark creates state dir and watermark.json on first call', () => {
  const dir = makeTmpDir();
  const relayDir = path.join(dir, '.relay');
  fs.mkdirSync(relayDir);
  try {
    updateWatermark(relayDir);
    const watermarkPath = path.join(relayDir, 'state', 'watermark.json');
    assert.ok(fs.existsSync(watermarkPath), 'watermark.json should exist');
    const state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
    assert.equal(state.turns_since_distill, 1, 'First call should set turns=1');
    assert.ok(typeof state.last_turn_at === 'number', 'last_turn_at should be a number');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateWatermark increments turns_since_distill on each call', () => {
  const dir = makeTmpDir();
  const relayDir = path.join(dir, '.relay');
  fs.mkdirSync(relayDir);
  try {
    updateWatermark(relayDir);
    updateWatermark(relayDir);
    const state = updateWatermark(relayDir);
    assert.equal(state.turns_since_distill, 3, 'After 3 calls turns should be 3');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateWatermark returns the updated state object', () => {
  const dir = makeTmpDir();
  const relayDir = path.join(dir, '.relay');
  fs.mkdirSync(relayDir);
  try {
    const state = updateWatermark(relayDir);
    assert.ok(state && typeof state === 'object', 'Should return state object');
    assert.equal(state.turns_since_distill, 1);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateWatermark persists last_uuid from previous state', () => {
  const dir = makeTmpDir();
  const relayDir = path.join(dir, '.relay');
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const existingState = { turns_since_distill: 2, last_uuid: 'abc-123', last_turn_at: 1000 };
  fs.writeFileSync(path.join(stateDir, 'watermark.json'), JSON.stringify(existingState), 'utf8');
  try {
    const state = updateWatermark(relayDir);
    assert.equal(state.last_uuid, 'abc-123', 'Should preserve existing last_uuid');
    assert.equal(state.turns_since_distill, 3, 'Should increment from 2 to 3');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
node --test tests/stop.test.mjs
```

Expected: `Cannot find module '../hooks/stop.mjs'`

### 5b — Implement `hooks/stop.mjs`

- [ ] **Step 3: Create `hooks/stop.mjs`**

```javascript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function updateWatermark(relayDir) {
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  const watermarkPath = path.join(stateDir, 'watermark.json');
  let state = { turns_since_distill: 0 };
  try {
    state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
  } catch {}

  state.turns_since_distill = (state.turns_since_distill ?? 0) + 1;
  state.last_turn_at = Date.now();

  fs.writeFileSync(watermarkPath, JSON.stringify(state, null, 2));
  return state;
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd } = input;
    const relayDir = path.join(cwd, '.relay');
    if (!fs.existsSync(relayDir)) process.exit(0);
    updateWatermark(relayDir);
  } catch (e) {
    process.stderr.write(`[relay] stop error: ${e.message}\n`);
  }
  process.exit(0);
}

main();
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
node --test tests/stop.test.mjs
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add hooks/stop.mjs tests/stop.test.mjs
git commit -m "feat(chunk2): stop hook stub — increments watermark turn counter"
```

---

## Task 6: `bin/relay.mjs` CLI — `relay init` (TDD)

**Files:**
- Create: `tests/relay-init.test.mjs`
- Create: `bin/relay.mjs`

### 6a — Write the failing tests

- [ ] **Step 1: Create `tests/relay-init.test.mjs`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { relayInit } from '../bin/relay.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
}

test('relayInit creates .relay/memory.md', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    const memPath = path.join(dir, '.relay', 'memory.md');
    assert.ok(fs.existsSync(memPath), '.relay/memory.md should exist');
    const content = fs.readFileSync(memPath, 'utf8');
    assert.ok(content.includes('Relay Memory'), 'memory.md should have Relay Memory heading');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit creates .relay/broadcast/ directory', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    assert.ok(fs.existsSync(path.join(dir, '.relay', 'broadcast')), '.relay/broadcast/ should exist');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit appends .relay/state/ and .relay/log to .gitignore', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
    relayInit(dir);
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.relay/state/'), '.gitignore should include .relay/state/');
    assert.ok(gitignore.includes('.relay/log'), '.gitignore should include .relay/log');
    assert.ok(gitignore.includes('node_modules/'), 'Original .gitignore content preserved');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit creates .gitignore if it does not exist', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    const gitignorePath = path.join(dir, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore should be created');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.relay/state/'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit returns false and is a no-op when already initialized', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    const result = relayInit(dir);
    assert.equal(result, false, 'Second call should return false');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit does not duplicate .gitignore entries on repeated calls', () => {
  const dir = makeTmpDir();
  try {
    // Run init, then manually remove .relay/ so init can run again
    fs.writeFileSync(path.join(dir, '.gitignore'), '.relay/state/\n.relay/log\n', 'utf8');
    fs.mkdirSync(path.join(dir, '.relay'));
    relayInit(dir);  // will return false (already initialized), .gitignore untouched
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const stateCount = (gitignore.match(/\.relay\/state\//g) || []).length;
    assert.equal(stateCount, 1, '.relay/state/ should appear exactly once');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Create `bin/` directory**

```bash
mkdir -p bin
```

- [ ] **Step 3: Run tests — verify they FAIL**

```bash
node --test tests/relay-init.test.mjs
```

Expected: `Cannot find module '../bin/relay.mjs'`

### 6b — Implement `bin/relay.mjs`

- [ ] **Step 4: Create `bin/relay.mjs`**

```javascript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function relayInit(targetDir) {
  const relayDir = path.join(targetDir, '.relay');

  if (fs.existsSync(relayDir)) {
    console.log('Relay already initialized.');
    return false;
  }

  // Create .relay/memory.md
  fs.mkdirSync(relayDir, { recursive: true });
  fs.writeFileSync(
    path.join(relayDir, 'memory.md'),
    '# Relay Memory\n<!-- Populated by distiller. Edit manually to seed context. -->\n',
    'utf8'
  );

  // Create .relay/broadcast/
  fs.mkdirSync(path.join(relayDir, 'broadcast'), { recursive: true });

  // Update .gitignore — idempotent
  const gitignorePath = path.join(targetDir, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch {}

  const toAdd = [];
  if (!existing.includes('.relay/state/')) toAdd.push('.relay/state/');
  if (!existing.includes('.relay/log')) toAdd.push('.relay/log');

  if (toAdd.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gitignorePath, prefix + toAdd.join('\n') + '\n', 'utf8');
  }

  console.log('Relay initialized. Run: git add .relay/memory.md && git commit');
  return true;
}

// CLI entry point — only runs when invoked directly
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const [, , command] = process.argv;
  if (command === 'init') {
    relayInit(process.cwd());
  } else {
    console.error(
      `Usage: relay <command>\n\nCommands:\n  init    Initialize relay in current repository`
    );
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run tests — verify they PASS**

```bash
node --test tests/relay-init.test.mjs
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add bin/relay.mjs tests/relay-init.test.mjs
git commit -m "feat(chunk2): relay init CLI — creates .relay/ structure"
```

---

## Task 7: Run all tests together

- [ ] **Step 1: Run the full test suite**

```bash
node --test tests/*.test.mjs
```

Expected: 17 tests pass (7 session-start + 4 stop + 6 relay-init), 0 failures.

If any fail, fix before continuing.

- [ ] **Step 2: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(chunk2): address test failures"
```

---

## Task 8: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Relay

Shared team memory across Claude Code sessions. Every session starts warm with your team's decisions, rejected paths, and live workarounds.

## Install

```bash
/plugins add ssm-08/relay
```

## Init (per repo)

```bash
cd your-project
node ~/.claude/plugins/relay/bin/relay.mjs init
git add .relay/memory.md
git commit -m "chore: init relay"
git push
```

## How it works

- On `SessionStart`: Relay reads `.relay/memory.md` and injects it as hidden context.
- On each turn: Relay increments a watermark counter (Chunk 3 will wire up the distiller).
- Teammates run `relay init` once per repo. Each new session starts with the latest memory.

## Dev install (local iteration)

```bash
# Windows (run as admin)
mklink /J "C:\Users\<you>\.claude\plugins\relay" "C:\path\to\Vibejam"

# Unix
ln -s ~/path/to/Vibejam ~/.claude/plugins/relay
```

Then restart Claude Code.

## Manual memory seeding

Until the distiller is wired (Chunk 3), edit `.relay/memory.md` directly:

```markdown
# Relay Memory

## Decisions
- Using SQLite (rejected Postgres — too heavy for this project)

## Live workarounds
- user_id hardcoded to 1 in /dashboard — remove before demo [session abc1, turn 3]
```

Every teammate's next session will start with this context.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and usage instructions"
```

---

## Task 9: End-to-end verification

Manual steps — no new code.

- [ ] **Step 1: Install plugin via symlink**

```
# Windows PowerShell (run as admin):
cmd /c mklink /J "C:\Users\Shree Sai\.claude\plugins\relay" "C:\Users\Shree Sai\Documents\Vibejam"
```

- [ ] **Step 2: Verify plugin appears in Claude Code**

Open Claude Code. Run `/plugins list`. Confirm `relay` appears.

- [ ] **Step 3: Init relay in a test repo**

```bash
# Use a separate test repo (or a subfolder — NOT Vibejam itself)
mkdir -p /tmp/relay-e2e-test && cd /tmp/relay-e2e-test
git init
node "C:/Users/Shree Sai/Documents/Vibejam/bin/relay.mjs" init
```

Expected output: `Relay initialized. Run: git add .relay/memory.md && git commit`

Expected files created:
- `/tmp/relay-e2e-test/.relay/memory.md`
- `/tmp/relay-e2e-test/.relay/broadcast/`
- `.relay/state/` and `.relay/log` in `.gitignore`

- [ ] **Step 4: Seed test memory**

```bash
cat > /tmp/relay-e2e-test/.relay/memory.md << 'EOF'
# Relay Memory

## Decisions
- Stack: SQLite (rejected Postgres — too heavy for MVP)
- Auth: JWT tokens stored in httpOnly cookies

## Live workarounds
- user_id hardcoded to 1 in /dashboard — remove before demo [session test, turn 1]
EOF
```

- [ ] **Step 5: Open Claude Code in the test repo**

```bash
# Open Claude Code pointed at the test repo:
claude /tmp/relay-e2e-test
```

(Or use the Claude Code desktop app and open `/tmp/relay-e2e-test` as the working directory.)

- [ ] **Step 6: Verify injection**

Ask Claude: `"What do you know about this project?"`

Expected: Claude mentions SQLite decision, JWT auth, and the user_id=1 workaround — sourced from `memory.md` without being told about it.

- [ ] **Step 7: Verify SessionStart timing**

The status bar should briefly show "Loading relay memory..." during startup. Session should open in under 1 second (file reads are fast).

- [ ] **Step 8: Commit final E2E notes (no code changes needed)**

```bash
cd "C:/Users/Shree Sai/Documents/Vibejam"
git commit --allow-empty -m "chore(chunk2): E2E verification passed — injection working"
```

---

## Task 10: Final `/plugins add` validation

- [ ] **Step 1: Push current branch to GitHub**

```bash
git push origin master
```

- [ ] **Step 2: Test real plugin install**

In a fresh Claude Code session:
```
/plugins add ssm-08/relay
```

Expected: plugin installs, `/plugins list` shows `relay`.

- [ ] **Step 3: Remove symlink if install succeeded**

The real install puts the plugin at `~/.claude/plugins/cache/ssm-08/relay/<sha>/`. Remove the dev symlink to avoid conflicts:
```
# Windows PowerShell:
cmd /c rmdir "C:\Users\Shree Sai\.claude\plugins\relay"
```

Restart Claude Code. Re-run E2E verification from Task 9 Step 5 onward to confirm real-install path works identically.

---

## Exit criteria checklist

- [ ] `node --test tests/*.test.mjs` → 17 tests pass
- [ ] `relay init` creates `.relay/` structure and updates `.gitignore`
- [ ] Manually edited `memory.md` appears in Claude's context at next session open
- [ ] SessionStart completes in < 500ms
- [ ] Plugin installs via `/plugins add ssm-08/relay` without errors
- [ ] `memory.md` changes reflected in NEXT session (not current — mid-session injection is out of scope)
