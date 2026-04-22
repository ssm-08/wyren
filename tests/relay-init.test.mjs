import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { relayInit } from '../bin/relay.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
}

test('relayInit creates .relay/memory.md', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    const memPath = path.join(dir, '.relay', 'memory.md');
    assert.ok(fs.existsSync(memPath), '.relay/memory.md should exist');
    const content = fs.readFileSync(memPath, 'utf8');
    assert.ok(content.includes('Relay Memory'), 'memory.md should have Relay Memory heading');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit creates .relay/broadcast/ directory', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    assert.ok(fs.existsSync(path.join(dir, '.relay', 'broadcast')), '.relay/broadcast/ should exist');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit appends .relay/state/ and .relay/log to .gitignore', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
    relayInit(dir);
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.relay/state/'), '.gitignore should include .relay/state/');
    assert.ok(gitignore.includes('.relay/log'), '.gitignore should include .relay/log');
    assert.ok(gitignore.includes('node_modules/'), 'Original .gitignore content preserved');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit creates .gitignore if it does not exist', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    const gitignorePath = path.join(dir, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore should be created');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.relay/state/'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit returns false and is a no-op when already initialized', () => {
  const dir = makeTmpDir();
  try {
    relayInit(dir);
    const result = relayInit(dir);
    assert.equal(result, false, 'Second call should return false');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('relayInit does not duplicate .gitignore entries on repeated calls', () => {
  const dir = makeTmpDir();
  try {
    // Pre-seed .gitignore with relay entries, create .relay/ manually
    fs.writeFileSync(path.join(dir, '.gitignore'), '.relay/state/\n.relay/log\n', 'utf8');
    fs.mkdirSync(path.join(dir, '.relay'));
    relayInit(dir);  // returns false (already initialized), .gitignore untouched
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const stateCount = (gitignore.match(/\.relay\/state\//g) || []).length;
    assert.equal(stateCount, 1, '.relay/state/ should appear exactly once');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
