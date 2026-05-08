import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Will fail until hooks/session-start.mjs exists
import { buildContext, readBroadcastDir } from '../hooks/session-start.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-test-'));
}

test('buildContext returns empty string when .wyren dir is missing', () => {
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
    fs.mkdirSync(path.join(dir, '.wyren'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    const result = buildContext(dir);
    assert.ok(result.includes('Use SQLite'), `Expected memory content, got: ${result}`);
    assert.ok(result.includes('Wyren Memory'), `Expected "Wyren Memory" header, got: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext returns empty string when memory.md is blank', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '   \n', 'utf8');
    const result = buildContext(dir);
    assert.equal(result, '');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readBroadcastDir returns empty content when dir missing', () => {
  const { content, skillFiles } = readBroadcastDir('/nonexistent/wyren-test-broadcast-dir');
  assert.equal(content, '');
  assert.deepEqual(skillFiles, []);
});

test('readBroadcastDir includes file contents with broadcast header', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'style.md'), '# Style guide\nUse 2-space indent.\n', 'utf8');
    const { content } = readBroadcastDir(dir);
    assert.ok(content.includes('broadcast: style.md'), `Expected broadcast header, got: ${content}`);
    assert.ok(content.includes('Style guide'), `Expected file content, got: ${content}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext includes both memory and broadcast when both exist', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    fs.writeFileSync(path.join(dir, '.wyren', 'broadcast', 'team.md'), '# Team notes\nStandup at 9am.\n', 'utf8');
    const result = buildContext(dir);
    assert.ok(result.includes('Wyren Memory'), `Missing memory header in: ${result}`);
    assert.ok(result.includes('Wyren Broadcast'), `Missing broadcast header in: ${result}`);
    assert.ok(result.includes('Use SQLite'), `Missing memory content in: ${result}`);
    assert.ok(result.includes('Team notes'), `Missing broadcast content in: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext omits broadcast section when broadcast dir is empty', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    // broadcast dir exists but is empty
    const result = buildContext(dir);
    assert.ok(!result.includes('Wyren Broadcast'), `Should not include broadcast section, got: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext includes acknowledgment instruction when skills present', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, '.wyren', 'broadcast', 'skills', 'frontend-style.md'),
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

test('buildContext: broadcast dir with files but no memory.md → returns broadcast only', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast'), { recursive: true });
    // no memory.md
    fs.writeFileSync(
      path.join(dir, '.wyren', 'broadcast', 'team.md'),
      '# Team notes\nReview at 10am.',
      'utf8'
    );
    const result = buildContext(dir);
    assert.ok(result.includes('Wyren Broadcast'), `should have broadcast section: ${result}`);
    assert.ok(!result.includes('Wyren Memory'), `should not have memory section: ${result}`);
    assert.ok(result.includes('Team notes'), `should have broadcast content: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildContext no acknowledgment when broadcast has no skills', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wyren', 'memory.md'), '## Decisions\n- Use SQLite\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, '.wyren', 'broadcast', 'team.md'),
      '# Team notes\nStandup at 9am.',
      'utf8'
    );
    const result = buildContext(dir);
    assert.ok(result.includes('Wyren Broadcast'), `Should have broadcast section in: ${result}`);
    assert.ok(!result.includes('Acknowledge'), `Should NOT have acknowledgment when no skills: ${result}`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readBroadcastDir skips symlinks to avoid leaking files outside broadcast dir', { skip: process.platform === 'win32' }, () => {
  const dir = makeTmpDir();
  try {
    const secret = path.join(dir, 'secret.txt');
    const broadcast = path.join(dir, 'broadcast');
    fs.mkdirSync(broadcast, { recursive: true });
    fs.writeFileSync(secret, 'DO NOT LEAK', 'utf8');
    fs.symlinkSync(secret, path.join(broadcast, 'leak.md'));
    fs.writeFileSync(path.join(broadcast, 'safe.md'), 'safe content', 'utf8');

    const { content } = readBroadcastDir(broadcast);
    assert.ok(content.includes('safe content'), `safe file should be included: ${content}`);
    assert.ok(!content.includes('DO NOT LEAK'), `symlink target content must not be included: ${content}`);
    assert.ok(!content.includes('leak.md'), `symlink entry must not be listed: ${content}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBroadcastDir truncates multi-byte content by UTF-8 byte limit', () => {
  const dir = makeTmpDir();
  try {
    const body = '😀'.repeat(20_000);
    fs.writeFileSync(path.join(dir, 'emoji.md'), body, 'utf8');
    const { content } = readBroadcastDir(dir);
    assert.ok(content.includes('wyren: truncated'), 'large multi-byte file should be truncated');
    assert.ok(Buffer.byteLength(content, 'utf8') < 55_000, 'truncated content should stay near file byte cap');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
