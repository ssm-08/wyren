import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { wyrenInit } from '../bin/wyren.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-test-'));
}

test('wyrenInit creates .wyren/memory.md', () => {
  const dir = makeTmpDir();
  try {
    wyrenInit(dir);
    const memPath = path.join(dir, '.wyren', 'memory.md');
    assert.ok(fs.existsSync(memPath), '.wyren/memory.md should exist');
    const content = fs.readFileSync(memPath, 'utf8');
    assert.ok(content.includes('Wyren Memory'), 'memory.md should have Wyren Memory heading');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit creates .wyren/broadcast/ directory', () => {
  const dir = makeTmpDir();
  try {
    wyrenInit(dir);
    assert.ok(fs.existsSync(path.join(dir, '.wyren', 'broadcast')), '.wyren/broadcast/ should exist');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit appends .wyren/state/ and .wyren/log to .gitignore', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
    wyrenInit(dir);
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.wyren/state/'), '.gitignore should include .wyren/state/');
    assert.ok(gitignore.includes('.wyren/log'), '.gitignore should include .wyren/log');
    assert.ok(gitignore.includes('node_modules/'), 'Original .gitignore content preserved');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit creates .gitignore if it does not exist', () => {
  const dir = makeTmpDir();
  try {
    wyrenInit(dir);
    const gitignorePath = path.join(dir, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore should be created');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.wyren/state/'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit returns false and is a no-op when already initialized', () => {
  const dir = makeTmpDir();
  try {
    wyrenInit(dir);
    const result = wyrenInit(dir);
    assert.equal(result, false, 'Second call should return false');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit seeds memory.md from CLAUDE.md when present', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nKey decision: use ESM.\n', 'utf8');
    wyrenInit(dir);
    const content = fs.readFileSync(path.join(dir, '.wyren', 'memory.md'), 'utf8');
    assert.ok(content.includes('Seeded from CLAUDE.md'), 'memory.md should have seeded section');
    assert.ok(content.includes('Key decision: use ESM.'), 'memory.md should contain CLAUDE.md content');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit truncates CLAUDE.md seed at 8000 chars', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'x'.repeat(9000), 'utf8');
    wyrenInit(dir);
    const content = fs.readFileSync(path.join(dir, '.wyren', 'memory.md'), 'utf8');
    assert.ok(content.includes('<!-- truncated -->'), 'long CLAUDE.md should be truncated');
    assert.ok(content.length < 9500, 'memory.md should not contain full 9000-char content');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenInit does not duplicate .gitignore entries on repeated calls', () => {
  const dir = makeTmpDir();
  try {
    // Pre-seed .gitignore with wyren entries, create .wyren/ manually
    fs.writeFileSync(path.join(dir, '.gitignore'), '.wyren/state/\n.wyren/log\n', 'utf8');
    fs.mkdirSync(path.join(dir, '.wyren'));
    wyrenInit(dir);  // returns false (already initialized), .gitignore untouched
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const stateCount = (gitignore.match(/\.wyren\/state\//g) || []).length;
    assert.equal(stateCount, 1, '.wyren/state/ should appear exactly once');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
