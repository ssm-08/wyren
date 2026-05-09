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
  console.log('Usage: node sim/setup.mjs [--base <path>] [--help]');
  console.log('');
  console.log('Options:');
  console.log('  --base <path>  Target base directory (default: tmpdir/wyren-sim-<timestamp>)');
  console.log('  --help         Print usage and exit');
}

function parseArgs(argv) {
  const result = { base: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { result.help = true; }
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

// Confirm branch is feature/two-session-sim
const branchR = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
});
const repoBranch = (branchR.stdout || '').trim();
if (repoBranch !== 'feature/two-session-sim') {
  console.error(`[error] Expected branch feature/two-session-sim, got: ${repoBranch || 'unknown'}`);
  console.error('        Switch to that branch before running setup.');
  process.exit(1);
}

// Resolve + create base dir (create if absent; reuse if present — tests pre-create via mkdtempSync)
const base = args.base ? path.resolve(args.base) : path.join(os.tmpdir(), `wyren-sim-${Date.now()}`);
fs.mkdirSync(base, { recursive: true });

// Create bare repo
const bare = path.join(base, 'bare.git');
fs.mkdirSync(bare, { recursive: true });
run('git', ['init', '--bare', '-q'], bare, 'git init --bare inside bare.git');
run('git', ['config', 'core.autocrlf', 'false'], bare, 'git config autocrlf in bare');

const bareUrl = toBareUrl(bare);

// Create workspace-a
const workspaceA = path.join(base, 'workspace-a');
fs.mkdirSync(workspaceA, { recursive: true });

// git init -b master; fallback for git < 2.28
const initA = tryRun('git', ['init', '-b', 'master', '-q'], workspaceA);
if (initA.error || initA.status !== 0) {
  run('git', ['init', '-q'], workspaceA, 'git init in workspace-a (fallback)');
  run('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], workspaceA, 'set master branch in workspace-a');
}

run('git', ['config', 'user.email', 'sim@local'], workspaceA, 'git config user.email in workspace-a');
run('git', ['config', 'user.name', 'sim'], workspaceA, 'git config user.name in workspace-a');
run('git', ['config', 'core.autocrlf', 'false'], workspaceA, 'git config autocrlf in workspace-a');
run('git', ['config', 'core.eol', 'lf'], workspaceA, 'git config eol in workspace-a');

// Copy starter app into workspace-a as the shared project
const starterDir = path.join(__dirname, 'starter');
copyDir(starterDir, workspaceA);

run('git', ['add', '.'], workspaceA, 'git add starter files in workspace-a');
run('git', ['commit', '-m', 'feat(starter): initial counter app'], workspaceA, 'git commit starter in workspace-a');
run('git', ['remote', 'add', 'origin', bareUrl], workspaceA, 'git remote add origin in workspace-a');
run('git', ['push', '-u', 'origin', 'HEAD'], workspaceA, 'git push starter to bare');

// Detect actual branch name after push
const actualBranchR = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  cwd: workspaceA,
  encoding: 'utf8',
  windowsHide: true,
});
const simBranch = (actualBranchR.stdout || '').trim() || 'master';

// Create workspace-b via clone
const workspaceB = path.join(base, 'workspace-b');
fs.mkdirSync(workspaceB, { recursive: true });
run('git', ['clone', bareUrl, '.'], workspaceB, 'git clone bare into workspace-b');
run('git', ['config', 'user.email', 'sim@local'], workspaceB, 'git config user.email in workspace-b');
run('git', ['config', 'user.name', 'sim'], workspaceB, 'git config user.name in workspace-b');
run('git', ['config', 'core.autocrlf', 'false'], workspaceB, 'git config autocrlf in workspace-b');
run('git', ['config', 'core.eol', 'lf'], workspaceB, 'git config eol in workspace-b');

// wyren init in workspace-a, commit + push
run('node', [path.join(repoRoot, 'bin', 'wyren.mjs'), 'init'], workspaceA, 'wyren init in workspace-a');
run('git', ['add', '.wyren/', '.gitignore'], workspaceA, 'git add .wyren/ in workspace-a');
run('git', ['commit', '-m', 'feat(wyren): init memory'], workspaceA, 'git commit wyren init in workspace-a');
run('git', ['push'], workspaceA, 'git push wyren init to bare');

// workspace-b pulls wyren init
run('git', ['pull', 'origin', simBranch], workspaceB, 'git pull in workspace-b');

// Verify both workspaces have .wyren/memory.md
const memA = path.join(workspaceA, '.wyren', 'memory.md');
const memB = path.join(workspaceB, '.wyren', 'memory.md');
if (!fs.existsSync(memA)) {
  console.error('[error] .wyren/memory.md not found in workspace-a');
  process.exit(1);
}
if (!fs.existsSync(memB)) {
  console.error('[error] .wyren/memory.md not found in workspace-b after pull');
  process.exit(1);
}

// Create shared sim log file
const logPath = path.join(base, 'sim-log.md');
fs.writeFileSync(logPath, '', 'utf8');

// Write .simbase in baseDir for teardown
fs.writeFileSync(path.join(base, '.simbase'), base, 'utf8');

// Also write sim/.last-base for teardown fallback (no --base given)
const lastBasePath = path.join(__dirname, '.last-base');
fs.writeFileSync(lastBasePath, base, 'utf8');

// Print runbook
console.log('');
console.log(`[ok] base:        ${base}`);
console.log(`[ok] bare:        ${bare}`);
console.log(`[ok] workspace-a: ${workspaceA}   (Dev A — paste sim/prompts/dev-a.md)`);
console.log(`[ok] workspace-b: ${workspaceB}   (Dev B — paste sim/prompts/dev-b.md)`);
console.log(`[ok] sim-log:     ${logPath}`);
console.log('');
console.log('Next steps:');
console.log(`  1. Open Claude Code, cd to ${workspaceA}, paste sim/prompts/dev-a.md.`);
console.log(`  2. Open a second Claude Code, cd to ${workspaceB}, paste sim/prompts/dev-b.md.`);
console.log('  3. Conduct the rounds with "GO" cues per the prompts.');
console.log('  4. When the sim is done, run: node sim/teardown.mjs --yes');
console.log('');
