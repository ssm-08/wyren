import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { wyrenBroadcastSkill } from '../bin/wyren.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-test-'));
}

test('wyrenBroadcastSkill returns null when wyren not initialized', () => {
  const dir = makeTmpDir();
  try {
    const result = wyrenBroadcastSkill(dir, '/some/skill.md');
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenBroadcastSkill returns null when source file not found', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren'), { recursive: true });
    const result = wyrenBroadcastSkill(dir, path.join(dir, 'nonexistent.md'));
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});


test('wyrenBroadcastSkill returns null when source path is a directory', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren'), { recursive: true });
    const srcDir = path.join(dir, 'not-a-file.md');
    fs.mkdirSync(srcDir);

    const result = wyrenBroadcastSkill(dir, srcDir);

    assert.equal(result, null);
    assert.equal(
      fs.existsSync(path.join(dir, '.wyren', 'broadcast', 'skills', 'not-a-file.md')),
      false,
      'directory source should not create a destination entry'
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenBroadcastSkill returns null when filePath missing', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren'), { recursive: true });
    const result = wyrenBroadcastSkill(dir, undefined);
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenBroadcastSkill copies file to .wyren/broadcast/skills/<basename>', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast'), { recursive: true });
    const srcPath = path.join(dir, 'my-style.md');
    fs.writeFileSync(srcPath, '# Style\nUse 2-space indent.', 'utf8');

    const result = wyrenBroadcastSkill(dir, srcPath);

    const expected = path.join(dir, '.wyren', 'broadcast', 'skills', 'my-style.md');
    assert.equal(result, expected);
    assert.ok(fs.existsSync(expected), 'Skill file should exist at destination');
    const content = fs.readFileSync(expected, 'utf8');
    const srcContent = fs.readFileSync(srcPath, 'utf8');
    assert.equal(content, srcContent, 'Copied file must be byte-for-byte identical to source');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenBroadcastSkill creates skills dir if it does not exist', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren'), { recursive: true });
    const srcPath = path.join(dir, 'skill.md');
    fs.writeFileSync(srcPath, '# Skill', 'utf8');

    wyrenBroadcastSkill(dir, srcPath);

    assert.ok(
      fs.existsSync(path.join(dir, '.wyren', 'broadcast', 'skills', 'skill.md')),
      'skills dir and file should be created'
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('wyrenBroadcastSkill overwrites existing skill with same name', () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.wyren', 'broadcast', 'skills'), { recursive: true });
    const destPath = path.join(dir, '.wyren', 'broadcast', 'skills', 'style.md');
    fs.writeFileSync(destPath, '# Old content', 'utf8');

    const srcPath = path.join(dir, 'style.md');
    fs.writeFileSync(srcPath, '# New content', 'utf8');

    wyrenBroadcastSkill(dir, srcPath);

    const content = fs.readFileSync(destPath, 'utf8');
    assert.equal(content, '# New content', 'Should overwrite with exact new content');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
