import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildInjection } from '../hooks/user-prompt-submit.mjs';
import { hashMemory } from '../lib/diff-memory.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-ups-test-'));
}

/**
 * Sets up a .wyren dir with the new file layout:
 *   .wyren/state/ups-state.json   — UPS-owned (last_injected_mtime, last_injected_hash)
 *   .wyren/state/watermark.json   — Stop-owned (turns_since_distill etc.)
 *   .wyren/state/last-injected-memory.md — UPS snapshot
 *   .wyren/memory.md
 */
function makeWyrenDir(base, { memory = null, snapshot = null, upsState = null } = {}) {
  const wyrenDir = path.join(base, '.wyren');
  const stateDir = path.join(wyrenDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  if (memory !== null) {
    fs.writeFileSync(path.join(wyrenDir, 'memory.md'), memory, 'utf8');
  }
  if (snapshot !== null) {
    fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), snapshot, 'utf8');
  }
  if (upsState !== null) {
    fs.writeFileSync(path.join(stateDir, 'ups-state.json'), JSON.stringify(upsState), 'utf8');
  }
  return {
    wyrenDir,
    upsStatePath: path.join(stateDir, 'ups-state.json'),
    snapshotPath: path.join(stateDir, 'last-injected-memory.md'),
    memoryPath: path.join(wyrenDir, 'memory.md'),
  };
}

test('first-run seed: empty ups-state → seed mtime+hash, no injection', () => {
  const dir = makeTmpDir();
  try {
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory: '## Decisions\n- Use SQLite [session a, turn 1]\n',
    });

    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null, 'result should not be null');
    assert.equal(result.delta, null, 'no injection on first run');
    assert.ok(result.newUpsState.last_injected_hash, 'hash should be seeded');
    assert.ok(result.newUpsState.last_injected_mtime, 'mtime should be seeded');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('unchanged mtime → fast-path, no injection, result null', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory,
      snapshot: memory,
    });
    const mtime = fs.statSync(memoryPath).mtimeMs;
    // Seed ups-state with current mtime → fast-path
    fs.writeFileSync(upsStatePath, JSON.stringify({ last_injected_mtime: mtime, last_injected_hash: 'abc123def456' }), 'utf8');

    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('mtime changed but hash same → update mtime only, no injection delta', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory,
      snapshot: memory,
    });
    const hash = hashMemory(memory);
    // Use a stale mtime so fast-path doesn't skip
    fs.writeFileSync(upsStatePath, JSON.stringify({ last_injected_mtime: 1, last_injected_hash: hash }), 'utf8');

    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null);
    assert.equal(result.delta, null, 'no delta when hash same');
    assert.ok(result.newUpsState.last_injected_mtime > 1, 'mtime updated');
    assert.equal(result.newSnapshot, null, 'no snapshot rewrite needed');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('real content change → delta returned, ups-state+snapshot updated', () => {
  const dir = makeTmpDir();
  try {
    const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n- Add rate limiting [session b, turn 2]\n';
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory: newMem,
      snapshot: oldMem,
      upsState: { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) },
    });

    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null);
    assert.ok(result.delta, 'delta should be non-empty');
    assert.ok(result.delta.includes('Add rate limiting'), 'delta should contain new bullet');
    assert.ok(result.delta.includes('Wyren live update'), 'delta has header');
    assert.equal(result.newSnapshot, newMem, 'snapshot updated to new memory');
    assert.equal(result.newUpsState.last_injected_hash, hashMemory(newMem));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('corrupt snapshot → treat as empty, inject full diff', () => {
  const dir = makeTmpDir();
  try {
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory: newMem,
    });
    // Write corrupt snapshot
    fs.writeFileSync(snapshotPath, Buffer.from([0xff, 0xfe, 0x00]), 'binary');
    fs.writeFileSync(upsStatePath, JSON.stringify({ last_injected_mtime: 1, last_injected_hash: 'stale000aaaa' }), 'utf8');

    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null, 'should not throw on corrupt snapshot');
    // Delta may be non-null (treated as new content from empty baseline)
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ups-state write does NOT include Stop-owned keys (no cross-contamination)', () => {
  const dir = makeTmpDir();
  try {
    const oldMem = '## Decisions\n- old [session a, turn 1]\n';
    const newMem = '## Decisions\n- old [session a, turn 1]\n- new [session b, turn 2]\n';
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory: newMem,
      snapshot: oldMem,
      upsState: { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) },
    });

    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });

    assert.ok(result !== null);
    // UPS-owned state must only contain UPS fields
    assert.ok('last_injected_hash' in result.newUpsState, 'has last_injected_hash');
    assert.ok('last_injected_mtime' in result.newUpsState, 'has last_injected_mtime');
    // Must NOT contain Stop-owned fields
    assert.ok(!('turns_since_distill' in result.newUpsState),
      'newUpsState must not contain turns_since_distill (Stop-owned)');
    assert.ok(!('distiller_running' in result.newUpsState),
      'newUpsState must not contain distiller_running (Stop-owned)');
    assert.ok(!('last_uuid' in result.newUpsState),
      'newUpsState must not contain last_uuid (Stop-owned)');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ups-state and watermark.json remain independent after concurrent UPS+Stop', () => {
  /**
   * Verifies that with the split-file fix, UPS writes to ups-state.json and Stop
   * writes to watermark.json — they never touch each other's file.
   * This is the structural guarantee that prevents the race condition.
   */
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use Redis [session a, turn 1]\n';
    const { wyrenDir, upsStatePath, snapshotPath, memoryPath } = makeWyrenDir(dir, {
      memory,
      upsState: { last_injected_mtime: 1, last_injected_hash: 'stale0000000' },
    });

    // Seed a Stop-owned watermark.json with Stop fields
    const stateDir = path.join(wyrenDir, 'state');
    const watermarkPath = path.join(stateDir, 'watermark.json');
    const stopState = { turns_since_distill: 3, last_turn_at: Date.now(), distiller_running: false };
    fs.writeFileSync(watermarkPath, JSON.stringify(stopState, null, 2), 'utf8');

    // UPS runs and writes its state
    const result = buildInjection({ cwd: dir, wyrenDir, upsStatePath, snapshotPath, memoryPath });
    assert.ok(result !== null);

    // Simulate what main() does: write ups-state.json atomically
    const tmp = `${upsStatePath}.test.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(result.newUpsState, null, 2));
    fs.renameSync(tmp, upsStatePath);

    // Stop's watermark.json must be completely untouched
    const stopWmAfter = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
    assert.equal(stopWmAfter.turns_since_distill, 3,
      'Stop watermark.json turns_since_distill must be untouched by UPS');
    assert.equal(stopWmAfter.distiller_running, false,
      'Stop watermark.json distiller_running must be untouched by UPS');

    // UPS state must have been written correctly
    const upsStateAfter = JSON.parse(fs.readFileSync(upsStatePath, 'utf8'));
    assert.ok(upsStateAfter.last_injected_hash !== 'stale0000000',
      'ups-state.json must have updated hash');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
