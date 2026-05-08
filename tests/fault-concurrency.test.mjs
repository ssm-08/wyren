/**
 * Fault Resilience — Concurrency / Race Condition Tests
 *
 * Tests that ups-state.json and watermark.json remain consistent under concurrent
 * writes from multiple UPS hook invocations and simultaneous UPS + Stop hooks.
 *
 * After the split-file fix (ups-state.json owned by UPS, watermark.json owned by Stop),
 * the two hooks never share a writable file — eliminating the read-modify-write race.
 *
 * All subprocess spawns use WYREN_SKIP_PULL=1 to avoid network calls.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WYREN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-conc-'));
}

function initGit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['config', 'user.email', 'test@wyren.local'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['config', 'user.name', 'Wyren Test'], { cwd: dir, encoding: 'utf8', windowsHide: true });
}

/**
 * Create .wyren structure.
 *   upsState   → .wyren/state/ups-state.json   (UPS-owned: last_injected_mtime, last_injected_hash)
 *   stopState  → .wyren/state/watermark.json   (Stop-owned: turns_since_distill, etc.)
 */
function seedWyren(dir, { memory = null, upsState = null, stopState = null } = {}) {
  const wyrenDir = path.join(dir, '.wyren');
  const stateDir = path.join(wyrenDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  if (memory !== null) {
    fs.writeFileSync(path.join(wyrenDir, 'memory.md'), memory, 'utf8');
  }
  if (upsState !== null) {
    fs.writeFileSync(path.join(stateDir, 'ups-state.json'), JSON.stringify(upsState, null, 2), 'utf8');
  }
  if (stopState !== null) {
    fs.writeFileSync(path.join(stateDir, 'watermark.json'), JSON.stringify(stopState, null, 2), 'utf8');
  }
  // Create empty log file
  fs.writeFileSync(path.join(wyrenDir, 'log'), '', 'utf8');
}

function readUpsState(dir) {
  const p = path.join(dir, '.wyren', 'state', 'ups-state.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readStopState(dir) {
  const p = path.join(dir, '.wyren', 'state', 'watermark.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Spawn user-prompt-submit.mjs hook as a subprocess with the given cwd.
 * Returns a Promise<{code, stdout, stderr}>.
 */
function spawnUPS(targetCwd) {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      session_id: `test-${process.pid}-${Math.random().toString(36).slice(2)}`,
      transcript_path: '',
      cwd: targetCwd,
      hook_event_name: 'UserPromptSubmit',
    });

    const proc = spawn('node', ['hooks/user-prompt-submit.mjs'], {
      cwd: WYREN_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, WYREN_SKIP_PULL: '1' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdin.end(input, 'utf8');
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + err.message }));
  });
}

/**
 * Spawn stop.mjs hook as a subprocess with the given cwd.
 */
function spawnStop(targetCwd, { extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      session_id: `test-${process.pid}-${Math.random().toString(36).slice(2)}`,
      transcript_path: path.join(os.tmpdir(), 'fake-transcript.jsonl'),
      cwd: targetCwd,
      hook_event_name: 'Stop',
    });

    const proc = spawn('node', ['hooks/stop.mjs'], {
      cwd: WYREN_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, WYREN_SKIP_PULL: '1', ...extraEnv },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdin.end(input, 'utf8');
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + err.message }));
  });
}

// Run tests sequentially: each test spawns 5-20 subprocesses; running all concurrently
// overwhelms Windows process creation limits and causes intermittent EPERM failures.
describe('fault-concurrency (sequential)', { concurrency: false }, () => {

// ---------------------------------------------------------------------------
// Test 1: 10 concurrent UPS fires on same .wyren/ dir
// ---------------------------------------------------------------------------

test('Test 1: 10 concurrent UPS on same dir → all exit 0, ups-state consistent JSON', async () => {
  const dir = makeTmpDir();
  initGit(dir);

  const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n- Add caching [session b, turn 2]\n';
  seedWyren(dir, {
    memory,
    // No ups-state seeded → first-run race: all 10 see no last_injected_hash
  });

  // Fire 10 concurrent UPS instances
  const results = await Promise.all(
    Array.from({ length: 10 }, () => spawnUPS(dir))
  );

  // All must exit cleanly
  const nonZeroExits = results.filter((r) => r.code !== 0);
  assert.equal(nonZeroExits.length, 0,
    `Expected all exits to be 0, got:\n${nonZeroExits.map((r) => JSON.stringify(r)).join('\n')}`
  );

  // ups-state.json must be readable valid JSON
  const upsStatePath = path.join(dir, '.wyren', 'state', 'ups-state.json');
  assert.ok(fs.existsSync(upsStatePath), 'ups-state.json must exist after 10 concurrent UPS');

  let st;
  assert.doesNotThrow(() => {
    st = JSON.parse(fs.readFileSync(upsStatePath, 'utf8'));
  }, 'ups-state.json must be valid JSON — no partial write corruption');

  // Must have last_injected_hash seeded by at least one process
  assert.ok(st.last_injected_hash, 'last_injected_hash must be set after 10 concurrent first-runs');
  assert.ok(st.last_injected_mtime, 'last_injected_mtime must be set');

  // No .tmp files should linger (atomic write guarantee)
  const stateDir = path.join(dir, '.wyren', 'state');
  const tmpFiles = fs.readdirSync(stateDir).filter((f) => f.includes('.tmp'));
  assert.equal(tmpFiles.length, 0, `Stale .tmp files found: ${tmpFiles.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 2: UPS and Stop hook fire simultaneously — no cross-file clobber
// ---------------------------------------------------------------------------

test('Test 2: UPS + Stop concurrent → each owns separate file, both keys survive', async () => {
  const dir = makeTmpDir();
  initGit(dir);

  const memory = '## Decisions\n- Use Postgres [session a, turn 1]\n';
  // Seed both files independently
  seedWyren(dir, {
    memory,
    upsState: {
      last_injected_mtime: 1, // stale → UPS will process
      last_injected_hash: 'stalehash000',
    },
    stopState: {
      turns_since_distill: 0,
      last_turn_at: Date.now() - 60_000,
    },
  });

  // Both hooks fire at the exact same moment
  const [upsResult, stopResult] = await Promise.all([
    spawnUPS(dir),
    spawnStop(dir),
  ]);

  assert.equal(upsResult.code, 0,
    `UPS hook must exit 0, got: ${upsResult.code}\nstderr: ${upsResult.stderr}`);
  assert.equal(stopResult.code, 0,
    `Stop hook must exit 0, got: ${stopResult.code}\nstderr: ${stopResult.stderr}`);

  // ups-state.json must be valid JSON with updated hash
  let upsState;
  assert.doesNotThrow(() => {
    upsState = readUpsState(dir);
  }, 'ups-state.json must be valid JSON after concurrent UPS+Stop');
  assert.ok(upsState.last_injected_hash,
    'last_injected_hash must exist in ups-state.json after UPS ran');

  // watermark.json must be valid JSON with incremented turns
  let stopState;
  assert.doesNotThrow(() => {
    stopState = readStopState(dir);
  }, 'watermark.json must be valid JSON after concurrent UPS+Stop');
  assert.ok(typeof stopState.turns_since_distill === 'number' && stopState.turns_since_distill >= 1,
    `turns_since_distill must be ≥ 1 after Stop ran, got: ${stopState.turns_since_distill}`);

  // Each file must NOT contain the other's keys (verify split ownership)
  assert.ok(!('turns_since_distill' in upsState),
    'ups-state.json must not contain Stop-owned turns_since_distill');
  assert.ok(!('last_injected_hash' in stopState),
    'watermark.json must not contain UPS-owned last_injected_hash (split is clean)');

  // No .tmp files
  const stateDir = path.join(dir, '.wyren', 'state');
  const tmpFiles = fs.readdirSync(stateDir).filter((f) => f.includes('.tmp'));
  assert.equal(tmpFiles.length, 0, `Stale .tmp files: ${tmpFiles.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 3: First-run race — 5 concurrent UPS on empty ups-state
// ---------------------------------------------------------------------------

test('Test 3: 5 concurrent UPS on empty ups-state → no corruption, hash seeded', async () => {
  const dir = makeTmpDir();
  initGit(dir);

  const memory = '## Architecture\n- Microservices pattern [session a, turn 1]\n';
  // No ups-state at all — pure first-run race
  seedWyren(dir, { memory });

  const results = await Promise.all(
    Array.from({ length: 5 }, () => spawnUPS(dir))
  );

  const nonZero = results.filter((r) => r.code !== 0);
  assert.equal(nonZero.length, 0,
    `All 5 first-run UPS must exit 0:\n${nonZero.map((r) => JSON.stringify(r)).join('\n')}`);

  // ups-state.json must be valid JSON
  let st;
  assert.doesNotThrow(() => {
    st = readUpsState(dir);
  }, 'ups-state.json must be valid JSON after 5 concurrent first-runs');

  assert.ok(st.last_injected_hash, 'last_injected_hash must be seeded by exactly one winner');
  assert.ok(st.last_injected_mtime, 'last_injected_mtime must be seeded');

  // Verify the hash is correct for the memory content
  const { hashMemory } = await import('../lib/diff-memory.mjs');
  const expectedHash = hashMemory(memory);
  assert.equal(st.last_injected_hash, expectedHash,
    'Seeded hash must match actual memory content hash');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 4: Rapid sequential UPS — 20 calls back-to-back, unchanged memory
// ---------------------------------------------------------------------------

test('Test 4: 20 rapid sequential UPS with unchanged memory → fast-path, state stable', async () => {
  const dir = makeTmpDir();
  initGit(dir);

  const { hashMemory } = await import('../lib/diff-memory.mjs');
  const memory = '## Decisions\n- Use Redis for caching [session a, turn 1]\n';

  seedWyren(dir, { memory });
  // Get actual mtime after writing
  const actualMtime = fs.statSync(path.join(dir, '.wyren', 'memory.md')).mtimeMs;

  // Seed ups-state with current mtime → UPS fast-path (mtime unchanged → return null)
  const stateDir = path.join(dir, '.wyren', 'state');
  fs.writeFileSync(
    path.join(stateDir, 'ups-state.json'),
    JSON.stringify({
      last_injected_mtime: actualMtime,
      last_injected_hash: hashMemory(memory),
    }, null, 2),
    'utf8'
  );

  // Run 20 calls sequentially
  const results = [];
  for (let i = 0; i < 20; i++) {
    results.push(await spawnUPS(dir));
  }

  const nonZero = results.filter((r) => r.code !== 0);
  assert.equal(nonZero.length, 0,
    `All 20 sequential UPS must exit 0:\n${nonZero.map((r) => JSON.stringify(r)).join('\n')}`);

  // ups-state.json must still be valid JSON
  let finalSt;
  assert.doesNotThrow(() => {
    finalSt = readUpsState(dir);
  }, 'ups-state.json must be valid JSON after 20 sequential UPS');

  // Hash and mtime must be unchanged (fast-path hit → no writes occurred)
  assert.equal(finalSt.last_injected_mtime, actualMtime,
    'Fast-path: mtime must be unchanged after 20 no-op UPS calls');
  assert.equal(finalSt.last_injected_hash, hashMemory(memory),
    'Fast-path: hash must be unchanged after 20 no-op UPS calls');

  // No garbage accumulation
  const files = fs.readdirSync(stateDir);
  const tmpFiles = files.filter((f) => f.includes('.tmp'));
  assert.equal(tmpFiles.length, 0, `No .tmp accumulation: ${tmpFiles.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 5: Read-modify-write correctness — UPS does NOT touch Stop's watermark
// ---------------------------------------------------------------------------

test('Test 5: Sequential Stop then UPS → Stop watermark keys preserved (no clobber)', async () => {
  /**
   * This test verifies the fix works correctly:
   * - Stop runs and increments turns_since_distill in watermark.json
   * - UPS then runs and writes ups-state.json
   * - Stop's watermark.json must be untouched by UPS
   */
  const dir = makeTmpDir();
  initGit(dir);

  const memory = '## Decisions\n- Use Kafka [session a, turn 1]\n';
  seedWyren(dir, {
    memory,
    upsState: {
      last_injected_mtime: 1, // stale → UPS will write
      last_injected_hash: 'oldhash00000',
    },
    stopState: {
      turns_since_distill: 2,
      last_turn_at: Date.now() - 1000,
    },
  });

  // Step 1: Stop runs first
  const stopResult = await spawnStop(dir);
  assert.equal(stopResult.code, 0, `Stop must exit 0: ${stopResult.stderr}`);

  const afterStop = readStopState(dir);
  assert.equal(afterStop.turns_since_distill, 3,
    'Stop must have incremented turns_since_distill from 2 to 3');

  // Step 2: UPS runs after — must write ups-state.json only, not touch watermark.json
  const upsResult = await spawnUPS(dir);
  assert.equal(upsResult.code, 0, `UPS must exit 0: ${upsResult.stderr}`);

  const afterUPS = readStopState(dir);

  // Stop's watermark.json must be completely unchanged by UPS
  assert.equal(afterUPS.turns_since_distill, 3,
    `UPS must NOT touch turns_since_distill in watermark.json, got: ${afterUPS.turns_since_distill}`);

  // UPS must have updated its own state file
  const upsState = readUpsState(dir);
  assert.notEqual(upsState.last_injected_hash, 'oldhash00000',
    'UPS must have updated the stale last_injected_hash in ups-state.json');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 6: Atomic write integrity — no torn reads under rapid concurrent writes
// ---------------------------------------------------------------------------

test('Test 6: Atomic write — no torn JSON from 15 concurrent ups-state renames', async () => {
  /**
   * writeUpsStateAtomic uses write-to-tmp + rename.
   * On NTFS, MoveFileExW is effectively atomic for complete files.
   * Stresses the pattern with 15 concurrent UPS hooks all attempting to write
   * different ups-state content. At the end, ups-state.json must parse cleanly.
   */
  const dir = makeTmpDir();
  initGit(dir);

  // Seed with stale hash so all 15 processes attempt a write
  const memory = '## Stress\n- Bullet one [session x, turn 1]\n- Bullet two [session x, turn 2]\n';
  seedWyren(dir, {
    memory,
    upsState: {
      last_injected_mtime: 1,
      last_injected_hash: 'stalehash000',
    },
  });

  const N = 15;
  const results = await Promise.all(
    Array.from({ length: N }, () => spawnUPS(dir))
  );

  const nonZero = results.filter((r) => r.code !== 0);
  assert.equal(nonZero.length, 0,
    `All ${N} concurrent UPS must exit 0:\n${nonZero.map((r) => JSON.stringify(r)).join('\n')}`);

  // The key assertion: ups-state must be parseable after all renames
  let finalSt;
  assert.doesNotThrow(() => {
    finalSt = readUpsState(dir);
  }, 'ups-state.json must be valid JSON after 15 concurrent rename operations');

  // Must have a valid hash (not partial/truncated)
  assert.match(finalSt.last_injected_hash, /^[0-9a-f]{12}$/,
    `last_injected_hash must be a 12-char hex string, got: ${finalSt.last_injected_hash}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 7: UPS output consistency — concurrent processes, at most 1 injects delta
// ---------------------------------------------------------------------------

test('Test 7: 8 concurrent UPS with real content change → at most all emit delta, JSON valid', async () => {
  /**
   * When memory.md genuinely changed, multiple concurrent UPS hooks all see
   * the new content. Because the snapshot is also UPS-owned (separate file),
   * multiple may compute and emit a delta — this is acceptable (idempotent injection).
   * What is NOT acceptable: any process crashing or producing invalid JSON output.
   */
  const dir = makeTmpDir();
  initGit(dir);

  const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
  const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n- Add indexes [session b, turn 3]\n';

  const { hashMemory } = await import('../lib/diff-memory.mjs');
  seedWyren(dir, {
    memory: newMem,
    upsState: {
      last_injected_mtime: 1,  // stale → all 8 will read memory
      last_injected_hash: hashMemory(oldMem),
    },
  });

  const stateDir = path.join(dir, '.wyren', 'state');
  // Write a snapshot of the old content for diffing
  fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), oldMem, 'utf8');

  const results = await Promise.all(
    Array.from({ length: 8 }, () => spawnUPS(dir))
  );

  const nonZero = results.filter((r) => r.code !== 0);
  assert.equal(nonZero.length, 0,
    `All 8 concurrent UPS must exit 0:\n${nonZero.map((r) => JSON.stringify(r)).join('\n')}`);

  // Count how many emitted a delta (non-empty stdout with hookSpecificOutput)
  const deltaEmitters = results.filter((r) => r.stdout.includes('additionalContext'));
  // Each emitter's stdout must be valid JSON
  for (const emitter of deltaEmitters) {
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(emitter.stdout.trim());
    }, `Delta output must be valid JSON: ${emitter.stdout.slice(0, 200)}`);
    assert.ok(parsed.hookSpecificOutput?.additionalContext,
      'additionalContext must be non-empty string');
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Wyren live update'),
      'additionalContext must include the wyren header');
  }

  // ups-state.json must be clean JSON with updated hash
  let finalSt;
  assert.doesNotThrow(() => {
    finalSt = readUpsState(dir);
  }, 'ups-state.json must be valid JSON');
  assert.equal(finalSt.last_injected_hash, hashMemory(newMem),
    'ups-state hash must reflect new memory content');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 8: Documented race (historical) — confirmed FIXED by split-file approach
// ---------------------------------------------------------------------------

test('Test 8 (race eliminated): UPS writes ups-state.json, Stop writes watermark.json — no shared state', async (t) => {
  /**
   * ORIGINAL BUG (pre-fix): Both UPS and Stop wrote to watermark.json using
   * read-modify-write (spread + atomic rename). The race window:
   *   1. UPS reads watermark (captures turns_since_distill=2 in spread)
   *   2. Stop writes watermark (turns_since_distill → 3)
   *   3. UPS writes its stale spread (turns_since_distill → 2 again) ← data lost
   *
   * FIX: Split into two files:
   *   ups-state.json    → owned exclusively by UPS (last_injected_mtime, last_injected_hash)
   *   watermark.json    → owned exclusively by Stop (turns_since_distill, distiller_running, etc.)
   *
   * With separate files, each hook only atomically rewrites its own file.
   * No concurrent process ever reads one and writes the other. Race eliminated.
   *
   * This test verifies the split is structurally correct by running both hooks
   * 20 times concurrently and checking that neither file is corrupted.
   */
  const dir = makeTmpDir();
  initGit(dir);

  const memory = '## Decisions\n- Use Redis [session a, turn 1]\n';
  seedWyren(dir, {
    memory,
    upsState: { last_injected_mtime: 1, last_injected_hash: 'stale0000000' },
    stopState: { turns_since_distill: 0, last_turn_at: Date.now() },
  });

  // Hammer both hooks concurrently: 10 UPS + 10 Stop
  // WYREN_TURNS_THRESHOLD=100: prevents distillation from firing (which would reset
  // turns_since_distill to 0) even if processes run sequentially on a slow CI runner.
  const upsPromises = Array.from({ length: 10 }, () => spawnUPS(dir));
  const stopPromises = Array.from({ length: 10 }, () => spawnStop(dir, { extraEnv: { WYREN_TURNS_THRESHOLD: '100' } }));
  const results = await Promise.all([...upsPromises, ...stopPromises]);

  const nonZero = results.filter((r) => r.code !== 0);
  assert.equal(nonZero.length, 0,
    `All 20 concurrent hook invocations must exit 0:\n${nonZero.map((r) => JSON.stringify(r)).join('\n')}`);

  // Both files must be parseable valid JSON
  let upsState, stopState;
  assert.doesNotThrow(() => { upsState = readUpsState(dir); },
    'ups-state.json must be valid JSON after 20 concurrent mixed hook fires');
  assert.doesNotThrow(() => { stopState = readStopState(dir); },
    'watermark.json must be valid JSON after 20 concurrent mixed hook fires');

  // UPS state must have been updated
  assert.ok(upsState.last_injected_hash,
    'ups-state.json must have last_injected_hash after concurrent UPS runs');

  // Stop state must have turns accumulated
  assert.ok(stopState.turns_since_distill >= 1,
    `watermark.json turns_since_distill must be ≥ 1 after 10 Stop runs, got: ${stopState.turns_since_distill}`);

  // Cross-file check: neither file must contain the other's keys
  assert.ok(!('turns_since_distill' in upsState),
    'ups-state.json must not contain Stop-owned turns_since_distill');
  assert.ok(!('last_injected_hash' in stopState),
    'watermark.json must not contain UPS-owned last_injected_hash');

  t.diagnostic(`Final ups-state: hash=${upsState.last_injected_hash}`);
  t.diagnostic(`Final watermark: turns_since_distill=${stopState.turns_since_distill}`);
  t.diagnostic('Race condition eliminated by split-file ownership (no shared write state).');

  fs.rmSync(dir, { recursive: true, force: true });
});

}); // describe fault-concurrency (sequential)
