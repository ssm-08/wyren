#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage() {
  console.log('Usage: node sim/setup.mjs [--base <path>] [--keep] [--help]');
  console.log('');
  console.log('Options:');
  console.log('  --base <path>  Target base directory (default: tmpdir/wyren-sim-<timestamp>)');
  console.log('  --keep         Reuse existing base directory instead of erroring');
  console.log('  --help         Print usage and exit');
}

function parseArgs(argv) {
  const result = { base: null, keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { result.help = true; }
    else if (argv[i] === '--keep') { result.keep = true; }
    else if (argv[i] === '--base' && argv[i + 1]) { result.base = argv[++i]; }
  }
  return result;
}

function run(cmd, args, cwd, label) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) {
    console.error(`[error] ${label}`);
    if (r.error) console.error(r.error.message);
    else if (r.stderr) console.error(r.stderr.trim());
    process.exit(1);
  }
  return r;
}

function tryRun(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function toBareUrl(dir) {
  // file:/// URLs require forward slashes on all platforms
  return 'file:///' + dir.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage();
  process.exit(0);
}

// Step 2: confirm branch is feature/two-session-sim
const branchR = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
});
const branch = (branchR.stdout || '').trim();
if (branch !== 'feature/two-session-sim') {
  console.error(`[error] Expected branch feature/two-session-sim, got: ${branch || 'unknown'}`);
  console.error('        Switch to that branch before running setup.');
  process.exit(1);
}

// Step 3: resolve + create base dir
const base = args.base ? path.resolve(args.base) : path.join(os.tmpdir(), `wyren-sim-${Date.now()}`);

if (fs.existsSync(base)) {
  if (!args.keep) {
    console.error(`[error] Base directory already exists: ${base}`);
    console.error('        Pass --keep to reuse it, or choose a different --base.');
    process.exit(1);
  }
} else {
  fs.mkdirSync(base, { recursive: true });
}

// Step 4: create bare repo
const bare = path.join(base, 'bare.git');
fs.mkdirSync(bare, { recursive: true });
run('git', ['init', '--bare', '-q'], bare, 'git init --bare inside bare.git');
run('git', ['config', 'core.autocrlf', 'false'], bare, 'git config autocrlf in bare');

const bareUrl = toBareUrl(bare);

// Step 5: create dev-a
const devA = path.join(base, 'dev-a');
fs.mkdirSync(devA, { recursive: true });

// git init -b master; fallback for git < 2.28
const initA = tryRun('git', ['init', '-b', 'master', '-q'], devA);
if (initA.error || initA.status !== 0) {
  run('git', ['init', '-q'], devA, 'git init in dev-a (fallback)');
  run('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], devA, 'set master branch in dev-a');
}

run('git', ['config', 'user.email', 'sim@local'], devA, 'git config user.email in dev-a');
run('git', ['config', 'user.name', 'sim'], devA, 'git config user.name in dev-a');
run('git', ['config', 'core.autocrlf', 'false'], devA, 'git config autocrlf in dev-a');
run('git', ['config', 'core.eol', 'lf'], devA, 'git config eol in dev-a');

const starterDir = path.join(__dirname, 'starter');
copyDir(starterDir, devA);

run('git', ['add', '.'], devA, 'git add starter files in dev-a');
run('git', ['commit', '-m', 'feat(starter): initial counter app'], devA, 'git commit starter in dev-a');
run('git', ['remote', 'add', 'origin', bareUrl], devA, 'git remote add origin in dev-a');
run('git', ['push', '-u', 'origin', 'master'], devA, 'git push starter to bare');

// Step 6: create dev-b via clone
const devB = path.join(base, 'dev-b');
fs.mkdirSync(devB, { recursive: true });
run('git', ['clone', bareUrl, '.'], devB, 'git clone bare into dev-b');
run('git', ['config', 'user.email', 'sim@local'], devB, 'git config user.email in dev-b');
run('git', ['config', 'user.name', 'sim'], devB, 'git config user.name in dev-b');
run('git', ['config', 'core.autocrlf', 'false'], devB, 'git config autocrlf in dev-b');
run('git', ['config', 'core.eol', 'lf'], devB, 'git config eol in dev-b');

// Step 7: wyren init in dev-a, commit + push
run('node', [path.join(repoRoot, 'bin', 'wyren.mjs'), 'init'], devA, 'wyren init in dev-a');
run('git', ['add', '.wyren/', '.gitignore'], devA, 'git add .wyren/ in dev-a');
run('git', ['commit', '-m', 'feat(wyren): init memory'], devA, 'git commit wyren init in dev-a');
run('git', ['push'], devA, 'git push wyren init to bare');

// Step 8: dev-b pulls wyren init + verify
run('git', ['pull', 'origin', 'master'], devB, 'git pull in dev-b');
const memPath = path.join(devB, '.wyren', 'memory.md');
if (!fs.existsSync(memPath)) {
  console.error('[error] .wyren/memory.md not found in dev-b after pull');
  process.exit(1);
}

// Step 9: create shared log file
const logPath = path.join(base, 'wyren-sim-log.md');
fs.writeFileSync(logPath, '', 'utf8');

// Step 10: write .last-base for teardown
const lastBasePath = path.join(__dirname, '.last-base');
fs.writeFileSync(lastBasePath, base, 'utf8');

// Step 11: print runbook
console.log('');
console.log(`[ok] base:    ${base}`);
console.log(`[ok] bare:    ${bare}`);
console.log(`[ok] dev-a:   ${devA}   (paste sim/prompts/dev-a.md here)`);
console.log(`[ok] dev-b:   ${devB}   (paste sim/prompts/dev-b.md here)`);
console.log(`[ok] log:     ${logPath}`);
console.log('');
console.log('Next steps:');
console.log(`  1. Open Claude Code, cd to ${devA}, paste sim/prompts/dev-a.md.`);
console.log(`  2. Open a second Claude Code, cd to ${devB}, paste sim/prompts/dev-b.md.`);
console.log('  3. Conduct the rounds with "GO" cues per the prompts.');
console.log('  4. When the sim is done, run: node sim/teardown.mjs --yes');
console.log('');
