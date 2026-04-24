import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  resolveHome,
  relayPaths,
  patchSettingsInMemory,
  readSettings,
  createLink,
  inspectLink,
  removeLink,
  validateRelayCheckout,
} from '../scripts/installer.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-installer-test-'));
}

// ---------------------------------------------------------------------------
// resolveHome
// ---------------------------------------------------------------------------

test('resolveHome uses RELAY_HOME when set', () => {
  assert.equal(resolveHome({ RELAY_HOME: '/test/relay' }), '/test/relay');
});

test('resolveHome uses CLAUDE_HOME when RELAY_HOME absent', () => {
  assert.equal(resolveHome({ CLAUDE_HOME: '/test/claude' }), '/test/claude');
});

test('resolveHome falls back to os.homedir()/.claude', () => {
  const result = resolveHome({});
  const expected = path.join(os.homedir(), '.claude');
  assert.equal(result, expected);
});

// ---------------------------------------------------------------------------
// relayPaths
// ---------------------------------------------------------------------------

test('relayPaths returns expected sub-paths', () => {
  const p = relayPaths('/home/test/.claude');
  assert.equal(p.clone, path.join('/home/test/.claude', 'relay'));
  assert.equal(p.plugin, path.join('/home/test/.claude', 'plugins', 'relay'));
  assert.equal(p.settings, path.join('/home/test/.claude', 'settings.json'));
});

// ---------------------------------------------------------------------------
// readSettings
// ---------------------------------------------------------------------------

test('readSettings returns {} when file missing', () => {
  const result = readSettings('/nonexistent/path/settings.json');
  assert.deepEqual(result, {});
});

test('readSettings parses strict JSON', () => {
  const dir = makeTmpDir();
  try {
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, JSON.stringify({ theme: 'dark' }), 'utf8');
    const result = readSettings(p);
    assert.equal(result.theme, 'dark');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readSettings parses JSONC with line comments', () => {
  const dir = makeTmpDir();
  try {
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, '{\n  // a comment\n  "theme": "dark"\n}\n', 'utf8');
    const result = readSettings(p);
    assert.equal(result.theme, 'dark');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readSettings parses JSONC with trailing comma', () => {
  const dir = makeTmpDir();
  try {
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, '{\n  "theme": "dark",\n}\n', 'utf8');
    const result = readSettings(p);
    assert.equal(result.theme, 'dark');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readSettings parses JSONC with block comments', () => {
  const dir = makeTmpDir();
  try {
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, '{\n  /* block comment */\n  "theme": "dark"\n}\n', 'utf8');
    const result = readSettings(p);
    assert.equal(result.theme, 'dark');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readSettings does not strip // inside string values (URL safety)', () => {
  const dir = makeTmpDir();
  try {
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, '{\n  "url": "https://example.com/path"\n}\n', 'utf8');
    const result = readSettings(p);
    assert.equal(result.url, 'https://example.com/path');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('readSettings throws on unparseable content', () => {
  const dir = makeTmpDir();
  try {
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, 'not { json } at all !!', 'utf8');
    assert.throws(() => readSettings(p), /Failed to parse/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// patchSettingsInMemory — install mode
// ---------------------------------------------------------------------------

const FAKE_REPO = path.join('/fake', 'relay');

test('patchSettingsInMemory install: creates hooks when absent', () => {
  const result = patchSettingsInMemory({}, { mode: 'install', repoDir: FAKE_REPO });
  assert.ok(Array.isArray(result.hooks.SessionStart));
  assert.ok(Array.isArray(result.hooks.Stop));
  assert.equal(result.hooks.SessionStart.length, 1);
  assert.equal(result.hooks.Stop.length, 1);
});

test('patchSettingsInMemory install: hook command uses absolute repoDir path', () => {
  const result = patchSettingsInMemory({}, { mode: 'install', repoDir: FAKE_REPO });
  const cmd = result.hooks.SessionStart[0].hooks[0].command;
  assert.ok(cmd.includes('run-hook.cmd'), `Command: ${cmd}`);
  assert.ok(cmd.includes(FAKE_REPO), `Command must contain repoDir: ${cmd}`);
  assert.ok(!cmd.includes('${CLAUDE_PLUGIN_ROOT}'), `Must not use CLAUDE_PLUGIN_ROOT: ${cmd}`);
});

test('patchSettingsInMemory install: preserves foreign SessionStart entries', () => {
  const foreign = { matcher: 'src/**', hooks: [{ type: 'command', command: 'echo hi' }] };
  const settings = { hooks: { SessionStart: [foreign] } };
  const result = patchSettingsInMemory(settings, { mode: 'install', repoDir: FAKE_REPO });
  const entries = result.hooks.SessionStart;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].hooks[0].command, 'echo hi');
});

test('patchSettingsInMemory install: replaces stale relay entry, no duplicate', () => {
  const stale = { matcher: '', hooks: [{ type: 'command', command: '"C:\\old\\path\\run-hook.cmd" session-start' }] };
  const settings = { hooks: { SessionStart: [stale] } };
  const result = patchSettingsInMemory(settings, { mode: 'install', repoDir: FAKE_REPO });
  const relayEntries = result.hooks.SessionStart.filter((e) =>
    e.hooks && e.hooks[0] && e.hooks[0].command.includes('run-hook.cmd')
  );
  assert.equal(relayEntries.length, 1, 'Exactly one relay entry after replace');
  assert.ok(relayEntries[0].hooks[0].command.includes(FAKE_REPO), 'Uses new repoDir path');
});

test('patchSettingsInMemory install: handles Stop as single object (not array)', () => {
  const stopEntry = { matcher: '', hooks: [{ type: 'command', command: 'echo stop' }] };
  const settings = { hooks: { Stop: stopEntry } };
  const result = patchSettingsInMemory(settings, { mode: 'install', repoDir: FAKE_REPO });
  assert.ok(Array.isArray(result.hooks.Stop));
  // should have the foreign entry + new relay entry
  assert.equal(result.hooks.Stop.length, 2);
});

test('patchSettingsInMemory install: preserves _comment key', () => {
  const settings = { _comment: 'my settings', hooks: {} };
  const result = patchSettingsInMemory(settings, { mode: 'install', repoDir: FAKE_REPO });
  assert.equal(result._comment, 'my settings');
});

// ---------------------------------------------------------------------------
// patchSettingsInMemory — uninstall mode
// ---------------------------------------------------------------------------

test('patchSettingsInMemory uninstall: removes relay entries', () => {
  const relayEntry = { matcher: '', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }] };
  const settings = { hooks: { SessionStart: [relayEntry] } };
  const result = patchSettingsInMemory(settings, { mode: 'uninstall' });
  assert.equal(result.hooks, undefined, 'hooks should be removed when empty');
});

test('patchSettingsInMemory uninstall: preserves foreign entries', () => {
  const foreign = { matcher: 'src/**', hooks: [{ type: 'command', command: 'echo hi' }] };
  const relayEntry = { matcher: '', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }] };
  const settings = { hooks: { SessionStart: [foreign, relayEntry] } };
  const result = patchSettingsInMemory(settings, { mode: 'uninstall' });
  assert.ok(Array.isArray(result.hooks.SessionStart));
  assert.equal(result.hooks.SessionStart.length, 1);
  assert.equal(result.hooks.SessionStart[0].hooks[0].command, 'echo hi');
});

test('patchSettingsInMemory uninstall: removes hooks key when fully empty', () => {
  const relaySession = { matcher: '', hooks: [{ type: 'command', command: 'plugins/relay/hooks/run-hook.cmd session-start' }] };
  const relayStop = { matcher: '', hooks: [{ type: 'command', command: 'plugins/relay/hooks/run-hook.cmd stop' }] };
  const settings = { hooks: { SessionStart: [relaySession], Stop: [relayStop] } };
  const result = patchSettingsInMemory(settings, { mode: 'uninstall' });
  assert.equal(result.hooks, undefined, 'hooks key should be removed');
});

// ---------------------------------------------------------------------------
// createLink / inspectLink / removeLink
// ---------------------------------------------------------------------------

test('inspectLink returns missing for nonexistent path', () => {
  const result = inspectLink('/nonexistent/path/to/nothing');
  assert.equal(result.kind, 'missing');
});

test('createLink creates a symlink on POSIX and inspectLink detects it', () => {
  if (process.platform === 'win32') return; // skip on Windows, covered by junction test
  const dir = makeTmpDir();
  try {
    const src = path.join(dir, 'source');
    const dst = path.join(dir, 'links', 'relay');
    fs.mkdirSync(src);

    createLink(src, dst);

    const info = inspectLink(dst);
    assert.equal(info.kind, 'symlink');
    const normalSrc = src.replace(/\\/g, '/');
    const normalTarget = (info.target || '').replace(/\\/g, '/');
    assert.equal(normalTarget, normalSrc);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('createLink is idempotent — no-op when target matches', () => {
  if (process.platform === 'win32') return;
  const dir = makeTmpDir();
  try {
    const src = path.join(dir, 'source');
    const dst = path.join(dir, 'relay');
    fs.mkdirSync(src);

    createLink(src, dst);
    createLink(src, dst); // must not throw
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('createLink throws when dst exists and points elsewhere', () => {
  if (process.platform === 'win32') return;
  const dir = makeTmpDir();
  try {
    const src1 = path.join(dir, 'source1');
    const src2 = path.join(dir, 'source2');
    const dst = path.join(dir, 'relay');
    fs.mkdirSync(src1);
    fs.mkdirSync(src2);

    createLink(src1, dst);
    assert.throws(() => createLink(src2, dst), /exists and points/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('removeLink removes an existing symlink', () => {
  if (process.platform === 'win32') return;
  const dir = makeTmpDir();
  try {
    const src = path.join(dir, 'source');
    const dst = path.join(dir, 'relay');
    fs.mkdirSync(src);

    createLink(src, dst);
    assert.equal(inspectLink(dst).kind, 'symlink');
    removeLink(dst);
    assert.equal(inspectLink(dst).kind, 'missing');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('removeLink is a no-op when path missing', () => {
  const dir = makeTmpDir();
  try {
    assert.doesNotThrow(() => removeLink(path.join(dir, 'nonexistent')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('createLink creates a junction on Windows and inspectLink detects it', () => {
  if (process.platform !== 'win32') return; // Windows-only
  const dir = makeTmpDir();
  try {
    const src = path.join(dir, 'source');
    const dst = path.join(dir, 'links', 'relay');
    fs.mkdirSync(src);

    createLink(src, dst);

    const info = inspectLink(dst);
    assert.ok(info.kind === 'junction' || info.kind === 'symlink', `Expected junction, got: ${info.kind}`);
    const normalSrc = src.replace(/\\/g, '/').toLowerCase();
    const normalTarget = (info.target || '').replace(/\\/g, '/').replace(/^\\\\\?\\/, '').toLowerCase();
    assert.ok(normalTarget.includes(normalSrc.split('/').pop()), `Target ${normalTarget} should include ${normalSrc}`);
  } finally {
    try { fs.rmdirSync(path.join(dir, 'links', 'relay')); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createLink is idempotent on Windows (junction)', () => {
  if (process.platform !== 'win32') return; // Windows-only
  const dir = makeTmpDir();
  try {
    const src = path.join(dir, 'source');
    const dst = path.join(dir, 'relay');
    fs.mkdirSync(src);

    createLink(src, dst);
    assert.doesNotThrow(() => createLink(src, dst), 'Second createLink should not throw');
  } finally {
    try { fs.rmdirSync(path.join(dir, 'relay')); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('removeLink removes a Windows junction', () => {
  if (process.platform !== 'win32') return; // Windows-only
  const dir = makeTmpDir();
  try {
    const src = path.join(dir, 'source');
    const dst = path.join(dir, 'relay');
    fs.mkdirSync(src);

    createLink(src, dst);
    const before = inspectLink(dst);
    assert.ok(before.kind === 'junction' || before.kind === 'symlink', `Expected junction before remove`);
    removeLink(dst);
    assert.equal(inspectLink(dst).kind, 'missing');
  } finally {
    try { fs.rmdirSync(path.join(dir, 'relay')); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// validateRelayCheckout
// ---------------------------------------------------------------------------

test('validateRelayCheckout throws when markers missing', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => validateRelayCheckout(dir), /Not a valid Relay checkout/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('validateRelayCheckout passes when all markers present', () => {
  const dir = makeTmpDir();
  try {
    // Create marker files
    for (const m of ['bin/relay.mjs', 'hooks/run-hook.cmd', '.claude-plugin/plugin.json']) {
      const full = path.join(dir, m);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '', 'utf8');
    }
    assert.doesNotThrow(() => validateRelayCheckout(dir));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
