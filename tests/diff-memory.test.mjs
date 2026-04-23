import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSections, diffMemory, renderDelta, hashMemory } from '../lib/diff-memory.mjs';

const MEM_A = `## Decisions
- Use SQLite not Postgres [session abc1, turn 3]
- Auth via JWT [session abc1, turn 5]

## Rejected paths
- Tried Redis: too heavy [session abc1, turn 4]
`;

const MEM_B = `## Decisions
- Use SQLite not Postgres [session abc1, turn 3]
- Auth via JWT [session abc1, turn 5]
- Add rate limiting [session def2, turn 2]

## Rejected paths
- Tried Redis: too heavy [session abc1, turn 4]

## Live workarounds
- user_id hardcoded to 1 for now [session def2, turn 3]
`;

test('parseSections returns correct section map', () => {
  const sections = parseSections(MEM_A);
  assert.ok(sections.has('Decisions'));
  assert.ok(sections.has('Rejected paths'));
  assert.equal(sections.get('Decisions').size, 2);
  assert.equal(sections.get('Rejected paths').size, 1);
});

test('diffMemory: empty old → all new treated as added', () => {
  const { added, removed } = diffMemory('', MEM_A);
  assert.ok(added.has('Decisions'));
  assert.equal(added.get('Decisions').length, 2);
  assert.equal(removed.size, 0);
});

test('diffMemory: same content → empty diff', () => {
  const { added, removed } = diffMemory(MEM_A, MEM_A);
  assert.equal(added.size, 0);
  assert.equal(removed.size, 0);
});

test('diffMemory: bullet added to Decisions', () => {
  const { added, removed } = diffMemory(MEM_A, MEM_B);
  assert.ok(added.has('Decisions'));
  assert.ok(added.get('Decisions').includes('Add rate limiting [session def2, turn 2]'));
  assert.equal(removed.size, 0);
});

test('diffMemory: bullet removed shows in removed', () => {
  const { added, removed } = diffMemory(MEM_B, MEM_A);
  assert.ok(removed.has('Decisions'));
  assert.ok(removed.get('Decisions').includes('Add rate limiting [session def2, turn 2]'));
});

test('diffMemory: new section introduced → all bullets added', () => {
  const { added } = diffMemory(MEM_A, MEM_B);
  assert.ok(added.has('Live workarounds'));
  assert.equal(added.get('Live workarounds').length, 1);
});

test('diffMemory: bullet reorder within section → empty diff', () => {
  const reordered = `## Decisions
- Auth via JWT [session abc1, turn 5]
- Use SQLite not Postgres [session abc1, turn 3]

## Rejected paths
- Tried Redis: too heavy [session abc1, turn 4]
`;
  const { added, removed } = diffMemory(MEM_A, reordered);
  assert.equal(added.size, 0);
  assert.equal(removed.size, 0);
});

test('renderDelta truncates and marks when over byte cap', () => {
  const oldMem = '';
  // 30 unique bullets each 200 chars (distinct so Set doesn't dedupe them)
  const bullets = Array.from({ length: 30 }, (_, i) => `- decision-${i}: ${'x'.repeat(180)}`);
  const newMem = `## Decisions\n` + bullets.join('\n');
  const { added, removed } = diffMemory(oldMem, newMem);
  const delta = renderDelta({ added, removed }, { maxBytes: 500 });
  assert.ok(delta.includes('truncated'));
  assert.ok(Buffer.byteLength(delta, 'utf8') <= 560); // small overshoot for marker
});

test('hashMemory returns 12-char hex string', () => {
  const h = hashMemory('hello');
  assert.equal(h.length, 12);
  assert.match(h, /^[0-9a-f]+$/);
});

test('hashMemory empty string does not throw', () => {
  assert.doesNotThrow(() => hashMemory(''));
  assert.doesNotThrow(() => hashMemory(null));
});
