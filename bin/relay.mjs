#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { isMain } from '../lib/util.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export function relayInit(targetDir) {
  const relayDir = path.join(targetDir, '.relay');

  if (fs.existsSync(relayDir)) {
    console.log('Relay already initialized.');
    return false;
  }

  // Create .relay/memory.md
  fs.mkdirSync(relayDir, { recursive: true });
  fs.writeFileSync(
    path.join(relayDir, 'memory.md'),
    '# Relay Memory\n<!-- Populated by distiller. Edit manually to seed context. -->\n',
    'utf8'
  );

  // Create .relay/broadcast/ with .gitkeep so git tracks the empty dir
  fs.mkdirSync(path.join(relayDir, 'broadcast'), { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'broadcast', '.gitkeep'), '', 'utf8');

  // Update .gitignore — idempotent
  const gitignorePath = path.join(targetDir, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch {}

  const toAdd = [];
  if (!existing.includes('.relay/state/')) toAdd.push('.relay/state/');
  if (!existing.includes('.relay/log')) toAdd.push('.relay/log');

  if (toAdd.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gitignorePath, prefix + toAdd.join('\n') + '\n', 'utf8');
  }

  console.log('Relay initialized. Run: git add .relay/memory.md && git commit');
  return true;
}

export function relayStatus(targetDir) {
  const relayDir = path.join(targetDir, '.relay');

  if (!fs.existsSync(relayDir)) {
    console.log('Relay not initialized in this repo. Run: relay init');
    return;
  }

  // M6: fixed-width labels for readable demo output (11 chars + space)
  const label = (s) => s.padEnd(11);

  // Memory stats
  const memPath = path.join(relayDir, 'memory.md');
  if (fs.existsSync(memPath)) {
    const content = fs.readFileSync(memPath, 'utf8');
    const lines = content.split(/\r?\n/).length;
    const bytes = fs.statSync(memPath).size;
    console.log(`${label('Memory:')} .relay/memory.md  (${(bytes / 1024).toFixed(1)} KB, ${lines} lines)`);
  } else {
    console.log(`${label('Memory:')} .relay/memory.md  (not found)`);
  }

  // Watermark / distiller state
  const watermarkPath = path.join(relayDir, 'state', 'watermark.json');
  if (fs.existsSync(watermarkPath)) {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8')); } catch {}

    if (state.last_distilled_at) {
      const ago = Math.round((Date.now() - state.last_distilled_at) / 60_000);
      console.log(`${label('Distilled:')} ${new Date(state.last_distilled_at).toISOString()} (${ago} min ago)`);
    } else {
      console.log(`${label('Distilled:')} never`);
    }

    console.log(`${label('Last UUID:')} ${state.last_uuid || '(none)'}`);
    console.log(
      `${label('Watermark:')} turns_since_distill=${state.turns_since_distill ?? 0}` +
      `, distiller_running=${!!state.distiller_running}`
    );

    if (state.last_transcript) {
      console.log(`${label('Transcript:')} ${state.last_transcript}`);
    }
  } else {
    console.log(`${label('Watermark:')} (no state yet)`);
  }

  // Git remote
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    console.log(`${label('Remote:')} origin → ${remote}`);
  } catch {
    console.log(`${label('Remote:')} (none configured)`);
  }

  // Lock
  const lockPath = path.join(relayDir, 'state', '.lock');
  if (fs.existsSync(lockPath)) {
    try {
      const age = Math.round((Date.now() - fs.statSync(lockPath).mtimeMs) / 1000);
      console.log(`${label('Lock:')} held (${age}s old)`);
    } catch {
      console.log(`${label('Lock:')} (unknown)`);
    }
  } else {
    console.log(`${label('Lock:')} not held`);
  }
}

export async function relayDistill(targetDir, argv) {
  const relayDir = path.join(targetDir, '.relay');

  if (!fs.existsSync(relayDir)) {
    console.error('Relay not initialized. Run: relay init');
    process.exit(1);
  }

  // Parse flags
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') { flags.force = true; continue; }
    if (a === '--dry-run') { flags.dryRun = true; continue; }
    if (a === '--push') { flags.push = true; continue; }
    if (a === '--transcript' && argv[i + 1]) { flags.transcript = argv[++i]; continue; }
  }

  // Resolve transcript path
  let transcriptPath = flags.transcript;
  if (!transcriptPath) {
    const watermarkPath = path.join(relayDir, 'state', 'watermark.json');
    try {
      const state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
      transcriptPath = state.last_transcript;
    } catch {}
  }

  if (!transcriptPath) {
    console.error('No transcript found. Use: relay distill --transcript <path>');
    process.exit(1);
  }

  const memoryPath = path.join(relayDir, 'memory.md');
  const distillerPath = path.join(__dirname, '..', 'distiller.mjs');

  const args = [
    distillerPath,
    '--transcript', transcriptPath,
    '--memory', memoryPath,
    '--out', memoryPath,
    '--cwd', targetDir,
  ];
  if (flags.force) args.push('--force');
  if (flags.dryRun) args.push('--dry-run');

  const result = spawnSync('node', args, { stdio: 'inherit' });

  if (flags.push && result.status === 0 && !flags.dryRun) {
    const { GitSync } = await import('../lib/sync.mjs');
    const sync = new GitSync();
    let release = () => {};
    try { release = sync.lock(targetDir); } catch (e) {
      if (e.message !== 'LOCKED') console.error(`relay distill: lock error: ${e.message}`);
      else console.error('relay distill: sync locked by another process');
      // M1: exit 2 so callers can detect that push was skipped (not conflated with success)
      process.exit(2);
    }
    try {
      sync.push(targetDir, 'manual');
    } catch (e) {
      console.error(`relay distill: push failed: ${e.message}`);
    } finally {
      release();
    }
  }

  process.exit(result.status ?? 0);
}

if (isMain(import.meta.url)) {
  const [, , command, ...rest] = process.argv;

  if (command === 'init') {
    relayInit(process.cwd());
  } else if (command === 'status') {
    relayStatus(process.cwd());
  } else if (command === 'distill') {
    await relayDistill(process.cwd(), rest);
  } else {
    console.error(
      `Usage: relay <command>\n\nCommands:\n` +
      `  init      Initialize relay in current repository\n` +
      `  status    Show memory, watermark, and sync state\n` +
      `  distill   Run distiller manually [--transcript <path>] [--force] [--dry-run] [--push]`
    );
    process.exit(1);
  }
}
