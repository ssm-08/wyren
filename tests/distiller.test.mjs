import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasTier0Signal, scoreTier0 } from '../lib/filter.mjs';

test('hasTier0Signal detects decision keywords', () => {
  assert.equal(hasTier0Signal('we decided to use SQLite'), true);
  assert.equal(hasTier0Signal("that approach won't work"), true);
  assert.equal(hasTier0Signal('rejected postgres'), true);
  assert.equal(hasTier0Signal('workaround for the auth bug'), true);
  assert.equal(hasTier0Signal('out of scope for now'), true);
  assert.equal(hasTier0Signal('FIXME: remove hardcoded user id'), true);
});

test('hasTier0Signal is case-insensitive', () => {
  assert.equal(hasTier0Signal('DECIDED on postgres'), true);
  assert.equal(hasTier0Signal('Workaround applied'), true);
  // bare TODO alone scores 2 (below threshold 3) — needs a second signal to trigger
  assert.equal(hasTier0Signal('TODO: add tests'), false);
  assert.equal(hasTier0Signal('TODO: add tests — workaround for now'), true);
});

test('hasTier0Signal returns false for neutral transcript', () => {
  assert.equal(hasTier0Signal('reading the file contents'), false);
  assert.equal(hasTier0Signal('here is the function signature'), false);
  assert.equal(hasTier0Signal(''), false);
  // weak signal words alone do not trigger
  assert.equal(hasTier0Signal('actually'), false);
  assert.equal(hasTier0Signal('for now'), false);
});

test('hasTier0Signal detects Edit/Write tool use (rendered format)', () => {
  // renderForDistiller produces: [tool_use ToolName] {...}
  assert.equal(hasTier0Signal('[tool_use Edit] {"file_path":"foo.js"}'), true);
  assert.equal(hasTier0Signal('[tool_use Write] {"file_path":"bar.js"}'), true);
  assert.equal(hasTier0Signal('[tool_use MultiEdit] {"file_path":"bar.js"}'), true);
});

test('hasTier0Signal returns false for non-Edit/Write tool use', () => {
  assert.equal(hasTier0Signal('[tool_use Read] {"file_path":"foo.js"}'), false);
  assert.equal(hasTier0Signal('[tool_use Bash] {"command":"ls"}'), false);
});

test('scoreTier0 returns score and breakdown', () => {
  const { score, passes, breakdown } = scoreTier0('we decided to use SQLite');
  assert.ok(score >= 3, `expected score >= 3, got ${score}`);
  assert.equal(passes, true);
  assert.ok(Array.isArray(breakdown));
  assert.ok(breakdown.length > 0);
});

test('scoreTier0 structural scoring on lines', () => {
  // 20 turns with long user messages should add structural score
  const lines = Array.from({ length: 20 }, (_, i) => ({
    type: i % 2 === 0 ? 'user' : 'assistant',
    message: { content: 'x'.repeat(300) },
  }));
  const { score } = scoreTier0('', lines);
  assert.ok(score >= 4, `expected structural score >= 4, got ${score}`);
});

test('scoreTier0 caps per-category contribution', () => {
  // Repeating "actually" 100 times should not dominate score
  const text = 'actually '.repeat(100);
  const { score } = scoreTier0(text);
  // Weight 1, cap = weight*3 = 3; structural = 0; edit = 0
  assert.equal(score, 3);
});

test('scoreTier0: non-string input → score 0, passes false', () => {
  assert.deepEqual(scoreTier0(null), { score: 0, passes: false, breakdown: [] });
  assert.deepEqual(scoreTier0(undefined), { score: 0, passes: false, breakdown: [] });
  assert.deepEqual(scoreTier0(42), { score: 0, passes: false, breakdown: [] });
});

test('scoreTier0: edit cap — 5 Edit matches capped at EDIT_WEIGHT*4=12', () => {
  const text = '[tool_use Edit] a\n[tool_use Edit] b\n[tool_use Edit] c\n[tool_use Edit] d\n[tool_use Edit] e';
  const { score, breakdown } = scoreTier0(text);
  const editEntry = breakdown.find((b) => b.pattern === 'tool_use Edit/Write/MultiEdit');
  assert.ok(editEntry, 'should have edit breakdown entry');
  assert.equal(editEntry.contribution, 12, 'edit contribution capped at 12');
  assert.ok(score >= 12, `total score should be >= 12, got ${score}`);
});

test('scoreTier0: structural score alone can reach threshold with 20-turn session', () => {
  // 20 turns with long user messages: score += 2 (>=10 turns) + 2 (>=20 turns) + 2 (avg > 200)
  // That's structural=6 which exceeds threshold=3
  const lines = Array.from({ length: 20 }, (_, i) => ({
    type: i % 2 === 0 ? 'user' : 'assistant',
    message: { content: 'x'.repeat(300) },
  }));
  const { score, passes } = scoreTier0('', lines);
  assert.ok(score >= 6, `expected structural score >= 6, got ${score}`);
  assert.equal(passes, true, 'structural score alone should pass threshold');
});
