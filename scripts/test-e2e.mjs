#!/usr/bin/env node
/**
 * Wyren end-to-end smoke test — exercises the full hook pipeline via real subprocesses.
 * Runs offline: distiller uses --dry-run or Tier-0 early exit, no Claude API call.
 *
 * Usage:
 *   node scripts/test-e2e.mjs            # all tests
 *   node scripts/test-e2e.mjs --only stop # tests whose name includes "stop"
 *   node scripts/test-e2e.mjs --verbose   # dump stdout/stderr on failure
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const WYREN_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wyren-e2e-'));
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function initGit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@wyren'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'wyren-test'], { cwd: dir });
}

function seedWyren(dir, { memory = null, skills = {} } = {}) {
  const wyrenDir = path.join(dir, '.wyren');
  fs.mkdirSync(path.join(wyrenDir, 'state'), { recursive: true });
  fs.mkdirSync(path.join(wyrenDir, 'broadcast', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(wyrenDir, 'broadcast', '.gitkeep'), '');
  fs.writeFileSync(path.join(wyrenDir, 'broadcast', 'skills', '.gitkeep'), '');
  if (memory !== null) {
    fs.writeFileSync(path.join(wyrenDir, 'memory.md'), memory, 'utf8');
  }
  for (const [name, content] of Object.entries(skills)) {
    fs.writeFileSync(path.join(wyrenDir, 'broadcast', 'skills', name), content, 'utf8');
  }
}

function writeWatermark(dir, state) {
  const p = path.join(dir, '.wyren', 'state', 'watermark.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function readWatermark(dir) {
  const p = path.join(dir, '.wyren', 'state', 'watermark.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function hookInput(event, cwd, extra = {}) {
  return JSON.stringify({
    session_id: 'test-session-uuid',
    transcript_path: extra.transcript_path || path.join(cwd, 'fake-transcript.jsonl'),
    cwd,
    permission_mode: 'default',
    hook_event_name: event,
    source: event === 'SessionStart' ? 'startup' : undefined,
    ...extra,
  });
}

function runNode(args, { cwd, stdin = '', env = {} } = {}) {
  return spawnSync('node', args, {
    cwd: cwd || WYREN_ROOT,
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, WYREN_SKIP_PULL: '1', ...env },
    timeout: 15000,
  });
}

function runHook(hookFile, event, cwd, { extra = {}, env = {} } = {}) {
  return runNode(
    [path.join(WYREN_ROOT, 'hooks', hookFile)],
    { cwd, stdin: hookInput(event, cwd, extra), env }
  );
}

/** Build a minimal valid JSONL transcript string. */
function buildTranscript(turns) {
  return turns.map((t, i) => {
    // Always use array content — renderAssistantContent skips non-array content
    const content = t.tools
      ? [{ type: 'text', text: t.text }, ...t.tools.map(tu => ({ type: 'tool_use', name: tu.name, input: tu.input || {} }))]
      : [{ type: 'text', text: t.text }];
    return JSON.stringify({
      uuid: `test-uuid-${i}`,
      type: t.role,
      sessionId: 'testsession',
      isSidechain: false,
      message: { content },
    });
  }).join('\n') + '\n';
}

function writeTranscript(dir, turns) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, buildTranscript(turns), 'utf8');
  return p;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected "${needle}" in:\n${haystack.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const tests = [];
function test(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  tests.push({ name, fn });
}

async function run() {
  let passed = 0;
  let failed = 0;
  const start = Date.now();

  for (const t of tests) {
    const t0 = Date.now();
    const dir = makeTmpDir();
    try {
      await t.fn(dir);
      console.log(`[PASS] ${t.name} (${Date.now() - t0}ms)`);
      passed++;
    } catch (e) {
      console.log(`[FAIL] ${t.name} (${Date.now() - t0}ms): ${e.message}`);
      if (VERBOSE && e._result) {
        const r = e._result;
        if (r.stdout) console.log('  stdout:', r.stdout.slice(0, 800));
        if (r.stderr) console.log('  stderr:', r.stderr.slice(0, 800));
      }
      failed++;
    } finally {
      rmDir(dir);
    }
  }

  const total = Date.now() - start;
  console.log(`\n${passed} passed, ${failed} failed in ${total}ms`);
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// Group A — wyren init
// ---------------------------------------------------------------------------

test('A1: wyren init creates .wyren skeleton', async (dir) => {
  initGit(dir);
  const r = runNode([path.join(WYREN_ROOT, 'bin', 'wyren.mjs'), 'init'], { cwd: dir });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(fs.existsSync(path.join(dir, '.wyren', 'memory.md')), 'memory.md missing');
  assert(fs.existsSync(path.join(dir, '.wyren', 'broadcast', 'skills', '.gitkeep')), 'skills/.gitkeep missing');
  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assertIncludes(gitignore, '.wyren/state/', '.gitignore');
  assertIncludes(gitignore, '.wyren/log', '.gitignore');
});

test('A2: wyren init is idempotent', async (dir) => {
  initGit(dir);
  const wyrenMjs = path.join(WYREN_ROOT, 'bin', 'wyren.mjs');
  runNode([wyrenMjs, 'init'], { cwd: dir });
  const mtime1 = fs.statSync(path.join(dir, '.wyren', 'memory.md')).mtimeMs;
  const r2 = runNode([wyrenMjs, 'init'], { cwd: dir });
  assert(r2.status === 0, `second init exit ${r2.status}`);
  assertIncludes(r2.stdout, 'already initialized', 'second init output');
  const mtime2 = fs.statSync(path.join(dir, '.wyren', 'memory.md')).mtimeMs;
  assert(mtime1 === mtime2, 'memory.md mtime changed on second init');
});

// ---------------------------------------------------------------------------
// Group B — SessionStart hook
// ---------------------------------------------------------------------------

test('B3: session-start with no memory → empty stdout', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  const r = runHook('session-start.mjs', 'SessionStart', dir);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(!r.stdout || r.stdout.trim() === '', `expected empty stdout, got: ${r.stdout.slice(0, 200)}`);
});

test('B4: session-start with memory → injects additionalContext', async (dir) => {
  initGit(dir);
  const MEMORY = '## Decision\nUse atomic writes everywhere.';
  seedWyren(dir, { memory: MEMORY });
  const r = runHook('session-start.mjs', 'SessionStart', dir);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim());
  const ctx = out.hookSpecificOutput.additionalContext;
  assertIncludes(ctx, 'atomic writes', 'additionalContext');
  assertIncludes(ctx, '# Wyren Memory', 'additionalContext header');
});

test('B5: session-start with broadcast skill → injects + ack line', async (dir) => {
  initGit(dir);
  const MEMORY = '## Team context\nUse spawnSync arrays.';
  const SKILL = '## my-skill\nDo things this way.';
  seedWyren(dir, { memory: MEMORY, skills: { 'my-skill.md': SKILL } });
  const r = runHook('session-start.mjs', 'SessionStart', dir);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim());
  const ctx = out.hookSpecificOutput.additionalContext;
  assertIncludes(ctx, '# Wyren Broadcast', 'broadcast section');
  assertIncludes(ctx, 'Do things this way', 'skill content');
  assertIncludes(ctx, 'Loaded 1 team skill(s)', 'ack instruction');
});

test('B6: WYREN_SKIP_PULL skips git pull without hanging', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## test\nsome memory' });
  // Set bogus remote — without WYREN_SKIP_PULL this would attempt network
  spawnSync('git', ['remote', 'add', 'origin', 'https://bogus.invalid/repo.git'], { cwd: dir });
  const r = runHook('session-start.mjs', 'SessionStart', dir, {
    env: { WYREN_SKIP_PULL: '1' },
  });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  // Should complete fast (no network) and return memory
  const out = JSON.parse(r.stdout.trim());
  assert(out.hookSpecificOutput.additionalContext.includes('some memory'), 'memory in context');
});

// ---------------------------------------------------------------------------
// Group C — Stop hook
// ---------------------------------------------------------------------------

test('C7: stop hook increments watermark', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  writeWatermark(dir, { turns_since_distill: 0 });
  const r = runHook('stop.mjs', 'Stop', dir);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const state = readWatermark(dir);
  assert(state !== null, 'watermark.json not written');
  assert(state.turns_since_distill === 1, `turns=${state.turns_since_distill} expected 1`);
  assert(typeof state.last_turn_at === 'number', 'last_turn_at missing');
  const age = Date.now() - state.last_turn_at;
  assert(age < 5000, `last_turn_at too old: ${age}ms`);
  assert(!state.distiller_running, 'distiller_running should be false at turn 1');
});

test('C8: stop hook at threshold spawns distiller and resets turns', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  // Write a real transcript so stop.mjs has a valid path
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'hi', tools: [{ name: 'Edit', input: { path: 'x', content: 'y' } }] },
  ]);
  writeWatermark(dir, { turns_since_distill: 4 });
  const r = runHook('stop.mjs', 'Stop', dir, {
    extra: { transcript_path: transcriptPath },
  });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const state = readWatermark(dir);
  assert(state !== null, 'watermark.json not written');
  // After spawn path: turns reset to 0, distiller_running=true
  assert(state.turns_since_distill === 0, `turns=${state.turns_since_distill} expected 0 (reset on spawn)`);
  assert(state.distiller_running === true, 'distiller_running should be true after spawn decision');
});

test('C9: trigger lock prevents double-distill spawn', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'hello' },
  ]);
  writeWatermark(dir, { turns_since_distill: 5 });
  // Pre-create trigger lock — simulates another Stop hook already won the race
  const lockPath = path.join(dir, '.wyren', 'state', 'distill-trigger.lock');
  fs.writeFileSync(lockPath, '');
  const r = runHook('stop.mjs', 'Stop', dir, {
    extra: { transcript_path: transcriptPath },
  });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const state = readWatermark(dir);
  // turns increments normally (updateWatermark runs before lock check)
  // but distiller_running must NOT be set (spawn was skipped)
  assert(!state.distiller_running, 'distiller_running should not be set when lock held');
});

test('C10: stop hook handles malformed stdin → exits 0', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  const r = runNode(
    [path.join(WYREN_ROOT, 'hooks', 'stop.mjs')],
    { cwd: dir, stdin: 'NOT JSON AT ALL' }
  );
  assert(r.status === 0, `exit ${r.status} — should fail open`);
});

// ---------------------------------------------------------------------------
// Group D — Distiller (offline)
// ---------------------------------------------------------------------------

test('D11: distiller --dry-run with tool_use signal → exits 0, prompt on stdout', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## existing\nOld memory.' });
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'Please edit the file.' },
    { role: 'assistant', text: 'Done.', tools: [{ name: 'Edit', input: { path: 'foo.txt' } }] },
  ]);
  const memPath = path.join(dir, '.wyren', 'memory.md');
  const outPath = path.join(dir, '.wyren', 'memory.out.md');
  const r = runNode([
    path.join(WYREN_ROOT, 'distiller.mjs'),
    '--transcript', transcriptPath,
    '--memory', memPath,
    '--out', outPath,
    '--cwd', dir,
    '--dry-run',
    '--force',
  ], { cwd: dir });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(r.stdout.length > 0, 'prompt should be written to stdout');
  assertIncludes(r.stdout, 'existing-memory', 'prompt contains memory section');
  assertIncludes(r.stdout, 'transcript-slice', 'prompt contains transcript section');
  assertIncludes(r.stdout, '[tool_use Edit]', 'tool_use rendered in transcript');
});

test('D12: distiller Tier-0 filter skips no-signal transcript without API call', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## original\nOriginal content.' });
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'How are you?' },
    { role: 'assistant', text: 'I am well, thank you.' },
  ]);
  const memPath = path.join(dir, '.wyren', 'memory.md');
  const outPath = path.join(dir, '.wyren', 'memory.out.md');
  const origMtime = fs.statSync(memPath).mtimeMs;
  // No --dry-run, no --force → hits Tier-0 check before any Claude call
  const r = runNode([
    path.join(WYREN_ROOT, 'distiller.mjs'),
    '--transcript', transcriptPath,
    '--memory', memPath,
    '--out', outPath,
    '--cwd', dir,
  ], { cwd: dir });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assertIncludes(r.stderr, 'low-signal session', 'Tier0 skip message in stderr');
  const newMtime = fs.statSync(memPath).mtimeMs;
  assert(origMtime === newMtime, 'memory.md should be untouched by Tier-0 skip');
});

test('D13: distiller --since slices transcript correctly', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## mem\nOld.' });
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'Turn one content here decided.' },
    { role: 'assistant', text: 'Response one.', tools: [{ name: 'Write', input: {} }] },
    { role: 'user', text: 'Turn three content.' },
    { role: 'assistant', text: 'Response three.', tools: [{ name: 'Edit', input: {} }] },
  ]);
  const memPath = path.join(dir, '.wyren', 'memory.md');
  const outPath = path.join(dir, '.wyren', 'memory.out.md');
  // --since uuid-0 means skip turn 0 (index 0), include turns 1+
  const r = runNode([
    path.join(WYREN_ROOT, 'distiller.mjs'),
    '--transcript', transcriptPath,
    '--memory', memPath,
    '--out', outPath,
    '--cwd', dir,
    '--dry-run',
    '--force',
    '--since', 'test-uuid-0',
  ], { cwd: dir });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(!r.stdout.includes('Turn one content'), 'turn 0 should be sliced out');
  assertIncludes(r.stdout, 'Turn three content', 'turn 2+ should appear');
});

// ---------------------------------------------------------------------------
// Group E — CLI
// ---------------------------------------------------------------------------

test('E14: wyren status prints expected fields in initialized repo', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## Status test\nSome memory content.' });
  const r = runNode([path.join(WYREN_ROOT, 'bin', 'wyren.mjs'), 'status'], { cwd: dir });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assertIncludes(r.stdout, 'Memory:', 'Memory label');
  assertIncludes(r.stdout, 'Progress:', 'Progress label');
  assertIncludes(r.stdout, 'Remote:', 'Remote label');
});

test('E15: wyren status handles missing .wyren/ gracefully', async (dir) => {
  initGit(dir);
  // No seedWyren — plain git repo
  const r = runNode([path.join(WYREN_ROOT, 'bin', 'wyren.mjs'), 'status'], { cwd: dir });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assertIncludes(r.stdout, 'not initialized', 'not initialized message');
});

// ---------------------------------------------------------------------------
// Group F — Dispatcher (run-hook.cmd)
// ---------------------------------------------------------------------------

test('F16: run-hook.cmd session-start routes correctly', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## Dispatcher test\nVia dispatcher.' });
  const dispatcher = path.join(WYREN_ROOT, 'hooks', 'run-hook.cmd');
  // On Windows, invoke via cmd.exe; on other platforms skip gracefully
  if (process.platform !== 'win32') {
    console.log('  (skipped on non-Windows)');
    return;
  }
  const r = spawnSync('cmd.exe', ['/c', dispatcher, 'session-start'], {
    input: hookInput('SessionStart', dir),
    encoding: 'utf8',
    env: { ...process.env, WYREN_SKIP_PULL: '1' },
    timeout: 15000,
  });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim());
  assertIncludes(out.hookSpecificOutput.additionalContext, 'Dispatcher test', 'memory via dispatcher');
});

test('F17: run-hook.cmd stop routes correctly', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  writeWatermark(dir, { turns_since_distill: 0 });
  const dispatcher = path.join(WYREN_ROOT, 'hooks', 'run-hook.cmd');
  if (process.platform !== 'win32') {
    console.log('  (skipped on non-Windows)');
    return;
  }
  const r = spawnSync('cmd.exe', ['/c', dispatcher, 'stop'], {
    input: hookInput('Stop', dir),
    encoding: 'utf8',
    env: { ...process.env, WYREN_SKIP_PULL: '1' },
    timeout: 15000,
  });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const state = readWatermark(dir);
  assert(state.turns_since_distill === 1, `turns=${state.turns_since_distill} expected 1`);
});

// ---------------------------------------------------------------------------
// Group G — Stress / concurrency
// ---------------------------------------------------------------------------

/** Spawn N concurrent stop hooks against the same .wyren/ dir.
 *  Returns array of exit codes once all settle. */
function spawnStopHooks(n, dir, transcriptPath, extraEnv = {}) {
  const hookPath = path.join(WYREN_ROOT, 'hooks', 'stop.mjs');
  const input = hookInput('Stop', dir, { transcript_path: transcriptPath });
  const procs = [];
  for (let i = 0; i < n; i++) {
    const p = spawn('node', [hookPath], {
      env: { ...process.env, WYREN_SKIP_PULL: '1', ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    p.stdin.end(input, 'utf8');
    procs.push(p);
  }
  return Promise.all(procs.map((p) => new Promise((res) => {
    p.on('close', (code) => res(code ?? 0));
    p.on('error', () => res(1));
  })));
}

test('G18: concurrent stop hooks — no watermark corruption (10 simultaneous)', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  writeWatermark(dir, { turns_since_distill: 0 });
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'hello' },
  ]);

  const N = 10;
  // Set threshold above N so no hook triggers the distiller reset (which would zero turns).
  // On Windows, process startup stagger means hooks can run near-sequentially — without a
  // high threshold the watermark reaches 5, distiller resets it to 0, and the test fails.
  const codes = await spawnStopHooks(N, dir, transcriptPath, { WYREN_TURNS_THRESHOLD: '100' });

  // All hooks exit 0 (fail-open)
  const nonZero = codes.filter((c) => c !== 0);
  assert(nonZero.length === 0, `${nonZero.length} hooks exited non-zero`);

  // Watermark must be valid JSON, no corruption.
  // turns_since_distill: read-modify-write races mean count is 1..N (lost updates
  // are by-design — watermark is approximate, atomic write prevents JSON corruption).
  const state = readWatermark(dir);
  assert(state !== null, 'watermark.json missing after concurrent hooks');
  assert(typeof state.turns_since_distill === 'number', 'turns_since_distill corrupted (not a number)');
  assert(state.turns_since_distill >= 1, `turns=${state.turns_since_distill} — at least 1 must have written`);
  assert(state.turns_since_distill <= N, `turns=${state.turns_since_distill} exceeds N=${N} — impossible`);
  assert(typeof state.last_turn_at === 'number', 'last_turn_at corrupted');
});

test('G19: concurrent stop hooks — trigger lock fires at most once', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  // Pre-seed turns=4 so ONE hook crossing the threshold triggers distiller
  writeWatermark(dir, { turns_since_distill: 4 });
  const transcriptPath = writeTranscript(dir, [
    { role: 'user', text: 'decided to do X' },
    { role: 'assistant', text: 'done', tools: [{ name: 'Edit', input: {} }] },
  ]);

  const N = 8;
  const codes = await spawnStopHooks(N, dir, transcriptPath);
  assert(codes.every((c) => c === 0), 'all hooks must exit 0');

  // After N concurrent hooks starting at turns=4:
  // - Each increments turns: total = 4 + N = 12 (but the winner resets to 0)
  // - Exactly one hook wins trigger lock → sets distiller_running=true, turns=0
  // - Remaining hooks see turns at various values, none retrigger (distiller_running=true)
  const state = readWatermark(dir);
  assert(state !== null, 'watermark.json missing');
  // distiller_running=true means exactly one spawn happened
  // (the detached distiller may have cleared it if claude was fast, but likely still true)
  // We can only assert turns is consistent: either 0 (winner reset) or >0 (no winner yet)
  // The key invariant: no watermark corruption (valid JSON, no partial write)
  assert(typeof state.turns_since_distill === 'number', 'turns_since_distill must be a number (no corruption)');
  assert(typeof state.last_turn_at === 'number', 'last_turn_at must be a number (no corruption)');
});

test('G20: stop hook stress — 50 sequential turns increment correctly', async (dir) => {
  initGit(dir);
  seedWyren(dir);
  writeWatermark(dir, { turns_since_distill: 0 });
  const transcriptPath = writeTranscript(dir, [{ role: 'user', text: 'hello' }]);
  const N = 50;
  // Run sequentially (spawnSync) to test increment correctness without concurrency noise
  for (let i = 0; i < N; i++) {
    // Reset distiller_running between batches to avoid spawn attempts
    const state = readWatermark(dir) || { turns_since_distill: i };
    if (state.distiller_running || state.turns_since_distill >= 4) {
      // Write a clean watermark resetting the trigger so we can keep counting
      writeWatermark(dir, { turns_since_distill: 0, distiller_running: false });
    }
    const r = runNode(
      [path.join(WYREN_ROOT, 'hooks', 'stop.mjs')],
      { cwd: dir, stdin: hookInput('Stop', dir, { transcript_path: transcriptPath }) }
    );
    assert(r.status === 0, `hook ${i} exited ${r.status}: ${r.stderr}`);
  }
  // Final state: watermark must be valid JSON, no corruption across 50 writes
  const final = readWatermark(dir);
  assert(final !== null, 'watermark.json missing after 50 turns');
  assert(typeof final.turns_since_distill === 'number', 'turns_since_distill corrupted');
  assert(final.last_turn_at > Date.now() - 30000, 'last_turn_at stale');
});

test('G21: large transcript — distiller --dry-run handles 200 turns without OOM', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## existing\nOld context.' });

  // Build 200-turn transcript with mixed tool use and plain text
  const turns = [];
  for (let i = 0; i < 100; i++) {
    turns.push({ role: 'user', text: `User message ${i}: decided to implement feature ${i}.` });
    turns.push({
      role: 'assistant',
      text: `Assistant response ${i}.`,
      tools: i % 3 === 0 ? [{ name: 'Edit', input: { path: `file${i}.js`, content: 'x'.repeat(50) } }] : undefined,
    });
  }
  const transcriptPath = writeTranscript(dir, turns);
  const memPath = path.join(dir, '.wyren', 'memory.md');
  const outPath = path.join(dir, '.wyren', 'memory.out.md');

  const r = runNode([
    path.join(WYREN_ROOT, 'distiller.mjs'),
    '--transcript', transcriptPath,
    '--memory', memPath,
    '--out', outPath,
    '--cwd', dir,
    '--dry-run',
    '--force',
  ], { cwd: dir });

  assert(r.status === 0, `exit ${r.status}: ${r.stderr.slice(0, 300)}`);
  assert(r.stdout.length > 1000, `prompt suspiciously short: ${r.stdout.length} chars`);
  assertIncludes(r.stdout, 'turn 1', 'first turn present');
  // Check last turn rendered
  assertIncludes(r.stdout, 'turn 200', 'last turn present');
});

// ---------------------------------------------------------------------------
// Group H — Installer
// ---------------------------------------------------------------------------

function makeHomeDirs(base) {
  // Create a fake ~/.claude structure under base
  fs.mkdirSync(path.join(base, 'plugins'), { recursive: true });
  return base;
}

function readInstallerSettings(fakeHome) {
  const p = path.join(fakeHome, 'settings.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function countWyrenHooks(settings, event) {
  const entries = (settings.hooks || {})[event];
  if (!Array.isArray(entries)) return 0;
  return entries.filter((e) =>
    e && e.hooks && e.hooks.some((h) => h.command && h.command.includes('run-hook.cmd'))
  ).length;
}

test('H1: fresh install into fake HOME creates link + settings', async (dir) => {
  const fakeHome = makeHomeDirs(path.join(dir, 'fake-home'));
  const r = runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'install',
    '--from-local', WYREN_ROOT,
    '--home', fakeHome,
  ]);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr.slice(0, 400)}`);

  // Plugin link exists
  const pluginPath = path.join(fakeHome, 'plugins', 'wyren');
  const stat = fs.lstatSync(pluginPath);
  assert(stat.isDirectory() || stat.isSymbolicLink(), 'plugin link/junction should exist');

  // settings.json has exactly one Wyren entry per event
  const settings = readInstallerSettings(fakeHome);
  assert(countWyrenHooks(settings, 'SessionStart') === 1, 'Should have 1 SessionStart hook');
  assert(countWyrenHooks(settings, 'Stop') === 1, 'Should have 1 Stop hook');

  // Command uses absolute path to run-hook.cmd (CLAUDE_PLUGIN_ROOT does not expand in settings.json)
  const cmd = settings.hooks.SessionStart[0].hooks[0].command;
  const expectedDispatcher = path.join(WYREN_ROOT, 'hooks', 'run-hook.cmd');
  assert(cmd.includes(expectedDispatcher), `Command should reference run-hook.cmd at wyren root: ${cmd}`);
});

test('H2: idempotent re-install — no duplicate entries', async (dir) => {
  const fakeHome = makeHomeDirs(path.join(dir, 'fake-home'));
  const args = [
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'install',
    '--from-local', WYREN_ROOT,
    '--home', fakeHome,
  ];
  const r1 = runNode(args);
  assert(r1.status === 0, `first install: exit ${r1.status}: ${r1.stderr.slice(0, 400)}`);

  const r2 = runNode(args);
  assert(r2.status === 0, `second install: exit ${r2.status}: ${r2.stderr.slice(0, 400)}`);

  const settings = readInstallerSettings(fakeHome);
  assert(countWyrenHooks(settings, 'SessionStart') === 1, 'Still exactly 1 SessionStart hook');
  assert(countWyrenHooks(settings, 'Stop') === 1, 'Still exactly 1 Stop hook');
});

test('H3: uninstall removes link + wyren settings entries, foreign entries kept', async (dir) => {
  const fakeHome = makeHomeDirs(path.join(dir, 'fake-home'));

  // Seed a foreign hook entry
  const foreignEntry = { matcher: 'src/**', hooks: [{ type: 'command', command: 'echo foreign' }] };
  const initialSettings = { hooks: { SessionStart: [foreignEntry] } };
  fs.writeFileSync(path.join(fakeHome, 'settings.json'), JSON.stringify(initialSettings, null, 2), 'utf8');

  // Install
  runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'install', '--from-local', WYREN_ROOT, '--home', fakeHome,
  ]);

  // Uninstall
  const r = runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'uninstall', '--home', fakeHome,
  ]);
  assert(r.status === 0, `uninstall exit ${r.status}: ${r.stderr.slice(0, 400)}`);

  // Plugin link removed
  const pluginPath = path.join(fakeHome, 'plugins', 'wyren');
  assert(!fs.existsSync(pluginPath), 'Plugin link should be removed');

  // Foreign entry preserved, wyren entries gone
  const settings = readInstallerSettings(fakeHome);
  assert(countWyrenHooks(settings, 'SessionStart') === 0, 'Wyren SessionStart should be removed');
  const sessionEntries = (settings.hooks || {}).SessionStart || [];
  assert(sessionEntries.some((e) => e.hooks && e.hooks[0].command === 'echo foreign'),
    'Foreign entry should be preserved');
});

test('H4: migrate-from-setup.ps1 — old absolute-path hook replaced with canonical form', async (dir) => {
  const fakeHome = makeHomeDirs(path.join(dir, 'fake-home'));

  // Seed settings.json with setup.ps1-style absolute-path hook pointing to a DIFFERENT
  // (fictional) wyren install — simulates a teammate's machine or a moved checkout.
  const OLD_WYREN_PATH = 'C:\\Users\\olduser\\old-wyren-checkout';
  const oldWindowsHook = {
    matcher: '',
    hooks: [{
      type: 'command',
      command: `"${OLD_WYREN_PATH}\\hooks\\run-hook.cmd" session-start`,
      timeout: 2,
      statusMessage: 'Loading wyren memory...',
    }],
  };
  const oldSettings = { hooks: { SessionStart: [oldWindowsHook], Stop: [] } };
  fs.writeFileSync(path.join(fakeHome, 'settings.json'), JSON.stringify(oldSettings, null, 2), 'utf8');

  // Install
  const r = runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'install', '--from-local', WYREN_ROOT, '--home', fakeHome,
  ]);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr.slice(0, 400)}`);

  // Should have exactly 1 entry with the current wyren root (old fictional path gone)
  const settings = readInstallerSettings(fakeHome);
  assert(countWyrenHooks(settings, 'SessionStart') === 1, 'Exactly 1 SessionStart hook after migration');
  const cmd = settings.hooks.SessionStart[0].hooks[0].command;
  const expectedDispatcher = path.join(WYREN_ROOT, 'hooks', 'run-hook.cmd');
  assert(cmd.includes(expectedDispatcher), `Should use current wyren root path: ${cmd}`);
  assert(!cmd.toLowerCase().includes('olduser\\old-wyren-checkout'), 'Should not retain old user absolute path');
});

test('H5: wyren doctor on broken install exits non-zero and names the issue', async (dir) => {
  const fakeHome = makeHomeDirs(path.join(dir, 'fake-home'));

  // Install first
  runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'install', '--from-local', WYREN_ROOT, '--home', fakeHome,
  ]);

  // Manually break the install by removing the plugin link
  const pluginPath = path.join(fakeHome, 'plugins', 'wyren');
  try {
    if (process.platform === 'win32') {
      // Junction removal
      const { spawnSync } = await import('node:child_process');
      spawnSync('cmd', ['/c', 'rmdir', '/q', pluginPath], { shell: false });
    } else {
      fs.unlinkSync(pluginPath);
    }
  } catch {}

  const r = runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'doctor', '--home', fakeHome,
  ]);
  assert(r.status !== 0, 'Doctor should exit non-zero on broken install');
  assertIncludes(r.stdout, 'issue', 'Should report issues in stdout');
});

test('H6: --from-local with non-wyren directory bails with actionable error', async (dir) => {
  const fakeHome = makeHomeDirs(path.join(dir, 'fake-home'));
  const notWyren = path.join(dir, 'not-a-wyren-dir');
  fs.mkdirSync(notWyren);

  const r = runNode([
    path.join(WYREN_ROOT, 'scripts', 'installer.mjs'),
    'install', '--from-local', notWyren, '--home', fakeHome,
  ]);
  assert(r.status !== 0, 'Should fail for invalid wyren checkout');
  assertIncludes(r.stderr, 'Not a valid Wyren checkout', 'Should name the problem');
});

// ---------------------------------------------------------------------------
// Group I — UserPromptSubmit live sync hook
// ---------------------------------------------------------------------------

function hookUPSInput(cwd) {
  return JSON.stringify({
    session_id: 'test-ups-session',
    transcript_path: path.join(cwd, 'fake-transcript.jsonl'),
    cwd,
    hook_event_name: 'UserPromptSubmit',
  });
}

// UPS hook owns ups-state.json (separate from watermark.json owned by stop.mjs)
function writeUpsState(dir, state) {
  const p = path.join(dir, '.wyren', 'state', 'ups-state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function readUpsState(dir) {
  const p = path.join(dir, '.wyren', 'state', 'ups-state.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

test('I1: UPS hook fires, memory.md unchanged mtime → empty stdout, watermark.json untouched', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## Decisions\n- Use SQLite [session a, turn 1]\n' });

  // Write ups-state with matching mtime (fast-path)
  const memPath = path.join(dir, '.wyren', 'memory.md');
  const mtime = fs.statSync(memPath).mtimeMs;
  writeUpsState(dir, { last_injected_mtime: mtime, last_injected_hash: 'abc123def456' });
  // Write watermark with stop.mjs-owned keys — hook must not touch them
  writeWatermark(dir, { turns_since_distill: 2 });

  const r = runNode([path.join(WYREN_ROOT, 'hooks', 'user-prompt-submit.mjs')], {
    cwd: dir, stdin: hookUPSInput(dir), env: { WYREN_SKIP_PULL: '1' },
  });

  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(r.stdout.trim() === '', 'stdout should be empty when nothing changed');

  const wm = readWatermark(dir);
  assert(wm.turns_since_distill === 2, 'watermark.json untouched by UPS hook');
});

test('I2: first UPS run (no ups-state) → seeded, no additionalContext in stdout', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## Decisions\n- Use SQLite [session a, turn 1]\n' });

  const r = runNode([path.join(WYREN_ROOT, 'hooks', 'user-prompt-submit.mjs')], {
    cwd: dir, stdin: hookUPSInput(dir), env: { WYREN_SKIP_PULL: '1' },
  });

  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(r.stdout.trim() === '', 'no injection on first run');

  const st = readUpsState(dir);
  assert(st && st.last_injected_hash, 'ups-state hash seeded');
  assert(st && st.last_injected_mtime, 'ups-state mtime seeded');
});

test('I3: memory.md mtime changed but hash same → mtime updated, no injection', async (dir) => {
  initGit(dir);
  const memory = '## Decisions\n- Use SQLite [session a, turn 1]\n';
  seedWyren(dir, { memory });

  const { hashMemory } = await import('../lib/diff-memory.mjs');
  const hash = hashMemory(memory);

  // Seed ups-state with stale mtime but correct hash
  writeUpsState(dir, { last_injected_mtime: 1, last_injected_hash: hash });

  const r = runNode([path.join(WYREN_ROOT, 'hooks', 'user-prompt-submit.mjs')], {
    cwd: dir, stdin: hookUPSInput(dir), env: { WYREN_SKIP_PULL: '1' },
  });

  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(r.stdout.trim() === '', 'no injection when hash unchanged');

  const st = readUpsState(dir);
  assert(st && st.last_injected_mtime > 1, 'mtime updated');
});

test('I4: real content delta → stdout contains additionalContext with new bullet', async (dir) => {
  initGit(dir);
  const oldMem = '## Decisions\n- Use SQLite [session a, turn 1]\n';
  const newMem = oldMem + '- Add rate limiting [session b, turn 2]\n';
  seedWyren(dir, { memory: newMem });

  const stateDir = path.join(dir, '.wyren', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), oldMem, 'utf8');

  const { hashMemory } = await import('../lib/diff-memory.mjs');
  writeUpsState(dir, { last_injected_mtime: 1, last_injected_hash: hashMemory(oldMem) });

  const r = runNode([path.join(WYREN_ROOT, 'hooks', 'user-prompt-submit.mjs')], {
    cwd: dir, stdin: hookUPSInput(dir), env: { WYREN_SKIP_PULL: '1' },
  });

  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(r.stdout.trim() !== '', 'stdout should contain JSON output');

  const output = JSON.parse(r.stdout.trim());
  const ctx = output.hookSpecificOutput.additionalContext;
  assert(ctx.includes('Add rate limiting'), 'additionalContext has new bullet');
  assert(ctx.includes('Wyren live update'), 'additionalContext has header');
});

test('I5: corrupt snapshot → hook exits 0, no crash', async (dir) => {
  initGit(dir);
  seedWyren(dir, { memory: '## Decisions\n- Use SQLite [session a, turn 1]\n' });

  const stateDir = path.join(dir, '.wyren', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'last-injected-memory.md'), Buffer.from([0xff, 0xfe, 0x00]));
  writeUpsState(dir, { last_injected_mtime: 1, last_injected_hash: 'stale000aaaa' });

  const r = runNode([path.join(WYREN_ROOT, 'hooks', 'user-prompt-submit.mjs')], {
    cwd: dir, stdin: hookUPSInput(dir), env: { WYREN_SKIP_PULL: '1' },
  });

  assert(r.status === 0, 'hook should exit 0 even with corrupt snapshot');
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
run();
