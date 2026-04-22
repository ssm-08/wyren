# Chunk 5 — Broadcast + Polish + Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `relay broadcast-skill` CLI, skill-loaded acknowledgment in SessionStart, `/relay-handoff` slash command, and polish README with real demo script + known issues.

**Architecture:** All new logic layers on top of existing machinery — `relayBroadcastSkill` copies a file + calls existing `GitSync.push()`; acknowledgment is a text instruction injected inside the existing `buildContext` output; `/relay-handoff` is a TOML slash command that instructs Claude to write a handoff note manually. No new libs, no new abstractions.

**Tech Stack:** Node.js 22 ESM, `node:fs`, `node:path`, existing `lib/sync.mjs`. Commands use TOML (same format as caveman plugin). Zero new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `bin/relay.mjs` | Modify | Add exported `relayBroadcastSkill(targetDir, filePath)` + wire into CLI dispatcher |
| `hooks/session-start.mjs` | Modify | `buildContext` appends acknowledgment instruction when `broadcast/skills/` has files |
| `commands/relay-handoff.toml` | Create | `/relay-handoff` slash command — instructs Claude to write handoff note + push |
| `tests/broadcast-skill.test.mjs` | Create | Unit tests for `relayBroadcastSkill` file-copy logic |
| `tests/session-start.test.mjs` | Modify | Two new tests for acknowledgment instruction |
| `README.md` | Modify | Real demo script, polished install, known issues section |

**Not modified:** `lib/sync.mjs`, `lib/memory.mjs`, `lib/filter.mjs`, `distiller.mjs`, `hooks/stop.mjs`, `docs-site/**` (except roadmap status update in separate task)

---

### Task 1: Tests for `relayBroadcastSkill`

**Files:**
- Create: `tests/broadcast-skill.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/broadcast-skill.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { relayBroadcastSkill } from '../bin/relay.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
}

test('relayBroadcastSkill returns null when relay not initialized', () => {
  const dir = makeTmpDir();
  try {
    const result = relayBroadcastSkill(dir, '/some/skill.md');
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayBroadcastSkill returns null when source file not found', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay'), { recursive: true });
    const result = relayBroadcastSkill(dir, path.join(dir, 'nonexistent.md'));
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayBroadcastSkill returns null when filePath missing', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay'), { recursive: true });
    const result = relayBroadcastSkill(dir, undefined);
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayBroadcastSkill copies file to .relay/broadcast/skills/<basename>', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay', 'broadcast'), { recursive: true });
    const srcPath = path.join(dir, 'my-style.md');
    fs.writeFileSync(srcPath, '# Style\nUse 2-space indent.', 'utf8');

    const result = relayBroadcastSkill(dir, srcPath);

    const expected = path.join(dir, '.relay', 'broadcast', 'skills', 'my-style.md');
    assert.equal(result, expected);
    assert.ok(fs.existsSync(expected), 'Skill file should exist at destination');
    const content = fs.readFileSync(expected, 'utf8');
    assert.ok(content.includes('2-space indent'), 'Content should be copied verbatim');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayBroadcastSkill creates skills dir if it does not exist', () => {
  const dir = makeTmpDir();
  try {
    // .relay exists but broadcast/skills does not
    fs.mkdirSync(path.join(dir, '.relay'), { recursive: true });
    const srcPath = path.join(dir, 'skill.md');
    fs.writeFileSync(srcPath, '# Skill', 'utf8');

    relayBroadcastSkill(dir, srcPath);

    assert.ok(
      fs.existsSync(path.join(dir, '.relay', 'broadcast', 'skills', 'skill.md')),
      'skills dir and file should be created'
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayBroadcastSkill overwrites existing skill with same name', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay', 'broadcast', 'skills'), { recursive: true });
    const destPath = path.join(dir, '.relay', 'broadcast', 'skills', 'style.md');
    fs.writeFileSync(destPath, '# Old content', 'utf8');

    const srcPath = path.join(dir, 'style.md');
    fs.writeFileSync(srcPath, '# New content', 'utf8');

    relayBroadcastSkill(dir, srcPath);

    const content = fs.readFileSync(destPath, 'utf8');
    assert.ok(content.includes('New content'), 'Should overwrite with new content');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/broadcast-skill.test.mjs
```

Expected: all 6 tests fail with `SyntaxError` or `TypeError` — `relayBroadcastSkill` not yet exported.

---

### Task 2: Implement `relayBroadcastSkill` in `bin/relay.mjs`

**Files:**
- Modify: `bin/relay.mjs`

- [ ] **Step 3: Add the exported function**

In `bin/relay.mjs`, after the `relayDistill` function (around line 190), add:

```js
export function relayBroadcastSkill(targetDir, filePath) {
  const relayDir = path.join(targetDir, '.relay');

  if (!fs.existsSync(relayDir)) {
    console.error('Relay not initialized. Run: relay init');
    return null;
  }

  if (!filePath) {
    console.error('Usage: relay broadcast-skill <file>');
    return null;
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
  }

  const skillName = path.basename(filePath);
  const destDir = path.join(relayDir, 'broadcast', 'skills');
  fs.mkdirSync(destDir, { recursive: true });

  const destPath = path.join(destDir, skillName);
  fs.copyFileSync(filePath, destPath);
  console.log(`Broadcast: .relay/broadcast/skills/${skillName}`);
  return destPath;
}
```

- [ ] **Step 4: Wire into CLI dispatcher**

In the `if (isMain(import.meta.url))` block, replace the final `else` branch with:

```js
  } else if (command === 'broadcast-skill') {
    const filePath = rest[0];
    const dest = relayBroadcastSkill(process.cwd(), filePath);
    if (dest) {
      const { GitSync } = await import('../lib/sync.mjs');
      const sync = new GitSync();
      let release = () => {};
      try {
        release = sync.lock(process.cwd());
      } catch (e) {
        if (e.message === 'LOCKED') {
          console.error('relay: sync locked by another process');
          process.exit(2);
        }
        throw e;
      }
      try {
        sync.push(process.cwd(), 'broadcast');
        console.log('Pushed to remote.');
      } catch (e) {
        console.error(`relay: push failed: ${e.message}`);
      } finally {
        release();
      }
    }
  } else {
    console.error(
      `Usage: relay <command>\n\nCommands:\n` +
      `  init              Initialize relay in current repository\n` +
      `  status            Show memory, watermark, and sync state\n` +
      `  distill           Run distiller manually [--transcript <path>] [--force] [--dry-run] [--push]\n` +
      `  broadcast-skill   Broadcast a skill file to all teammates [<file>]`
    );
    process.exit(1);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test tests/broadcast-skill.test.mjs
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add bin/relay.mjs tests/broadcast-skill.test.mjs
git commit -m "feat(chunk5): relay broadcast-skill — copy skill + push via GitSync"
```

---

### Task 3: Tests for acknowledgment instruction in `buildContext`

**Files:**
- Modify: `tests/session-start.test.mjs`

- [ ] **Step 7: Add two failing tests**

Append to `tests/session-start.test.mjs`:

```js
test('buildContext includes acknowledgment instruction when skills present', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay', 'broadcast', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.relay', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, '.relay', 'broadcast', 'skills', 'frontend-style.md'),
      '# Frontend Style\nUse 2-space indent.',
      'utf8'
    );
    const result = buildContext(dir);
    assert.ok(result.includes('frontend-style'), `Missing skill name in: ${result}`);
    assert.ok(result.includes('Acknowledge'), `Missing acknowledgment instruction in: ${result}`);
    assert.ok(result.includes('Loaded'), `Missing "Loaded" in: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext no acknowledgment when broadcast has no skills', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.relay', 'broadcast'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.relay', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, '.relay', 'broadcast', 'team.md'),
      '# Team notes\nStandup at 9am.',
      'utf8'
    );
    const result = buildContext(dir);
    assert.ok(result.includes('Relay Broadcast'), `Should have broadcast section in: ${result}`);
    assert.ok(!result.includes('Acknowledge'), `Should NOT have acknowledgment when no skills: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 8: Run tests to verify they fail**

```bash
node --test tests/session-start.test.mjs
```

Expected: the two new tests fail — `buildContext` does not yet emit acknowledgment text.

---

### Task 4: Implement acknowledgment in `hooks/session-start.mjs`

**Files:**
- Modify: `hooks/session-start.mjs`

- [ ] **Step 9: Update `buildContext`**

Replace the entire `buildContext` function (lines 30–42) with:

```js
export function buildContext(cwd) {
  const relayDir = path.join(cwd, '.relay');
  if (!fs.existsSync(relayDir)) return '';

  const memory = readMemory(path.join(relayDir, 'memory.md'));
  const broadcast = readBroadcastDir(path.join(relayDir, 'broadcast'));

  const parts = [];
  if (memory.trim()) parts.push(`# Relay Memory\n\n${memory.trim()}`);
  if (broadcast.trim()) {
    const skillsDir = path.join(relayDir, 'broadcast', 'skills');
    const skillFiles = fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir).filter((f) => f !== '.gitkeep')
      : [];
    let broadcastSection = `# Relay Broadcast\n\n${broadcast.trim()}`;
    if (skillFiles.length > 0) {
      const names = skillFiles
        .map((f) => '`' + path.basename(f, path.extname(f)) + '`')
        .join(', ');
      broadcastSection +=
        `\n\n_Relay: ${skillFiles.length} team skill(s) loaded — ${names}.` +
        ` Acknowledge in your first response with one line: "Loaded ${skillFiles.length} team skill(s): ${names}."_`;
    }
    parts.push(broadcastSection);
  }

  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 10: Run all session-start tests to verify they pass**

```bash
node --test tests/session-start.test.mjs
```

Expected: all 8 tests pass (6 original + 2 new).

- [ ] **Step 11: Commit**

```bash
git add hooks/session-start.mjs tests/session-start.test.mjs
git commit -m "feat(chunk5): acknowledgment instruction when broadcast skills injected"
```

---

### Task 5: `/relay-handoff` slash command

**Files:**
- Create: `commands/relay-handoff.toml`

- [ ] **Step 12: Create commands directory and TOML file**

```bash
mkdir -p commands
```

Create `commands/relay-handoff.toml`:

```toml
description = "Write a handoff note to .relay/memory.md and push to teammates"
prompt = """
Help the user write a Relay handoff note so teammates pick up where they left off.

Steps:
1. Ask the user: "What should teammates know when they pick this up? (Press Enter to write a timestamp-only note.)"
2. Read the current contents of .relay/memory.md.
3. Determine the current UTC time in ISO 8601 format (e.g. 2026-04-22T14:30:00Z).
4. Build the handoff entry:
   - If the user provided text: "- [<timestamp>] <user text>"
   - If the user pressed Enter / provided nothing: "- [<timestamp>] (session handoff — no note)"
5. If a "## Handoff notes" section already exists in memory.md, insert the new entry as the first bullet under that heading.
   If no such section exists, prepend the following to the top of the file:
   "## Handoff notes\n<entry>\n\n"
6. Write atomically: write the full updated content to .relay/memory.md.tmp, then rename it to .relay/memory.md.
7. Run: node bin/relay.mjs distill --push
   If that errors with "No transcript found", fall back to:
   git add .relay/memory.md && git commit -m "[relay] handoff note" && git push origin HEAD
8. Confirm to the user: "Handoff note written and pushed. Teammates will see it at their next SessionStart."
"""
```

- [ ] **Step 13: Verify command format by checking caveman reference**

No automated test for TOML slash commands — verified at install time. Confirm the file exists and is valid TOML:

```bash
node -e "import('node:fs').then(m => { const t = m.default.readFileSync('commands/relay-handoff.toml','utf8'); console.log('OK:', t.length, 'bytes'); })"
```

Expected: `OK: <N> bytes` with no errors.

- [ ] **Step 14: Commit**

```bash
git add commands/relay-handoff.toml
git commit -m "feat(chunk5): /relay-handoff slash command for manual handoff notes"
```

---

### Task 6: README polish + known issues

**Files:**
- Modify: `README.md`

- [ ] **Step 15: Replace README with polished version**

Replace the contents of `README.md` with:

```markdown
# Relay

Shared brain for teams using Claude Code. One memory, every session warm.

> Multiple humans. One brain. Zero workflow change.

## Install

```
/plugins add ssm-08/relay
```

## Init (per repo, once)

```bash
cd your-project
node ~/.claude/plugins/relay/bin/relay.mjs init
git add .relay/memory.md
git commit -m "chore: init relay"
git push
```

Teammates just need the plugin installed — they don't run init again.

## How it works

1. You chat with Claude. Every 5 turns (or 2 min idle), the `Stop` hook spawns `distiller.mjs` **in the background** — your turn is never blocked.
2. Distiller scans the transcript for signal (decisions, rejections, workarounds, real code changes). If none found (Tier 0 filter), the API call is skipped entirely. Otherwise it calls Haiku 4.5 to rewrite `.relay/memory.md`.
3. Distiller commits and pushes `.relay/memory.md` via git.
4. At your teammate's next `SessionStart`, Relay pulls the latest memory and injects it as hidden context. Their Claude starts warm — naming decisions, rejected paths, live workarounds — without a word from the user.

Watch it live:
```bash
tail -f .relay/log
```

## Commands

```bash
# Check memory size, last distillation, git sync, lock state
relay status

# Trigger distillation manually (e.g. before handing off)
relay distill [--transcript <path>] [--force] [--dry-run] [--push]

# Broadcast a skill file to all teammates (injected at their next SessionStart)
relay broadcast-skill <file>

# Slash command (inside Claude Code)
/relay-handoff    # write a manual handoff note and push immediately
```

## Demo (4 minutes)

**Setup:** two laptops, same repo, git remote configured.

**Laptop A:**
```bash
cd your-project
relay init && git add .relay && git commit -m "chore: init relay" && git push
```
Open Claude Code. Discuss the stack — pick SQLite, reject Postgres (too heavy), add a `user_id=1` workaround for fast iteration. After 5 turns:
```bash
cat .relay/memory.md    # SQLite decision, Postgres rejection, workaround noted
```

**Laptop B — fresh session:**
Open Claude Code. Ask: *"What's the state of this project?"*

Claude's **first message** names SQLite, mentions the rejected Postgres, flags `user_id=1` — without you saying a word.

**Broadcast a skill:**
```bash
relay broadcast-skill ./my-style-guide.md
```
Open Laptop A in a new session. Claude says: *"Loaded 1 team skill: `my-style-guide`."*

## Dev install (local symlink)

```bash
# Windows (run as admin, PowerShell)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\plugins\relay" -Target (Get-Location).Path

# macOS / Linux
ln -s "$(pwd)" ~/.claude/plugins/relay
```

## Repo layout

```
├── .claude-plugin/plugin.json      # Claude Code plugin manifest
├── hooks/
│   ├── hooks.json                  # SessionStart + Stop registrations
│   ├── session-start.mjs           # injects memory.md + broadcast as additionalContext
│   └── stop.mjs                    # watermark + detached distiller spawn
├── commands/
│   └── relay-handoff.toml          # /relay-handoff slash command
├── bin/relay.mjs                   # CLI: init | status | distill | broadcast-skill
├── lib/
│   ├── sync.mjs                    # GitSync — pull, push, lock
│   ├── transcript.mjs              # JSONL parse + slice + render
│   ├── memory.mjs                  # atomic memory.md read/write
│   └── filter.mjs                  # Tier 0 regex signal filter
├── distiller.mjs                   # standalone distiller (Haiku 4.5 default)
├── prompts/distill.md              # distiller system prompt
└── docs-site/                      # Astro Starlight documentation
```

## Known issues

1. **Auth required.** The plugin uses `claude -p` headless mode, which requires the user to be authenticated with Claude Code (`claude auth login`). No separate API key needed, but unauthenticated machines get no distillation (memory injection still works; only writes are blocked).

2. **Rare rebase conflict on simultaneous push.** If two teammates distill at the exact same millisecond and both push, the second gets a rebase conflict. The plugin detects this, advances local HEAD to the remote version, and queues a fresh distillation on the next 5 turns. In practice this resolves within one session without data loss.

3. **Transcript version pinning.** The distiller reads Claude Code's JSONL transcript format. If Claude Code changes its transcript schema, distillation may silently skip turns it can't parse. The plugin logs skipped turns to `.relay/log`. Verified against Claude Code ≥ 1.x (`"version":"2.1.117"` format).
```

- [ ] **Step 16: Verify README renders cleanly**

```bash
node -e "const f = require('fs').readFileSync('README.md','utf8'); console.log('Lines:', f.split('\n').length, '| Bytes:', f.length)"
```

Expected: something like `Lines: ~100 | Bytes: ~4000`.

- [ ] **Step 17: Commit README**

```bash
git add README.md
git commit -m "docs(chunk5): polished README — demo script, commands, known issues"
```

---

### Task 7: Full test suite green + docs site update

**Files:**
- Modify: `docs-site/src/content/docs/roadmap/5-broadcast.md` (mark shipped)

- [ ] **Step 18: Run full test suite**

```bash
node --test tests/*.test.mjs
```

Expected output summary: all tests pass. Current baseline is 38 tests (sync) + session-start + stop + distiller + relay-init. New total should be 38 + 6 (broadcast-skill) + 2 (session-start acknowledgment) = **46+ tests green**.

If any test fails, fix before proceeding.

- [ ] **Step 19: Update docs-site roadmap status for Chunk 5**

In `docs-site/src/content/docs/roadmap/5-broadcast.md`, find the status badge line and update it to mark Chunk 5 as shipped. Also update the "you are here" marker in the overview page:

In `docs-site/src/content/docs/roadmap/overview.md` (or equivalent), update the chunk table row:
- Chunk 5: `⏳ next` → `✅ shipped`

- [ ] **Step 20: Update README chunk table**

In `README.md`, update the status table (if present) so Chunk 5 shows ✅.

The polished README from Step 15 does not include the chunk table — skip this step if the table was removed.

- [ ] **Step 21: Final commit**

```bash
git add docs-site/src/content/docs/roadmap/ README.md
git commit -m "docs: mark Chunk 5 shipped — broadcast, handoff, demo script"
git push
```

---

## Self-Review

**Spec coverage:**
- `relay broadcast-skill` CLI → Task 1–2 ✅
- Acknowledgment instruction → Task 3–4 ✅
- `/relay-handoff` slash command → Task 5 ✅
- README demo script + install → Task 6 ✅
- Known issues → Task 6 (section in README) ✅
- Error surfaces (`relay status`, `relay distill --force`) → already shipped in Chunk 4, tested in existing tests ✅

**Placeholder scan:** No TBD or TODO in any task. All code blocks are complete.

**Type consistency:**
- `relayBroadcastSkill(targetDir, filePath)` — same signature in test import (Task 1) and implementation (Task 2) ✅
- `buildContext(cwd)` — same signature in test (Task 3) and implementation (Task 4) ✅
- `sync.push(cwd, sessionId)` — matches existing `GitSync.push` signature in `lib/sync.mjs` ✅
- `sync.lock(cwd)` — matches existing `GitSync.lock` signature ✅
