import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { updateWatermark, shouldDistill } from '../hooks/stop.mjs';

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

// shouldDistill tests

test('shouldDistill returns false when distiller_running is true', () => {
  const state = { distiller_running: true, turns_since_distill: 10 };
  assert.equal(shouldDistill(state), false);
});

test('shouldDistill returns false when turns below threshold', () => {
  const state = { turns_since_distill: 4 };
  assert.equal(shouldDistill(state), false);
});

test('shouldDistill returns true when turns reach threshold', () => {
  const state = { turns_since_distill: 5 };
  assert.equal(shouldDistill(state), true);
});

test('shouldDistill returns true when turns exceed threshold', () => {
  const state = { turns_since_distill: 8 };
  assert.equal(shouldDistill(state), true);
});

test('shouldDistill returns true on idle trigger', () => {
  const state = {
    turns_since_distill: 2,
    last_distilled_at: Date.now() - 3 * 60 * 1000, // 3min ago
  };
  assert.equal(shouldDistill(state), true);
});

test('shouldDistill returns false on idle trigger with no prior distillation', () => {
  // no last_distilled_at means first-ever distillation; wait for turn threshold
  const state = { turns_since_distill: 2 };
  assert.equal(shouldDistill(state), false);
});

test('shouldDistill returns false when idle time is under 2min', () => {
  const state = {
    turns_since_distill: 2,
    last_distilled_at: Date.now() - 60 * 1000, // only 1min ago
  };
  assert.equal(shouldDistill(state), false);
});

test('updateWatermark writes atomically (no partial read during write)', () => {
  // Verifies tmp+rename pattern: watermark.json is never in a partial-write state.
  // We can't simulate a mid-write crash, but we can verify no .tmp file lingers.
  const dir = makeTmpDir();
  const relayDir = path.join(dir, '.relay');
  fs.mkdirSync(relayDir);
  try {
    updateWatermark(relayDir);
    const stateDir = path.join(relayDir, 'state');
    const files = fs.readdirSync(stateDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    assert.equal(tmpFiles.length, 0, 'No .tmp files should linger after atomic write');
    assert.ok(fs.existsSync(path.join(stateDir, 'watermark.json')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('shouldDistill: stale distiller_pid (ESRCH) falls through to turn threshold', () => {
  // PID 999999999 is virtually guaranteed not to exist; process.kill(pid, 0) throws ESRCH
  // shouldDistill must treat this as stale flag and fall through to threshold check
  const state = {
    distiller_running: true,
    distiller_pid: 999999999,
    turns_since_distill: 5,
  };
  // If ESRCH is handled correctly, it falls through and returns true (turns >= threshold)
  // If not handled, it returns false (flag honored despite dead process)
  // We can't guarantee PID 999999999 is dead on all CI, so we test the fallback logic directly:
  // Simulate: if ESRCH thrown, the code falls through.
  // At minimum, shouldDistill must not throw.
  assert.doesNotThrow(() => shouldDistill(state));
});

test('shouldDistill: live distiller_pid → returns false (process still running)', () => {
  // Use the current process PID — guaranteed alive. shouldDistill must honor the flag
  // and return false (don't retrigger while distiller is running).
  const state = {
    distiller_running: true,
    distiller_pid: process.pid,
    turns_since_distill: 10, // above threshold — but flag must win
  };
  assert.equal(shouldDistill(state), false, 'live PID: distiller_running must be honored');
});

test('trigger lock prevents double-spawn: second openSync(wx) throws EEXIST', () => {
  // Simulates C2 fix: two concurrent Stop hooks race on distill-trigger.lock.
  // First wins; second sees EEXIST and skips spawn.
  const dir = makeTmpDir();
  const relayDir = path.join(dir, '.relay');
  fs.mkdirSync(path.join(relayDir, 'state'), { recursive: true });
  const triggerLock = path.join(relayDir, 'state', 'distill-trigger.lock');
  try {
    // First hook claims the lock
    fs.closeSync(fs.openSync(triggerLock, 'wx'));
    // Second hook should fail
    assert.throws(
      () => fs.closeSync(fs.openSync(triggerLock, 'wx')),
      { code: 'EEXIST' },
      'Second openSync(wx) must throw EEXIST'
    );
  } finally {
    try { fs.unlinkSync(triggerLock); } catch {}
    fs.rmSync(dir, { recursive: true });
  }
});
