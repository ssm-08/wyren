import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildInjection } from '../hooks/user-prompt-submit.mjs';
import { hashMemory } from '../lib/diff-memory.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ups-test-'));
}

function makeRelayDir(base, { memory = null, snapshot = null, watermark = null } = {}) {
  const relayDir = path.join(base, '.relay');
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  if (memory !== null) {
    fs.writeFileSync(path.join(relayDir, 'memory.md'), memory, 'utf8');
  }
  if (snapshot !== null) {
    fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), snapshot, 'utf8');
  }
  if (watermark !== null) {
    fs.writeFileSync(path.join(stateDir, 'watermark.json'), JSON.stringify(watermark), 'utf8');
  }
  return {
    relayDir,
    watermarkPath: path.join(stateDir, 'watermark.json'),
    snapshotPath: path.join(stateDir, 'last-injected-memory.md'),
    memoryPath: path.join(relayDir, 'memory.md'),
  };
}

test('first-run seed: empty watermark → seed mtime+hash, no injection', () => {
  const dir = makeTmpDir();
  try {
    const { relayDir, watermarkPath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: '## Decisions\n- Use SQLite [session a, turn 1]\n',
    });

    const result = buildInjection({ cwd: dir, relayDir, watermarkPath, snapshotPath, memoryPath });

    assert.ok(result !== null, 'result should not be null');
    assert.equal(result.delta, null, 'no injection on first run');
    assert.ok(result.newWatermark.last_injected_hash, 'hash should be seeded');
    assert.ok(result.newWatermark.last_injected_mtime, 'mtime should be seeded');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('unchanged mtime → fast-path, no injection, result null', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, watermarkPath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory,
      snapshot: memory,
    });
    const mtime = fs.statSync(memoryPath).mtimeMs;
    makeRelayDir(dir, { watermark: { last_injected_mtime: mtime, last_injected_hash: 'abc123def456' } });

    const result = buildInjection({ cwd: dir, relayDir, watermarkPath, snapshotPath, memoryPath });
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('mtime changed but hash same → update mtime only, no injection delta', () => {
  const dir = makeTmpDir();
  try {
    const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, watermarkPath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory,
      snapshot: memory,
    });
    const hash = hashMemory(memory);
    // Use a stale mtime so fast-path doesn't skip
    makeRelayDir(dir, { watermark: { last_injected_mtime: 1, last_injected_hash: hash } });

    const result = buildInjection({ cwd: dir, relayDir, watermarkPath, snapshotPath, memoryPath });

    assert.ok(result !== null);
    assert.equal(result.delta, null, 'no delta when hash same');
    assert.ok(result.newWatermark.last_injected_mtime > 1, 'mtime updated');
    assert.equal(result.newSnapshot, null, 'no snapshot rewrite needed');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('real content change → delta returned, watermark+snapshot updated', () => {
  const dir = makeTmpDir();
  try {
    const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n- Add rate limiting [session b, turn 2]\n';
    const { relayDir, watermarkPath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: newMem,
      snapshot: oldMem,
    });
    makeRelayDir(dir, { watermark: { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) } });

    const result = buildInjection({ cwd: dir, relayDir, watermarkPath, snapshotPath, memoryPath });

    assert.ok(result !== null);
    assert.ok(result.delta, 'delta should be non-empty');
    assert.ok(result.delta.includes('Add rate limiting'), 'delta should contain new bullet');
    assert.ok(result.delta.includes('Relay live update'), 'delta has header');
    assert.equal(result.newSnapshot, newMem, 'snapshot updated to new memory');
    assert.equal(result.newWatermark.last_injected_hash, hashMemory(newMem));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('corrupt snapshot → treat as empty, inject full diff', () => {
  const dir = makeTmpDir();
  try {
    const newMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
    const { relayDir, watermarkPath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: newMem,
    });
    // Write corrupt snapshot
    fs.writeFileSync(snapshotPath, Buffer.from([0xff, 0xfe, 0x00]), 'binary');
    makeRelayDir(dir, { watermark: { last_injected_mtime: 1, last_injected_hash: 'stale000aaaa' } });

    const result = buildInjection({ cwd: dir, relayDir, watermarkPath, snapshotPath, memoryPath });

    assert.ok(result !== null, 'should not throw on corrupt snapshot');
    // Delta may be non-null (treated as new content from empty baseline)
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('watermark write preserves unrelated keys', () => {
  const dir = makeTmpDir();
  try {
    const oldMem = '## Decisions\n- old [session a, turn 1]\n';
    const newMem = '## Decisions\n- old [session a, turn 1]\n- new [session b, turn 2]\n';
    const { relayDir, watermarkPath, snapshotPath, memoryPath } = makeRelayDir(dir, {
      memory: newMem,
      snapshot: oldMem,
    });
    makeRelayDir(dir, {
      watermark: {
        last_injected_mtime: 1,
        last_injected_hash: hashMemory(oldMem),
        turns_since_distill: 3,
        distiller_running: false,
        last_uuid: 'uuid-abc123',
      },
    });

    const result = buildInjection({ cwd: dir, relayDir, watermarkPath, snapshotPath, memoryPath });

    assert.ok(result !== null);
    assert.equal(result.newWatermark.turns_since_distill, 3, 'turns_since_distill preserved');
    assert.equal(result.newWatermark.distiller_running, false, 'distiller_running preserved');
    assert.equal(result.newWatermark.last_uuid, 'uuid-abc123', 'last_uuid preserved');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
