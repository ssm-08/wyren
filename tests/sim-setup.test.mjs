import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const WYREN_ROOT = path.resolve(path.dirname(__filename), '..');
const SIM_SETUP = path.join(WYREN_ROOT, 'sim', 'setup.mjs');
const SIM_TEARDOWN = path.join(WYREN_ROOT, 'sim', 'teardown.mjs');

function freshBase(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wyren-sim-test-${label}-`));
}

function runNode(scriptPath, args, opts = {}) {
  const { cwd, ...rest } = opts;
  return spawnSync('node', [scriptPath, ...args], {
    cwd: cwd ?? WYREN_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    ...rest,
  });
}

function git(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Test 1: setup creates bare.git, workspace-a, workspace-b
// ---------------------------------------------------------------------------

test('setup creates bare.git, workspace-a, workspace-b', () => {
  const base = freshBase('dirs');
  try {
    const r = runNode(SIM_SETUP, ['--base', base]);
    assert.equal(r.status, 0, `setup.mjs failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(base, 'bare.git')), 'bare.git must exist');
    assert.ok(fs.existsSync(path.join(base, 'bare.git', 'HEAD')), 'bare.git/HEAD must exist');
    assert.ok(fs.existsSync(path.join(base, 'workspace-a')), 'workspace-a must exist');
    assert.ok(fs.existsSync(path.join(base, 'workspace-a', '.git')), 'workspace-a/.git must exist');
    assert.ok(fs.existsSync(path.join(base, 'workspace-b')), 'workspace-b must exist');
    assert.ok(fs.existsSync(path.join(base, 'workspace-b', '.git')), 'workspace-b/.git must exist');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: setup creates .wyren/memory.md in both workspaces
// ---------------------------------------------------------------------------

test('setup creates .wyren/memory.md in both workspaces', () => {
  const base = freshBase('memory');
  try {
    const r = runNode(SIM_SETUP, ['--base', base]);
    assert.equal(r.status, 0, `setup.mjs failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(
      fs.existsSync(path.join(base, 'workspace-a', '.wyren', 'memory.md')),
      'workspace-a/.wyren/memory.md must exist',
    );
    assert.ok(
      fs.existsSync(path.join(base, 'workspace-b', '.wyren', 'memory.md')),
      'workspace-b/.wyren/memory.md must exist',
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: setup creates .simbase file containing the base path
// ---------------------------------------------------------------------------

test('setup creates .simbase file with base path', () => {
  const base = freshBase('simbase');
  try {
    const r = runNode(SIM_SETUP, ['--base', base]);
    assert.equal(r.status, 0, `setup.mjs failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const simbasePath = path.join(base, '.simbase');
    assert.ok(fs.existsSync(simbasePath), '.simbase must exist');
    const content = fs.readFileSync(simbasePath, 'utf8').trim();
    // Resolve both sides to handle symlinks (macOS /var → /private/var, etc.)
    assert.equal(
      path.resolve(content),
      path.resolve(base),
      `.simbase must contain the base path. Got: "${content}"`,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: workspace-a and workspace-b share the same remote origin
// ---------------------------------------------------------------------------

test('workspace-a and workspace-b share the same remote origin', () => {
  const base = freshBase('origin');
  try {
    const r = runNode(SIM_SETUP, ['--base', base]);
    assert.equal(r.status, 0, `setup.mjs failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

    const wA = path.join(base, 'workspace-a');
    const wB = path.join(base, 'workspace-b');

    const originA = git(['config', '--get', 'remote.origin.url'], wA).stdout.trim();
    const originB = git(['config', '--get', 'remote.origin.url'], wB).stdout.trim();

    assert.ok(originA, 'workspace-a must have a remote.origin.url');
    assert.ok(originB, 'workspace-b must have a remote.origin.url');
    assert.equal(originA, originB, 'Both workspaces must share the same remote origin');
    assert.ok(originA.includes('bare.git'), `Origin must point at bare.git. Got: "${originA}"`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: teardown --yes removes base dir
// ---------------------------------------------------------------------------

test('teardown --yes removes base dir', () => {
  const base = freshBase('teardown');
  try {
    const setupR = runNode(SIM_SETUP, ['--base', base]);
    assert.equal(setupR.status, 0, `setup.mjs failed (exit ${setupR.status}):\nstdout: ${setupR.stdout}\nstderr: ${setupR.stderr}`);
    assert.ok(fs.existsSync(base), 'base must exist before teardown');

    const tearR = runNode(SIM_TEARDOWN, ['--base', base, '--yes']);
    assert.equal(tearR.status, 0, `teardown.mjs failed (exit ${tearR.status}):\nstdout: ${tearR.stdout}\nstderr: ${tearR.stderr}`);
    assert.ok(!fs.existsSync(base), 'base dir must not exist after teardown --yes');
  } finally {
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: teardown with missing base dir exits 0
// ---------------------------------------------------------------------------

test('teardown with missing base dir exits 0', () => {
  const nonexistent = path.join(os.tmpdir(), 'nonexistent-wyren-sim-xyz-99999');
  // ensure it really doesn't exist
  if (fs.existsSync(nonexistent)) fs.rmSync(nonexistent, { recursive: true, force: true });

  const r = runNode(SIM_TEARDOWN, ['--base', nonexistent, '--yes']);
  assert.equal(r.status, 0, `teardown must exit 0 for missing dir. stderr: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// Test 7: setup --base uses provided directory (dirs created inside it, not nested)
// ---------------------------------------------------------------------------

test('setup --base uses provided directory', () => {
  const base = freshBase('custom');
  try {
    const r = runNode(SIM_SETUP, ['--base', base]);
    assert.equal(r.status, 0, `setup.mjs failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    // All three dirs must be direct children of base
    assert.ok(fs.existsSync(path.join(base, 'bare.git')), 'bare.git must be a direct child of --base dir');
    assert.ok(fs.existsSync(path.join(base, 'workspace-a')), 'workspace-a must be a direct child of --base dir');
    assert.ok(fs.existsSync(path.join(base, 'workspace-b')), 'workspace-b must be a direct child of --base dir');
    // Should NOT create a nested tmpdir inside base
    const entries = fs.readdirSync(base).filter(e => e.startsWith('wyren-sim-'));
    assert.equal(entries.length, 0, `setup.mjs must not create a nested tmpdir inside --base. Found: ${entries}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8: setup aborts when wyren repo is NOT on feature/two-session-sim branch
// ---------------------------------------------------------------------------

test('setup aborts when not on feature/two-session-sim branch', () => {
  // Clone the wyren repo into a temp dir, check out master, then run setup.mjs.
  // Expected: non-zero exit with a message mentioning "branch" or "feature/two-session-sim".
  //
  // Skip conditions:
  //   1. git clone of a local path fails (sandbox restriction)
  //   2. sim/setup.mjs does not exist on master (feature not yet merged — test is forward-looking)

  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-sim-test-masterguard-'));
  const cloneDir = path.join(parentDir, 'clone');
  const subBase = path.join(parentDir, 'sub');

  try {
    // 1. Clone the wyren repo
    const cloneR = git(['clone', WYREN_ROOT, cloneDir], os.tmpdir());
    if (cloneR.status !== 0) {
      // Sandbox restricts local clone — skip gracefully
      return;
    }

    // 2. Checkout master in the clone
    const coR = git(['checkout', 'master'], cloneDir);
    if (coR.status !== 0) {
      // master might not exist or checkout fails — skip
      return;
    }

    // 3. sim/setup.mjs might not exist on master (feature not merged yet)
    const setupInClone = path.join(cloneDir, 'sim', 'setup.mjs');
    if (!fs.existsSync(setupInClone)) {
      // Feature branch not merged to master — this test will pass once merged and
      // Agent A adds the branch guard to setup.mjs. Skip for now.
      return;
    }

    // 4. Run setup.mjs from the master clone
    fs.mkdirSync(subBase, { recursive: true });
    const r = runNode(setupInClone, ['--base', subBase], { cwd: cloneDir });

    assert.notEqual(
      r.status,
      0,
      `setup.mjs must abort on master branch. stdout: ${r.stdout} stderr: ${r.stderr}`,
    );
    const combined = (r.stdout ?? '') + (r.stderr ?? '');
    assert.ok(
      combined.includes('branch') || combined.includes('feature/two-session-sim'),
      `Abort message must mention "branch" or "feature/two-session-sim". Got: ${combined}`,
    );
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});
