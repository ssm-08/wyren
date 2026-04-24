import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  readTranscriptLines,
  sliceSinceUuid,
  lastUuid,
  renderForDistiller,
} from '../lib/transcript.mjs';

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-transcript-'));
}

function writeJSONL(dir, lines) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return p;
}

// ── readTranscriptLines ───────────────────────────────────────────────────────

test('readTranscriptLines: empty file → []', async () => {
  const dir = makeTmp();
  try {
    const p = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(p, '', 'utf8');
    const lines = await readTranscriptLines(p);
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readTranscriptLines: all malformed lines → [] (errors logged to stderr)', async () => {
  const dir = makeTmp();
  try {
    const p = path.join(dir, 'bad.jsonl');
    fs.writeFileSync(p, 'not json\nalso not json\n{broken\n', 'utf8');
    const lines = await readTranscriptLines(p);
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readTranscriptLines: mixed valid/invalid → only valid returned', async () => {
  const dir = makeTmp();
  try {
    const p = path.join(dir, 'mixed.jsonl');
    const good = { type: 'user', uuid: 'abc', message: { content: 'hello' } };
    fs.writeFileSync(p, `not-json\n${JSON.stringify(good)}\nbroken{\n`, 'utf8');
    const lines = await readTranscriptLines(p);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].uuid, 'abc');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readTranscriptLines: blank lines skipped without error', async () => {
  const dir = makeTmp();
  try {
    const p = path.join(dir, 'blanks.jsonl');
    const obj = { type: 'user', uuid: 'u1' };
    fs.writeFileSync(p, `\n${JSON.stringify(obj)}\n\n`, 'utf8');
    const lines = await readTranscriptLines(p);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].uuid, 'u1');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── sliceSinceUuid ────────────────────────────────────────────────────────────

test('sliceSinceUuid: empty watermarkUuid → returns all lines', () => {
  const lines = [{ uuid: 'a' }, { uuid: 'b' }];
  assert.deepEqual(sliceSinceUuid(lines, ''), lines);
  assert.deepEqual(sliceSinceUuid(lines, null), lines);
});

test('sliceSinceUuid: unknown UUID → returns all lines', () => {
  const lines = [{ uuid: 'a' }, { uuid: 'b' }];
  assert.deepEqual(sliceSinceUuid(lines, 'zzz'), lines);
});

test('sliceSinceUuid: UUID at last line → returns []', () => {
  const lines = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }];
  assert.deepEqual(sliceSinceUuid(lines, 'c'), []);
});

test('sliceSinceUuid: UUID in middle → returns lines after it', () => {
  const a = { uuid: 'a', type: 'user' };
  const b = { uuid: 'b', type: 'assistant' };
  const c = { uuid: 'c', type: 'user' };
  assert.deepEqual(sliceSinceUuid([a, b, c], 'b'), [c]);
});

test('sliceSinceUuid: UUID at first line → returns rest', () => {
  const lines = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }];
  assert.deepEqual(sliceSinceUuid(lines, 'a'), [{ uuid: 'b' }, { uuid: 'c' }]);
});

// ── lastUuid ─────────────────────────────────────────────────────────────────

test('lastUuid: empty array → null', () => {
  assert.equal(lastUuid([]), null);
});

test('lastUuid: no uuid fields → null', () => {
  assert.equal(lastUuid([{ type: 'user' }, { type: 'assistant' }]), null);
});

test('lastUuid: returns last uuid in array', () => {
  const lines = [{ uuid: 'first' }, { type: 'assistant' }, { uuid: 'last' }];
  assert.equal(lastUuid(lines), 'last');
});

test('lastUuid: null entries skipped', () => {
  assert.equal(lastUuid([null, { uuid: 'only' }, null]), 'only');
});

// ── renderForDistiller ────────────────────────────────────────────────────────

test('renderForDistiller: empty array → empty string', () => {
  assert.equal(renderForDistiller([]), '');
});

test('renderForDistiller: sidechain-only lines → empty string', () => {
  const lines = [
    { type: 'user', isSidechain: true, message: { content: 'hidden' } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'nope' }] } },
  ];
  assert.equal(renderForDistiller(lines), '');
});

test('renderForDistiller: user text turn rendered with [turn N, user] header', () => {
  const lines = [{ type: 'user', message: { content: 'what is SQLite?' } }];
  const out = renderForDistiller(lines);
  assert.ok(out.includes('[turn 1, user]'), `missing turn header: ${out}`);
  assert.ok(out.includes('what is SQLite?'), `missing content: ${out}`);
});

test('renderForDistiller: assistant tool_use rendered as [tool_use Name]', () => {
  const lines = [{
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        name: 'Edit',
        input: { file_path: 'foo.js', old_string: 'a', new_string: 'b' },
      }],
    },
  }];
  const out = renderForDistiller(lines);
  assert.ok(out.includes('[tool_use Edit]'), `missing tool_use render: ${out}`);
});

test('renderForDistiller: thinking blocks skipped', () => {
  const lines = [{
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'visible answer' },
      ],
    },
  }];
  const out = renderForDistiller(lines);
  assert.ok(!out.includes('internal reasoning'), `thinking should be hidden: ${out}`);
  assert.ok(out.includes('visible answer'), `text should be visible: ${out}`);
});

test('renderForDistiller: user turn with empty content skipped', () => {
  const lines = [
    { type: 'user', message: { content: '' } },
    { type: 'user', message: { content: 'real message' } },
  ];
  const out = renderForDistiller(lines);
  assert.ok(out.includes('[turn 1, user]'), 'first real user turn should be turn 1');
  assert.ok(!out.includes('[turn 2,'), 'only one user turn should appear');
});

test('renderForDistiller: user image block rendered as [image omitted]', () => {
  const lines = [{
    type: 'user',
    message: { content: [{ type: 'image' }] },
  }];
  const out = renderForDistiller(lines);
  assert.ok(out.includes('[image omitted]'), `expected image placeholder: ${out}`);
});

test('renderForDistiller: tool_result rendered with [tool_result] prefix', () => {
  const lines = [{
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        content: 'file content here',
        is_error: false,
      }],
    },
  }];
  const out = renderForDistiller(lines);
  assert.ok(out.includes('[tool_result]'), `expected tool_result prefix: ${out}`);
  assert.ok(out.includes('file content here'), `expected result body: ${out}`);
});

test('renderForDistiller: null lines in array are skipped', () => {
  const lines = [
    null,
    { type: 'user', message: { content: 'hello' } },
    null,
  ];
  assert.doesNotThrow(() => renderForDistiller(lines));
  const out = renderForDistiller(lines);
  assert.ok(out.includes('hello'));
});
