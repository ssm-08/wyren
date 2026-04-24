/**
 * fault-network.test.mjs
 *
 * Fault-injection tests for network/git faults in the UserPromptSubmit hook.
 * All tests verify that the hook exits 0 and does not crash regardless of git/network state.
 *
 * Run:  node --test tests/fault-network.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildInjection } from '../hooks/user-prompt-submit.mjs';
import { hashMemory } from '../lib/diff-memory.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RELAY_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fault-'));
}

/** Initialise a bare git repo (no remote origin). */
function initGit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@relay'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'relay-test'], { cwd: dir, encoding: 'utf8' });
}

/** Create .relay dir with optional memory + state files. */
function seedRelay(dir, { memory = null, upsState = null, snapshot = null } = {}) {
  const relayDir = path.join(dir, '.relay');
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  if (memory !== null) {
    fs.writeFileSync(path.join(relayDir, 'memory.md'), memory, 'utf8');
  }
  if (upsState !== null) {
    fs.writeFileSync(path.join(stateDir, 'ups-state.json'), JSON.stringify(upsState), 'utf8');
  }
  if (snapshot !== null) {
    fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), snapshot, 'utf8');
  }
  return {
    relayDir,
    stateDir,
    memoryPath: path.join(relayDir, 'memory.md'),
    upsStatePath: path.join(stateDir, 'ups-state.json'),
    snapshotPath: path.join(stateDir, 'last-injected-memory.md'),
  };
}

/**
 * Run the user-prompt-submit hook as a subprocess.
 * opts.env overrides (merged on top of process.env).
 * opts.skipPull sets RELAY_SKIP_PULL=1.
 * opts.path overrides PATH (node is always invoked via process.execPath so PATH only affects git).
 */
function runHook(cwd, opts = {}) {
  const stdin = JSON.stringify({
    session_id: 'fault-test',
    transcript_path: '',
    cwd,
    hook_event_name: 'UserPromptSubmit',
  });

  // Build env — omit RELAY_SKIP_PULL if not requested (delete any inherited value)
  const env = { ...process.env };
  if (opts.skipPull) {
    env.RELAY_SKIP_PULL = '1';
  } else {
    delete env.RELAY_SKIP_PULL;
  }
  if (opts.path !== undefined) {
    env.PATH = opts.path;
  }
  if (opts.env) {
    Object.assign(env, opts.env);
  }

  // Use process.execPath (absolute path to node binary) so that overriding PATH
  // does not prevent node itself from being found — PATH restriction only affects git.
  return spawnSync(process.execPath, ['hooks/user-prompt-submit.mjs'], {
    cwd: RELAY_ROOT,
    input: stdin,
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
}

// ---------------------------------------------------------------------------
// Test 1: No remote configured — git repo exists but has no origin
// ---------------------------------------------------------------------------

test('no remote configured — hook exits 0 without crashing', () => {
  const dir = makeTmpDir();
  try {
    initGit(dir);  // bare git init, no remote
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    seedRelay(dir, { memory });

    const result = runHook(dir);

    assert.equal(result.status, 0, `hook exited with ${result.status}: stderr=${result.stderr}`);
    assert.equal(result.error, undefined, `hook threw spawn error: ${result.error}`);
    // Must not emit any structured error output — stdout should be empty or valid JSON (no crash)
    const stdout = (result.stdout || '').trim();
    if (stdout) {
      // If there IS output it must be valid JSON (additionalContext shape), not an error dump
      assert.doesNotThrow(() => JSON.parse(stdout), 'stdout must be valid JSON if non-empty');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: RELAY_SKIP_PULL=1 + disk content changed → diff still injected
// ---------------------------------------------------------------------------

test('RELAY_SKIP_PULL=1 + content changed on disk — delta injected without network', () => {
  const dir = makeTmpDir();
  try {
    initGit(dir);
    const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n- Add rate limiting [session b, turn 2]\n';

    // Seed .relay with NEW memory.md (simulating a change from another machine already landed)
    const { upsStatePath } = seedRelay(dir, {
      memory: newMem,
      snapshot: oldMem,
      // UPS state references the OLD hash so the hook sees a change
      upsState: { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) },
    });

    // Run with RELAY_SKIP_PULL — skips network fetch but disk is already updated
    const result = runHook(dir, { skipPull: true });

    assert.equal(result.status, 0, `hook exited ${result.status}: stderr=${result.stderr}`);
    assert.equal(result.error, undefined);

    const stdout = (result.stdout || '').trim();
    assert.ok(stdout.length > 0, 'hook should emit additionalContext when content changed');

    const parsed = JSON.parse(stdout);
    assert.ok(parsed.hookSpecificOutput, 'output must have hookSpecificOutput');
    assert.ok(parsed.hookSpecificOutput.additionalContext, 'must have additionalContext');
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes('Add rate limiting'),
      'delta must include the new bullet'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: Pull timeout simulation — buildInjection with pre-changed disk file
// ---------------------------------------------------------------------------

test('pull timeout — buildInjection proceeds with disk state, exits 0', () => {
  const dir = makeTmpDir();
  try {
    // No real git network possible here; we test that buildInjection itself handles
    // the case where pull threw (hook catches it and calls buildInjection anyway).
    const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n- New item [session c, turn 3]\n';

    const { relayDir, upsStatePath, snapshotPath, memoryPath } = seedRelay(dir, {
      memory: newMem,
      snapshot: oldMem,
      upsState: { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) },
    });

    // Directly call buildInjection (simulates the hook after a timed-out pull)
    const result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null, 'buildInjection must return a result after timeout');
    assert.ok(result.delta, 'delta should be non-null when content changed');
    assert.ok(result.delta.includes('New item'), 'delta must reflect the disk-side change');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Also verify via full subprocess with an env that would make fetch hang (RELAY_SKIP_PULL=0
// but no remote → git config check short-circuits safely). The hook itself must exit 0.
test('pull timeout subprocess — hook exits 0 (no remote = instant short-circuit)', () => {
  const dir = makeTmpDir();
  try {
    initGit(dir);  // no origin → pull() returns early before any fetch
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    seedRelay(dir, { memory });

    const result = runHook(dir);  // RELAY_SKIP_PULL NOT set — exercises short-circuit path

    assert.equal(result.status, 0, `hook crashed: ${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: git not on PATH — ENOENT from git spawn must be caught gracefully
// ---------------------------------------------------------------------------

test('git not on PATH — hook exits 0 (ENOENT handled gracefully)', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    seedRelay(dir, { memory });

    // Override PATH to a non-existent directory so git spawn throws ENOENT
    const result = runHook(dir, { path: path.join(os.tmpdir(), 'nonexistent-path-relay-test') });

    // The hook must exit 0 even when git is not found
    assert.equal(result.status, 0, `hook exited ${result.status} when git not on PATH: stderr=${result.stderr}`);
    assert.equal(result.error, undefined, `spawn itself should not error: ${result.error}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Also verify buildInjection directly — it has no git dependency; it must work regardless
test('git not on PATH — buildInjection has no git dependency, works fine', () => {
  const dir = makeTmpDir();
  try {
    const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n- No git needed [session d, turn 4]\n';

    const { relayDir, upsStatePath, snapshotPath, memoryPath } = seedRelay(dir, {
      memory: newMem,
      snapshot: oldMem,
      upsState: { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) },
    });

    const result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null, 'buildInjection must succeed without git');
    assert.ok(result.delta && result.delta.includes('No git needed'), 'delta must reflect change');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: No .relay dir at all — hook exits 0 immediately
// ---------------------------------------------------------------------------

test('no .relay dir — hook exits 0 immediately', () => {
  const dir = makeTmpDir();
  try {
    // Plain empty directory — no git, no .relay
    const result = runHook(dir);

    assert.equal(result.status, 0, `hook exited ${result.status}: stderr=${result.stderr}`);
    assert.equal(result.error, undefined);
    // Hook should produce no stdout (early exit)
    const stdout = (result.stdout || '').trim();
    assert.equal(stdout, '', 'no output expected when .relay dir is absent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Also test via buildInjection — the memoryPath doesn't exist path
test('no .relay dir — buildInjection returns null for missing memoryPath', () => {
  const dir = makeTmpDir();
  try {
    const relayDir = path.join(dir, '.relay');
    const stateDir = path.join(relayDir, 'state');
    const result = buildInjection({
      cwd: dir,
      relayDir,
      watermarkPath: path.join(stateDir, 'watermark.json'),
      snapshotPath: path.join(stateDir, 'last-injected-memory.md'),
      memoryPath: path.join(relayDir, 'memory.md'),  // does not exist
    });

    assert.equal(result, null, 'buildInjection must return null when memory.md missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: Empty git repo (no commits, no HEAD) — pull fails gracefully
// ---------------------------------------------------------------------------

test('empty git repo (no commits) — hook exits 0, pull failure handled gracefully', () => {
  const dir = makeTmpDir();
  try {
    // git init but no commits → no HEAD, `git config --get remote.origin.url` fails → short-circuits
    spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'test@relay'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'relay-test'], { cwd: dir, encoding: 'utf8' });
    // Add a fake remote to force the fetch path (which will fail because there's no remote server)
    spawnSync('git', ['remote', 'add', 'origin', 'git://localhost:9/nonexistent.git'], { cwd: dir, encoding: 'utf8' });

    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    seedRelay(dir, { memory });

    // RELAY_SKIP_PULL not set — hook will attempt pull, fetch will fail → fail-open
    const result = runHook(dir);

    assert.equal(result.status, 0, `hook exited ${result.status}: stderr=${result.stderr}`);
    assert.equal(result.error, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Variant: truly empty repo, no remote at all — sanity check on the short-circuit path
test('empty git repo, no remote — hook exits 0 without touching network', () => {
  const dir = makeTmpDir();
  try {
    initGit(dir);  // no remote, no commits
    const memory = '## Status\n- No commits yet [session e, turn 1]\n';
    seedRelay(dir, { memory });

    const result = runHook(dir);

    assert.equal(result.status, 0, `hook crashed: ${result.stderr}`);
    assert.equal(result.error, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
