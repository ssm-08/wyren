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
