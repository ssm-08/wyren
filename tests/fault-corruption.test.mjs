/**
 * Fault-injection / state-corruption tests for buildInjection()
 * Tests resilience against malformed/corrupt filesystem state.
 *
 * After the split-file fix: UPS reads/writes ups-state.json (not watermark.json).
 * These tests confirm the hook is resilient to corrupt ups-state.json, not watermark.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildInjection } from '../hooks/user-prompt-submit.mjs';
import { hashMemory } from '../lib/diff-memory.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fault-'));
}

/**
 * Sets up .relay dir. upsState → ups-state.json (UPS-owned, NOT watermark.json).
 */
function makeRelayDir(base, { memory = null, snapshot = null, upsState = null } = {}) {
  const relayDir = path.join(base, '.relay');
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  if (memory !== null) fs.writeFileSync(path.join(relayDir, 'memory.md'), memory, 'utf8');
  if (snapshot !== null) fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), snapshot, 'utf8');
  if (upsState !== null) fs.writeFileSync(path.join(stateDir, 'ups-state.json'), JSON.stringify(upsState), 'utf8');
  return {
    relayDir,
    upsStatePath: path.join(stateDir, 'ups-state.json'),
    snapshotPath: path.join(stateDir, 'last-injected-memory.md'),
    memoryPath: path.join(relayDir, 'memory.md'),
  };
}

// ---------------------------------------------------------------------------
// 1. Corrupt ups-state.json (invalid JSON)
// ---------------------------------------------------------------------------
test('corrupt watermark (invalid JSON) → treated as empty {}, seeds on first run', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, { memory });
    // Write invalid JSON to ups-state.json
    fs.writeFileSync(upsStatePath, '{not valid json!!!', 'utf8');

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'must not throw on corrupt ups-state.json');

    assert.ok(result !== null, 'result should not be null');
    assert.equal(result.delta, null, 'first-run seed: no injection delta');
    assert.ok(result.newUpsState.last_injected_hash, 'hash seeded');
    assert.ok(result.newUpsState.last_injected_mtime, 'mtime seeded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. ups-state with null mtime (NaN-equivalent edge case)
// ---------------------------------------------------------------------------
test('watermark null last_injected_mtime → no fast-path skip, falls through to seed/diff', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, { memory });
    // Write ups-state with null mtime but a hash (simulates partial corruption)
    fs.writeFileSync(
      upsStatePath,
      JSON.stringify({ last_injected_mtime: null, last_injected_hash: 'abc123def456' }),
      'utf8'
    );

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'must not throw with null mtime');

    // null !== currentMtime (a number), so fast-path is bypassed.
    // There is a last_injected_hash (stale), so it is NOT a first-run seed.
    // Diff runs: currentHash !== 'abc123def456' → real content delta path.
    assert.ok(result !== null, 'should return a result');
    // null mtime path: hash differs from 'abc123def456', so content-change path runs.
    // The snapshot file doesn't exist, so snapshotContent = '' and diff produces a delta.
    assert.ok(result.delta !== undefined, 'delta field must be present');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Snapshot file is a directory (EISDIR)
// ---------------------------------------------------------------------------
test('snapshot path is a directory → EISDIR caught, treated as empty snapshot', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory,
      upsState: { last_injected_mtime: 1, last_injected_hash: 'stale000aaaa' },
    });
    // Create the snapshot path as a directory instead of a file
    fs.mkdirSync(snapshotPath, { recursive: true });

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'must not throw when snapshot is a directory');

    assert.ok(result !== null, 'should proceed, not crash');
    // With empty snapshot baseline and real memory → delta should cover the new content
    // (or at minimum the hook must not crash)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. memory.md is a directory
// ---------------------------------------------------------------------------
test('memory.md is a directory → hook returns null without crashing', () => {
  const dir = makeTmpDir();
  try {
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir);
    // Create memory.md as a directory
    fs.mkdirSync(memoryPath, { recursive: true });

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'must not throw when memory.md is a directory');

    // isFile() check in buildInjection returns null for directories
    assert.equal(result, null, 'must return null when memory.md is a directory (not a file)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. memory.md is empty (0 bytes)
// ---------------------------------------------------------------------------
test('empty memory.md → no delta (empty vs empty snapshot), watermark seeded', () => {
  const dir = makeTmpDir();
  try {
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: '',       // 0-byte file
      snapshot: '',     // empty snapshot too
    });
    // No ups-state → first-run seed path

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    });

    // First-run seed: no prior hash
    assert.ok(result !== null);
    assert.equal(result.delta, null, 'no delta for empty file');
    // Hash of '' is deterministic
    assert.ok(result.newUpsState.last_injected_hash, 'hash seeded even for empty content');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. UPS state hash matches empty content → no delta (content unchanged)
// ---------------------------------------------------------------------------
test('watermark hash matches empty content → no delta returned', () => {
  const dir = makeTmpDir();
  try {
    const emptyHash = hashMemory('');
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: '',
      snapshot: '',
      upsState: { last_injected_mtime: 1, last_injected_hash: emptyHash },
    });

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    });

    // currentHash === stored hash → "hash unchanged" path → delta: null
    assert.ok(result !== null);
    assert.equal(result.delta, null, 'delta must be null when hash matches empty content');
    assert.equal(result.newSnapshot, null, 'no snapshot rewrite when hash unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Huge snapshot (100 KB) vs normal memory.md — diff must work, no memory blowup
// ---------------------------------------------------------------------------
test('100KB snapshot + small memory.md → diff works, delta is additions only', () => {
  const dir = makeTmpDir();
  try {
    // Build a 100KB snapshot with many sections/bullets
    const lines = ['## OldSection'];
    for (let i = 0; i < 3000; i++) {
      lines.push(`- old bullet ${i} with enough text to pad the file size up significantly [session old, turn ${i}]`);
    }
    const hugSnapshot = lines.join('\n') + '\n';

    const newMemory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const oldHash = hashMemory(hugSnapshot);

    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: newMemory,
      snapshot: hugSnapshot,
      upsState: { last_injected_mtime: 1, last_injected_hash: oldHash },
    });

    assert.ok(
      Buffer.byteLength(hugSnapshot, 'utf8') > 100 * 1024,
      'snapshot should be >100KB'
    );

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'must not throw or OOM on 100KB snapshot');

    assert.ok(result !== null);
    // Delta should include the new content (additions from new section)
    assert.ok(result.delta, 'delta should be non-empty (new content added)');
    assert.ok(result.delta.includes('Use SQLite'), 'delta contains the new bullet');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. All .relay/state/ files read-only (POSIX only)
// ---------------------------------------------------------------------------
test('read-only watermark.json → buildInjection fails gracefully on write (POSIX only)', {
  skip: process.platform === 'win32' ? 'Windows permission model differs' : false,
}, () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory,
      upsState: { last_injected_mtime: 1, last_injected_hash: 'stale000aaaa' },
    });
    // Make the state directory and its files read-only
    fs.chmodSync(upsStatePath, 0o444);
    fs.chmodSync(path.join(relayDir, 'state'), 0o555);

    // buildInjection() itself only reads; it's the caller (main()) that writes.
    // So buildInjection should return a valid result (content changed path).
    // The write failure only happens in main() after buildInjection returns.
    // This test verifies buildInjection doesn't itself crash on read-only state.
    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'buildInjection must not throw even when state dir is read-only');

    assert.ok(result !== null, 'should return a result for changed content');
  } finally {
    // Restore permissions before cleanup
    try { fs.chmodSync(path.join(dir, '.relay', 'state'), 0o755); } catch {}
    try { fs.chmodSync(path.join(dir, '.relay', 'state', 'ups-state.json'), 0o644); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 9. TOCTOU: memory.md changed between the seed run and a subsequent call
// ---------------------------------------------------------------------------
test('TOCTOU: memory.md rewritten after seed → second call detects change, returns delta', () => {
  const dir = makeTmpDir();
  try {
    const v1 = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: v1,
    });

    // First call → seed (no hash yet)
    let seed;
    assert.doesNotThrow(() => {
      seed = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    });
    assert.ok(seed !== null);
    assert.equal(seed.delta, null, 'first run: seed, no delta');

    // Simulate the caller persisting seed state to ups-state.json
    fs.writeFileSync(upsStatePath, JSON.stringify(seed.newUpsState), 'utf8');
    fs.writeFileSync(snapshotPath, seed.newSnapshot, 'utf8');

    // Now rewrite memory.md with new content (TOCTOU: file changed)
    const v2 = '## Decisions\n- Use SQLite [session a, turn 1]\n- Rate limiting added [session b, turn 3]\n';
    fs.writeFileSync(memoryPath, v2, 'utf8');
    // Ensure mtime advances even on fast machines where same-ms writes are possible
    const futureSec = (Date.now() + 2000) / 1000;
    try { fs.utimesSync(memoryPath, futureSec, futureSec); } catch {}

    // Second call → should detect the change and return a delta
    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    });
    assert.ok(result !== null, 'second call must not return null');
    assert.ok(result.delta, 'delta must be non-empty after content change');
    assert.ok(result.delta.includes('Rate limiting added'), 'delta contains new bullet');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 10. ups-state.json is 1 MB of garbage — parse must fail, fall back to {}
// ---------------------------------------------------------------------------
test('1MB garbage watermark → parse fails, falls back to empty {}, seeds without crash', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, upsStatePath, snapshotPath, memoryPath } = makeRelayDir(dir, { memory });

    // Write 1MB of garbage that is not valid JSON
    const garbage = 'x'.repeat(1024 * 1024);
    fs.writeFileSync(upsStatePath, garbage, 'utf8');

    let result;
    assert.doesNotThrow(() => {
      result = buildInjection({ cwd: dir, relayDir, upsStatePath, snapshotPath, memoryPath });
    }, 'must not throw or OOM on 1MB garbage ups-state.json');

    assert.ok(result !== null, 'should return seed result');
    assert.equal(result.delta, null, 'first-run seed: no injection delta');
    assert.ok(result.newUpsState.last_injected_hash, 'hash seeded after fallback');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
