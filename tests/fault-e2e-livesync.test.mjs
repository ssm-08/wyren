/**
 * fault-e2e-livesync.test.mjs
 *
 * End-to-end simulation tests for the Relay live-sync feature.
 * Mimics real two-person usage with a local bare.git acting as the shared remote.
 * No network, no Claude API, no auth required.
 *
 * Each test runs the UPS hook as a subprocess (hooks/user-prompt-submit.mjs) against
 * a real git repo tree — this exercises the full code path including GitSync.pull().
 *
 * Run:  node --test tests/fault-e2e-livesync.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { hashMemory } from '../lib/diff-memory.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELAY_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
  '..'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-livesync-'));
}

/** Run a git command and return the result. */
function git(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Create the three-repo scaffold: bare.git (remote), repoA, repoB.
 * Both repoA and repoB have origin pointing at bare.git.
 * Does NOT create any local branches yet — initRepoRelay does the first commit.
 */
function makeTwoRepos(baseDir) {
  const bare = path.join(baseDir, 'bare.git');
  const repoA = path.join(baseDir, 'repoA');
  const repoB = path.join(baseDir, 'repoB');

  git(['init', '--bare', '-q', bare], baseDir);

  fs.mkdirSync(repoA, { recursive: true });
  git(['init', '-q'], repoA);
  git(['config', 'user.email', 'test@relay'], repoA);
  git(['config', 'user.name', 'relay-test'], repoA);
  git(['remote', 'add', 'origin', bare], repoA);

  fs.mkdirSync(repoB, { recursive: true });
  git(['init', '-q'], repoB);
  git(['config', 'user.email', 'test@relay'], repoB);
  git(['config', 'user.name', 'relay-test'], repoB);
  git(['remote', 'add', 'origin', bare], repoB);

  return { bare, repoA, repoB };
}

/**
 * Create initial .relay/memory.md in repoDir and push to origin.
 * Establishes the remote branch (master or main, whatever git init uses).
 * Returns the branch name that was pushed.
 */
function initRepoRelay(repoDir, initialContent = '# Relay Memory\n') {
  const relayDir = path.join(repoDir, '.relay');
  fs.mkdirSync(relayDir, { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'memory.md'), initialContent, 'utf8');

  git(['add', '.relay/memory.md'], repoDir);
  git(['commit', '-m', 'init relay'], repoDir);

  const r = git(['push', '--set-upstream', 'origin', 'HEAD'], repoDir);
  if (r.status !== 0) {
    throw new Error(`initRepoRelay push failed: ${r.stderr}`);
  }

  // Return actual branch name
  const branchR = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  return (branchR.stdout || '').trim() || 'master';
}

/**
 * Detect the remote branch name by listing remote refs.
 * Returns 'master' or 'main' (or whatever the remote uses).
 */
function detectBranch(repoDir) {
  const r = git(['ls-remote', '--heads', 'origin'], repoDir);
  if (r.status !== 0 || !r.stdout.trim()) return 'master';
  const lines = r.stdout.trim().split('\n');
  for (const line of lines) {
    const m = line.match(/refs\/heads\/(.+)$/);
    if (m) return m[1].trim();
  }
  return 'master';
}

/**
 * Clone the remote into repoDir:
 * - Fetches origin
 * - Creates a local tracking branch matching the remote branch
 * - Sets upstream so GitSync.pull() can use @{upstream}
 * This is critical: GitSync.pull() needs a local branch with upstream set
 * to resolve 'origin/master' (via `git rev-parse --abbrev-ref @{upstream}`).
 * Uses --force on checkout to handle pre-existing untracked files (e.g. Test 5).
 */
function cloneRelay(repoDir, remoteBranch) {
  const branch = remoteBranch || detectBranch(repoDir);

  const fetchR = git(['fetch', 'origin'], repoDir);
  if (fetchR.status !== 0) {
    throw new Error(`cloneRelay fetch failed: ${fetchR.stderr}`);
  }

  // Create local branch tracking remote. --force handles pre-existing untracked files.
  const coR = git(['checkout', '-B', branch, '--force', `origin/${branch}`], repoDir);
  if (coR.status !== 0) {
    throw new Error(`cloneRelay checkout failed: ${coR.stderr}`);
  }

  // Set upstream tracking
  git(['branch', `--set-upstream-to=origin/${branch}`, branch], repoDir);
}

/**
 * Update memory.md in repoDir and push to origin.
 * If the push is rejected (non-fast-forward), fetches + rebases onto FETCH_HEAD and retries.
 * Uses theirs strategy for memory.md conflicts (last writer wins — acceptable for test).
 */
function pushMemory(repoDir, content) {
  const relayDir = path.join(repoDir, '.relay');
  fs.mkdirSync(relayDir, { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'memory.md'), content, 'utf8');

  git(['add', '.relay/memory.md'], repoDir);

  // Allow "nothing to commit" — treat as success
  const commitR = git(['commit', '-m', '[relay] test push'], repoDir);
  if (commitR.status !== 0 && !(commitR.stderr || '').includes('nothing to commit')) {
    throw new Error(`pushMemory commit failed: ${commitR.stderr}`);
  }

  // Try push; if rejected (non-fast-forward), fetch + ours-strategy rebase and retry.
  // We use 'ours' for memory.md so our content wins over the remote version.
  let pushR = git(['push', 'origin', 'HEAD'], repoDir);
  if (pushR.status !== 0) {
    const fetchR = git(['fetch', 'origin'], repoDir);
    if (fetchR.status !== 0) {
      throw new Error(`pushMemory fetch failed: ${fetchR.stderr}`);
    }

    // Set up rerere-style "ours" config for memory.md so rebase doesn't conflict
    git(['config', 'merge.ours.driver', 'true'], repoDir);
    const gitAttributesPath = path.join(repoDir, '.gitattributes');
    const attrEntry = '.relay/memory.md merge=ours\n';
    let existingAttrs = '';
    try { existingAttrs = fs.readFileSync(gitAttributesPath, 'utf8'); } catch {}
    if (!existingAttrs.includes('.relay/memory.md')) {
      fs.writeFileSync(gitAttributesPath, existingAttrs + attrEntry, 'utf8');
    }

    const rebaseR = git(['rebase', 'FETCH_HEAD'], repoDir);
    if (rebaseR.status !== 0) {
      // Abort and throw — caller must handle
      git(['rebase', '--abort'], repoDir);
      throw new Error(`pushMemory rebase failed: ${rebaseR.stderr}`);
    }

    pushR = git(['push', 'origin', 'HEAD'], repoDir);
    if (pushR.status !== 0) {
      throw new Error(`pushMemory push (after rebase) failed: ${pushR.stderr}`);
    }
  }
  return content;
}

/**
 * Seed B's UPS state so it appears as if B already saw a given memory content.
 * This prevents the first-run seed from suppressing the delta on the next fire.
 * Writes to ups-state.json (UPS-owned) NOT watermark.json (Stop-owned).
 */
function seedBUpsState(repoDir, seenContent) {
  const stateDir = path.join(repoDir, '.relay', 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  const memPath = path.join(repoDir, '.relay', 'memory.md');
  // Use stale mtime (1) so mtime guard doesn't fast-path — actual mtime check
  // will see a difference because the file was written by cloneRelay (not by us).
  // We set mtime to 1 so the hook sees mtime != 1 → proceeds past fast-path.
  const upsState = {
    last_injected_mtime: 1,
    last_injected_hash: hashMemory(seenContent),
  };
  fs.writeFileSync(path.join(stateDir, 'ups-state.json'), JSON.stringify(upsState, null, 2), 'utf8');

  // Also write the snapshot so diffMemory has the correct baseline
  fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), seenContent, 'utf8');
}

/**
 * Run the UPS hook subprocess against repoDir (as B's working directory).
 * opts.skipPull: set RELAY_SKIP_PULL=1 to skip git fetch.
 * opts.sessionId: session id string (default 'test-b').
 * opts.env: merged into process.env.
 */
function runUPS(repoDir, opts = {}) {
  const stdin = JSON.stringify({
    session_id: opts.sessionId || 'test-b',
    transcript_path: '',
    cwd: repoDir,
    hook_event_name: 'UserPromptSubmit',
  });

  const env = { ...process.env };
  if (opts.skipPull) env.RELAY_SKIP_PULL = '1';
  else delete env.RELAY_SKIP_PULL;
  if (opts.env) Object.assign(env, opts.env);

  return spawnSync('node', ['hooks/user-prompt-submit.mjs'], {
    cwd: RELAY_ROOT,
    input: stdin,
    encoding: 'utf8',
    timeout: 15000,
    env,
    windowsHide: true,
  });
}

/**
 * Parse UPS stdout → additionalContext string, or null if hook produced no injection.
 */
function parseAdditionalContext(result) {
  const stdout = (result.stdout || '').trim();
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    return parsed?.hookSpecificOutput?.additionalContext || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Basic A→push→B injection cycle
// ---------------------------------------------------------------------------

test('Test 1: A pushes new memory, B UPS fires and injects delta', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    // Step 1: A initialises .relay and pushes to bare
    const v0 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n';
    const branch = initRepoRelay(repoA, v0);

    // Step 2: B clones (creates local tracking branch so GitSync.pull works)
    cloneRelay(repoB, branch);

    const bMemPath = path.join(repoB, '.relay', 'memory.md');
    assert.ok(fs.existsSync(bMemPath), 'B should have memory.md after cloneRelay');
    assert.ok(
      fs.readFileSync(bMemPath, 'utf8').includes('Use SQLite'),
      'B memory.md should contain initial content'
    );

    // Step 3: Seed B's UPS state as if it already saw v0 at SessionStart
    seedBUpsState(repoB, v0);

    // Step 4: A pushes new memory with an additional bullet
    const v1 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n- Add rate limiting [session a, turn 3]\n';
    pushMemory(repoA, v1);

    // Step 5: B's UPS fires — should pull v1 from bare, detect change, emit delta
    const result = runUPS(repoB);

    assert.equal(result.status, 0, `hook exited ${result.status}: stderr=${result.stderr}`);
    assert.equal(result.error, undefined, `spawn error: ${result.error}`);

    const ctx = parseAdditionalContext(result);
    assert.ok(
      ctx !== null,
      `Expected additionalContext but got none. stdout="${result.stdout}" stderr="${result.stderr}"`
    );
    assert.ok(ctx.includes('Add rate limiting'), `Delta should contain new bullet. Got: ${ctx}`);
    assert.ok(ctx.includes('Relay live update'), 'Delta header must be present');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: A pushes twice, B only fires UPS once per change (mtime guard)
// ---------------------------------------------------------------------------

test('Test 2: UPS idempotent — second fire after same content produces no injection', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    const v0 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n';
    const branch = initRepoRelay(repoA, v0);
    cloneRelay(repoB, branch);
    seedBUpsState(repoB, v0);

    // A pushes V1
    const v1 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n- Add caching [session a, turn 5]\n';
    pushMemory(repoA, v1);

    // B's first UPS fire — should inject V0→V1 delta
    const fire1 = runUPS(repoB);
    assert.equal(fire1.status, 0, `fire1 exited ${fire1.status}: ${fire1.stderr}`);
    const ctx1 = parseAdditionalContext(fire1);
    assert.ok(ctx1 !== null, `First UPS fire should produce additionalContext. stdout="${fire1.stdout}"`);
    assert.ok(ctx1.includes('Add caching'), `First delta should include new bullet. Got: ${ctx1}`);

    // B's second UPS fire immediately — mtime already recorded by fire1 → no injection
    const fire2 = runUPS(repoB);
    assert.equal(fire2.status, 0, `fire2 exited ${fire2.status}: ${fire2.stderr}`);
    const ctx2 = parseAdditionalContext(fire2);
    assert.equal(ctx2, null, `Second UPS fire should produce no injection. Got: ${ctx2}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: Multiple teammates (A and C both push between B's prompts)
// ---------------------------------------------------------------------------

test('Test 3: Multiple teammates push, B sees all new bullets in one injection', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    // Setup repoC (a third teammate sharing the same bare remote)
    const repoC = path.join(base, 'repoC');
    fs.mkdirSync(repoC, { recursive: true });
    git(['init', '-q'], repoC);
    git(['config', 'user.email', 'c@relay'], repoC);
    git(['config', 'user.name', 'relay-c'], repoC);
    git(['remote', 'add', 'origin', path.join(base, 'bare.git')], repoC);

    const v0 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n';
    const branch = initRepoRelay(repoA, v0);

    // B and C both clone initial memory
    cloneRelay(repoB, branch);
    cloneRelay(repoC, branch);

    // Seed B's UPS state as if it saw v0 at SessionStart
    seedBUpsState(repoB, v0);

    // A pushes 2 new bullets to the remote
    const v1 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n- Add rate limiting [session a, turn 3]\n- Enable caching [session a, turn 5]\n';
    pushMemory(repoA, v1);

    // C pulls A's v1 first (so C's local is fast-forward ahead of v0), then adds its bullet
    // Without pulling v1, C's commit diverges from A's and rebase produces a merge conflict.
    const pullR = git(['pull', '--rebase', 'origin', 'HEAD'], repoC);
    if (pullR.status !== 0) {
      throw new Error(`repoC pull failed: ${pullR.stderr}`);
    }
    // C adds its bullet on top of v1 (no conflict — C's local now has all of A's bullets)
    const v2 = fs.readFileSync(path.join(repoC, '.relay', 'memory.md'), 'utf8').trimEnd()
      + '\n- C teammate decision [session c, turn 2]\n';
    pushMemory(repoC, v2);

    // B's UPS fires once — should pull v2 (latest), see ALL 3 new bullets
    const fire = runUPS(repoB);
    assert.equal(fire.status, 0, `UPS exited ${fire.status}: ${fire.stderr}`);
    const ctx = parseAdditionalContext(fire);
    assert.ok(ctx !== null, `B should receive injection with all new bullets. stdout="${fire.stdout}"`);
    assert.ok(ctx.includes('Add rate limiting'), `Delta should include A bullet 1. Got: ${ctx}`);
    assert.ok(ctx.includes('Enable caching'), `Delta should include A bullet 2. Got: ${ctx}`);
    assert.ok(ctx.includes('C teammate decision'), `Delta should include C bullet. Got: ${ctx}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: B pushes too (round-trip echo test)
// ---------------------------------------------------------------------------

test('Test 4: Self-echo — B pushes its own memory, UPS fires, documents echo behavior', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    const v0 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n';
    const branch = initRepoRelay(repoA, v0);
    cloneRelay(repoB, branch);
    seedBUpsState(repoB, v0);

    // B writes its own memory and pushes (simulating B's own distiller ran)
    // B is at v0 from clone, and A is also at v0 — straightforward fast-forward
    const vB = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n- B made a decision [session b, turn 3]\n';
    pushMemory(repoB, vB);

    // B's UPS fires. B's disk already has vB (just written by pushMemory).
    // B's ups-state.json says: mtime=1, hash=hash(v0).
    // UPS will see mtime differs → hash differs → compute diff(v0, vB) → inject.
    // This is the intentional self-echo behavior in v1 (no self-loop guard).
    const fire = runUPS(repoB);
    assert.equal(fire.status, 0, `UPS exited ${fire.status}: ${fire.stderr}`);

    const ctx = parseAdditionalContext(fire);

    // v1 intentionally echoes B's own push. Document it:
    if (ctx !== null) {
      // Self-echo happened (expected)
      assert.ok(
        ctx.includes('B made a decision'),
        `Self-echo delta should contain B's own bullet. Got: ${ctx}`
      );
    }
    // If mtime guard happened to match (tight timing), ctx could be null — also OK.

    // Second fire — watermark is now updated with vB's mtime → no injection
    const fire2 = runUPS(repoB);
    assert.equal(fire2.status, 0, `fire2 exited ${fire2.status}: ${fire2.stderr}`);
    const ctx2 = parseAdditionalContext(fire2);
    assert.equal(ctx2, null, 'Second fire after self-echo should produce no injection');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: Network appears mid-session (no remote → remote added → UPS fires)
// ---------------------------------------------------------------------------

test('Test 5: No remote initially, remote added mid-session, UPS eventually injects', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB, bare } = makeTwoRepos(base);

    const v0 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n';
    initRepoRelay(repoA, v0);

    // Give repoB an initial commit so git has a local HEAD (needed for tracking setup later)
    fs.mkdirSync(path.join(repoB, '.relay', 'state'), { recursive: true });
    fs.writeFileSync(path.join(repoB, '.relay', 'memory.md'), v0, 'utf8');
    git(['add', '.relay/memory.md'], repoB);
    git(['commit', '-m', 'local init'], repoB);

    // Now remove repoB's remote (simulate B starting with no remote configured)
    git(['remote', 'remove', 'origin'], repoB);

    // First UPS fire: no remote → GitSync.pull() short-circuits → first-run seed
    const fire1 = runUPS(repoB);
    assert.equal(fire1.status, 0, `fire1 exited ${fire1.status}: ${fire1.stderr}`);
    const ctx1 = parseAdditionalContext(fire1);
    // First run: UPS seeds its state (writes ups-state.json) but produces no delta
    assert.equal(ctx1, null, `No injection expected on first fire with no remote. Got: ${ctx1}`);

    // Verify UPS state was seeded
    const upsStatePath = path.join(repoB, '.relay', 'state', 'ups-state.json');
    assert.ok(fs.existsSync(upsStatePath), 'UPS state file should exist after first fire');
    const upsState1 = JSON.parse(fs.readFileSync(upsStatePath, 'utf8'));
    assert.ok(upsState1.last_injected_hash, 'UPS state should have seeded hash');

    // Add remote mid-session and create a proper local tracking branch.
    // cloneRelay uses --force to handle the pre-existing local memory.md.
    git(['remote', 'add', 'origin', bare], repoB);
    const detectedBranch = detectBranch(repoB);
    cloneRelay(repoB, detectedBranch);

    // A pushes new content
    const v1 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n- Mid-session addition [session a, turn 7]\n';
    pushMemory(repoA, v1);

    // Second UPS fire: now has remote + local branch → pulls v1, detects change, injects delta
    const fire2 = runUPS(repoB);
    assert.equal(fire2.status, 0, `fire2 exited ${fire2.status}: ${fire2.stderr}`);
    const ctx2 = parseAdditionalContext(fire2);
    assert.ok(
      ctx2 !== null,
      `Injection expected after remote added. stdout="${fire2.stdout}" stderr="${fire2.stderr}"`
    );
    assert.ok(ctx2.includes('Mid-session addition'), `Delta should include new bullet. Got: ${ctx2}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: Rapid concurrent UPS fires are idempotent (mtime guard deduplicates)
// ---------------------------------------------------------------------------

test('Test 6: Rapid concurrent UPS fires are idempotent (mtime guards dedup)', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    const v0 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n';
    const branch = initRepoRelay(repoA, v0);
    cloneRelay(repoB, branch);

    const v1 = '# Relay Memory\n\n## Decisions\n- Use SQLite [session a, turn 1]\n- Concurrent fire [session a, turn 9]\n';
    pushMemory(repoA, v1);

    // Seed B's UPS state so first fire produces a real delta
    seedBUpsState(repoB, v0);

    // Fire 1 — should inject
    const fire1 = runUPS(repoB);
    assert.equal(fire1.status, 0, `fire1 exited ${fire1.status}: ${fire1.stderr}`);
    const ctx1 = parseAdditionalContext(fire1);
    assert.ok(ctx1 !== null, `fire1 should inject. stdout="${fire1.stdout}"`);
    assert.ok(ctx1.includes('Concurrent fire'), `Delta missing expected bullet. Got: ${ctx1}`);

    // Fire 2 immediately — mtime guard should kill it (same memory.md, same mtime)
    const fire2 = runUPS(repoB);
    assert.equal(fire2.status, 0, `fire2 exited ${fire2.status}: ${fire2.stderr}`);
    const ctx2 = parseAdditionalContext(fire2);
    assert.equal(ctx2, null, `fire2 must produce no injection (deduped by mtime). Got: ${ctx2}`);

    // Fire 3 also — guard holds
    const fire3 = runUPS(repoB);
    assert.equal(fire3.status, 0, `fire3 exited ${fire3.status}: ${fire3.stderr}`);
    const ctx3 = parseAdditionalContext(fire3);
    assert.equal(ctx3, null, `fire3 must produce no injection. Got: ${ctx3}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7: Delta truncation — very large memory stays within ~4096 byte limit
// ---------------------------------------------------------------------------

test('Test 7: Large delta is truncated to stay within 4096 byte limit', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    const v0 = '# Relay Memory\n\n## Decisions\n- Original decision [session a, turn 1]\n';
    const branch = initRepoRelay(repoA, v0);
    cloneRelay(repoB, branch);
    seedBUpsState(repoB, v0);

    // Generate a massive memory update (100 long bullets)
    const bullets = Array.from({ length: 100 }, (_, i) =>
      `- Decision ${i + 1}: ${'x'.repeat(60)} [session a, turn ${i + 2}]`
    ).join('\n');
    const vBig = `# Relay Memory\n\n## Decisions\n- Original decision [session a, turn 1]\n${bullets}\n`;
    pushMemory(repoA, vBig);

    const fire = runUPS(repoB);
    assert.equal(fire.status, 0, `UPS exited ${fire.status}: ${fire.stderr}`);
    const ctx = parseAdditionalContext(fire);
    assert.ok(ctx !== null, `Large delta should still inject. stdout="${fire.stdout}"`);

    // renderDelta truncates at 4096 bytes
    const byteLen = Buffer.byteLength(ctx, 'utf8');
    assert.ok(
      byteLen <= 4096 + 100, // small tolerance for truncation marker bytes
      `Delta must be <= ~4196 bytes. Got: ${byteLen}`
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8: Bullet reordering — no false delta (section-aware set-diff ignores order)
// ---------------------------------------------------------------------------

test('Test 8: Bullet reordering in same section produces no delta', () => {
  const base = makeTmpDir();
  try {
    const { repoA, repoB } = makeTwoRepos(base);

    const v0 = '# Relay Memory\n\n## Decisions\n- Alpha [session a, turn 1]\n- Beta [session a, turn 2]\n';
    const branch = initRepoRelay(repoA, v0);
    cloneRelay(repoB, branch);
    seedBUpsState(repoB, v0);

    // Reorder bullets (same set, different order)
    const vReordered = '# Relay Memory\n\n## Decisions\n- Beta [session a, turn 2]\n- Alpha [session a, turn 1]\n';
    pushMemory(repoA, vReordered);

    const fire = runUPS(repoB);
    assert.equal(fire.status, 0, `UPS exited ${fire.status}: ${fire.stderr}`);
    const ctx = parseAdditionalContext(fire);

    // Section-aware set diff sees no change (same bullets regardless of order)
    assert.equal(ctx, null, `Reordered bullets must produce no delta. Got: ${ctx}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
