import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { GitSync } from '../lib/sync.mjs';

// Create a local bare repo (remote) + a local repo with .relay/ initialized
function makeGitFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sync-'));
  const bare = path.join(tmp, 'remote.git');
  const local = path.join(tmp, 'repo');

  const g = (args, cwd) =>
    execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  // Bare remote
  g(`init --bare ${bare}`);

  // Local repo
  fs.mkdirSync(local, { recursive: true });
  g(`init ${local}`);
  g('config user.email test@relay', local);
  g('config user.name "Relay Test"', local);
  g(`remote add origin ${bare}`, local);

  // Seed .relay/
  const relayDir = path.join(local, '.relay');
  fs.mkdirSync(path.join(relayDir, 'broadcast'), { recursive: true });
  fs.mkdirSync(path.join(relayDir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'memory.md'), '# Relay Memory\n');
  fs.writeFileSync(path.join(relayDir, 'broadcast', '.gitkeep'), '');

  g('add .relay/', local);
  g('commit -m "init"', local);
  g('push origin HEAD', local);

  // Set upstream tracking
  let branch;
  try {
    branch = g('rev-parse --abbrev-ref HEAD', local).trim();
    try { g(`branch --set-upstream-to=origin/${branch} ${branch}`, local); } catch {}
  } catch {
    branch = 'master';
  }

  return { tmp, bare, local, branch };
}

// Clone bare into a second local repo (simulates second machine)
function cloneFixture(bare, tmp) {
  const clone = path.join(tmp, `clone-${Date.now()}`);
  const g = (args, cwd) =>
    execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  g(`clone ${bare} ${clone}`);
  g('config user.email clone@relay', clone);
  g('config user.name "Relay Clone"', clone);
  return clone;
}

test('pull() does not throw when no remote is configured', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-norepo-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const relayDir = path.join(tmp, '.relay');
  fs.mkdirSync(path.join(relayDir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'memory.md'), '# old\n');

  // Init git but no remote
  execSync(`git init ${tmp}`, { stdio: 'ignore' });

  const sync = new GitSync();
  assert.doesNotThrow(() => sync.pull(tmp));

  // Memory unchanged (fetch failed, fail-open)
  assert.equal(fs.readFileSync(path.join(relayDir, 'memory.md'), 'utf8'), '# old\n');
});

test('pull() updates memory.md from remote', (t) => {
  const { tmp, local } = makeGitFixture();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // Push a new memory.md from the bare side via a clone
  const clone = cloneFixture(path.join(tmp, 'remote.git'), tmp);
  const g = (args, cwd) =>
    execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(clone, '.relay', 'memory.md'), '# Updated Remote Memory\n');
  g('add .relay/memory.md', clone);
  g('commit -m "remote update"', clone);
  g('push origin HEAD', clone);

  // Local pull should get the updated memory
  const sync = new GitSync();
  sync.pull(local);

  const content = fs.readFileSync(path.join(local, '.relay', 'memory.md'), 'utf8');
  assert.ok(content.includes('Updated Remote Memory'), 'memory.md should reflect remote update');
});

test('push() returns early when nothing is staged', (t) => {
  const { tmp, local } = makeGitFixture();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const g = (args, cwd) =>
    execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const before = g('rev-parse HEAD', local).trim();
  const sync = new GitSync();
  sync.push(local, 'abc12345');
  const after = g('rev-parse HEAD', local).trim();

  assert.equal(before, after, 'no new commit when nothing staged');
});

test('push() commits and pushes new memory.md to remote', (t) => {
  const { tmp, bare, local } = makeGitFixture();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const g = (args, cwd) =>
    execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  fs.writeFileSync(path.join(local, '.relay', 'memory.md'), '# New Memory\nDecision: use SQLite\n');

  const sync = new GitSync();
  sync.push(local, 'session1');

  // Verify commit exists and was pushed to bare
  const log = g('log --oneline -1', local).trim();
  assert.ok(log.includes('[relay] memory update'), `commit message not found: ${log}`);

  // Check remote has the commit
  const remoteLog = g('log --oneline -1', bare).trim();
  assert.ok(remoteLog.includes('[relay] memory update'), `remote not updated: ${remoteLog}`);
});

test('push() handles non-fast-forward by rebasing and retrying', (t) => {
  const { tmp, local } = makeGitFixture();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const g = (args, cwd) =>
    execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  // Second machine: push a commit that local doesn't have
  const clone = cloneFixture(path.join(tmp, 'remote.git'), tmp);
  fs.writeFileSync(
    path.join(clone, '.relay', 'memory.md'),
    '# Remote Memory\nFrom second machine\n'
  );
  g('add .relay/memory.md', clone);
  g('commit -m "second machine"', clone);
  g('push origin HEAD', clone);

  // Local: modify memory.md (different content → potential conflict)
  fs.writeFileSync(
    path.join(local, '.relay', 'memory.md'),
    '# Local Memory\nFrom first machine\n'
  );

  const sync = new GitSync();
  // Should not throw regardless of outcome (push or abort-on-conflict)
  assert.doesNotThrow(() => sync.push(local, 'abc12345'));

  // Watermark state should exist (either turns reset or unchanged)
  // Main check: repo is not left in a bad state (no rebase in progress)
  let rebaseInProgress = false;
  try {
    g('rebase --show-current-patch', local);
    rebaseInProgress = true;
  } catch {
    // expected — no rebase in progress
  }
  // Also check via .git/rebase-merge or .git/rebase-apply
  const rebaseMerge = path.join(local, '.git', 'rebase-merge');
  const rebaseApply = path.join(local, '.git', 'rebase-apply');
  assert.ok(
    !fs.existsSync(rebaseMerge) && !fs.existsSync(rebaseApply),
    'repo should not be left in a rebase-in-progress state'
  );
});

test('push() does not throw when remote is not configured', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-nopush-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const relayDir = path.join(tmp, '.relay');
  fs.mkdirSync(path.join(relayDir, 'broadcast'), { recursive: true });
  fs.mkdirSync(path.join(relayDir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'memory.md'), '# Memory\n');
  fs.writeFileSync(path.join(relayDir, 'broadcast', '.gitkeep'), '');

  execSync(`git init ${tmp}`, { stdio: 'ignore' });
  execSync('git config user.email test@relay', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  execSync('git add .relay/', { cwd: tmp });
  execSync('git commit -m "init"', { cwd: tmp });

  // Modify memory.md — should commit fine but push will fail (no remote)
  fs.writeFileSync(path.join(relayDir, 'memory.md'), '# Updated\n');

  const sync = new GitSync();
  assert.doesNotThrow(() => sync.push(tmp, 'nosession'));
});

test('lock() creates lock file and returns a release function', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-lock-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const relayDir = path.join(tmp, '.relay');
  fs.mkdirSync(relayDir, { recursive: true });

  const sync = new GitSync();
  const lockPath = path.join(relayDir, 'state', '.lock');

  const release = sync.lock(tmp);
  assert.ok(fs.existsSync(lockPath), 'lock file should exist after lock()');

  release();
  assert.ok(!fs.existsSync(lockPath), 'lock file should be removed after release()');
});

test('lock() throws LOCKED when a fresh lock exists', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-lock2-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const relayDir = path.join(tmp, '.relay');
  fs.mkdirSync(path.join(relayDir, 'state'), { recursive: true });

  const sync = new GitSync();
  const release = sync.lock(tmp);

  assert.throws(
    () => sync.lock(tmp),
    (e) => e.message === 'LOCKED',
    'second lock() on a fresh lock should throw LOCKED'
  );

  release();
});

test('lock() steals a stale lock (older than 60s)', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-lock3-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const relayDir = path.join(tmp, '.relay');
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  // Write a "stale" lock by backdating its mtime
  const lockPath = path.join(stateDir, '.lock');
  fs.writeFileSync(lockPath, new Date(Date.now() - 90_000).toISOString());
  const staleMs = Date.now() - 90_000;
  fs.utimesSync(lockPath, new Date(staleMs), new Date(staleMs));

  const sync = new GitSync();
  let release;
  assert.doesNotThrow(() => { release = sync.lock(tmp); }, 'stale lock should be stealable');
  assert.ok(fs.existsSync(lockPath), 'new lock should exist after stealing');

  if (release) release();
});
