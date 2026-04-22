import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasTier0Signal } from '../lib/filter.mjs';

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
  assert.equal(hasTier0Signal('TODO: add tests'), true);
});

test('hasTier0Signal returns false for neutral transcript', () => {
  assert.equal(hasTier0Signal('reading the file contents'), false);
  assert.equal(hasTier0Signal('here is the function signature'), false);
  assert.equal(hasTier0Signal(''), false);
});

test('hasTier0Signal detects Edit/Write tool use (rendered format)', () => {
  // renderForDistiller produces: [tool_use ToolName] {...}
  assert.equal(hasTier0Signal('[tool_use Edit] {"file_path":"foo.js"}'), true);
  assert.equal(hasTier0Signal('[tool_use Write] {"file_path":"bar.js"}'), true);
});

test('hasTier0Signal returns false for non-Edit/Write tool use', () => {
  assert.equal(hasTier0Signal('[tool_use Read] {"file_path":"foo.js"}'), false);
  assert.equal(hasTier0Signal('[tool_use Bash] {"command":"ls"}'), false);
});
