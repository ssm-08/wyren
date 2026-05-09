import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { wyrenStatus } from '../bin/wyren.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-status-test-'));
}

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

test('wyrenStatus: not initialized → prints init message', () => {
  const dir = makeTmpDir();
  try {
    const lines = captureLog(() => wyrenStatus(dir));
    assert.ok(lines.some(l => l.includes('wyren init')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenStatus: initialized, no git repo → Peer pushed line present', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- x\n', 'utf8');
    const lines = captureLog(() => wyrenStatus(dir));
    const peerLine = lines.find(l => l.startsWith('Peer pushed:'));
    assert.ok(peerLine, `Peer pushed: line must be present. Got:\n${lines.join('\n')}`);
    assert.ok(
      peerLine.includes('no remote') || peerLine.includes('unavailable') || peerLine.includes('never'),
      `got: ${peerLine}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
