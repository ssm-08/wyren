#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';
import { isMain } from '../lib/util.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export function wyrenInit(targetDir) {
  const wyrenDir = path.join(targetDir, '.wyren');

  if (fs.existsSync(wyrenDir)) {
    console.log('Wyren already initialized.');
    return false;
  }

  // Create .wyren/memory.md — optionally seeded from existing CLAUDE.md
  fs.mkdirSync(wyrenDir, { recursive: true });

  let seedSection = '';
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  let claudeStat;
  try { claudeStat = fs.statSync(claudeMdPath); } catch {}
  if (claudeStat && claudeStat.isFile()) {
    const raw = fs.readFileSync(claudeMdPath, 'utf8');
    const MAX = 8000;
    const body = raw.length > MAX ? raw.slice(0, MAX) + '\n<!-- truncated -->' : raw;
    const trimmed = body.trim();
    if (trimmed) {
      seedSection = `\n\n## Seeded from CLAUDE.md\n\n<!-- One-time import on wyren init. Not kept in sync. -->\n\n${trimmed}`;
      console.log('  → Seeded memory.md from existing CLAUDE.md');
    }
  }

  fs.writeFileSync(
    path.join(wyrenDir, 'memory.md'),
    `# Wyren Memory\n<!-- Populated by distiller. Edit manually to seed context. -->${seedSection}\n`,
    'utf8'
  );

  // Create .wyren/broadcast/ with .gitkeep so git tracks the empty dir
  fs.mkdirSync(path.join(wyrenDir, 'broadcast'), { recursive: true });
  fs.writeFileSync(path.join(wyrenDir, 'broadcast', '.gitkeep'), '', 'utf8');

  // Create .wyren/broadcast/skills/ with .gitkeep so git tracks it before any skill is broadcast
  fs.mkdirSync(path.join(wyrenDir, 'broadcast', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(wyrenDir, 'broadcast', 'skills', '.gitkeep'), '', 'utf8');

  // Update .gitignore — idempotent
  const gitignorePath = path.join(targetDir, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch {}

  const toAdd = [];
  if (!existing.includes('.wyren/state/')) toAdd.push('.wyren/state/');
  if (!existing.includes('.wyren/log')) toAdd.push('.wyren/log');

  if (toAdd.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gitignorePath, prefix + toAdd.join('\n') + '\n', 'utf8');
  }

  console.log('Wyren initialized.\n');
  console.log('  git add .wyren/ .gitignore');
  console.log('  git commit -m "chore: add wyren shared memory"');
  console.log('  git push\n');
  console.log('Teammates install once per machine:');
  console.log('  npm install -g @ssm-08/wyren && wyren install');
  return true;
}

export function wyrenStatus(targetDir) {
  const wyrenDir = path.join(targetDir, '.wyren');

  if (!fs.existsSync(wyrenDir)) {
    console.log('Wyren not initialized in this repo. Run: wyren init');
    return;
  }

  // M6: fixed-width labels for readable demo output (11 chars + space)
  const label = (s) => s.padEnd(11);

  // Memory stats
  const memPath = path.join(wyrenDir, 'memory.md');
  if (fs.existsSync(memPath)) {
    const content = fs.readFileSync(memPath, 'utf8');
    const lines = content.split(/\r?\n/).length;
    const bytes = fs.statSync(memPath).size;
    console.log(`${label('Memory:')} .wyren/memory.md  (${(bytes / 1024).toFixed(1)} KB, ${lines} lines)`);
  } else {
    console.log(`${label('Memory:')} .wyren/memory.md  (not found)`);
  }

  // Watermark / distiller state
  const watermarkPath = path.join(wyrenDir, 'state', 'watermark.json');
  const logPath = path.join(wyrenDir, 'log');
  if (fs.existsSync(watermarkPath)) {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8')); } catch {}

    if (state.last_distilled_at) {
      const ago = Math.round((Date.now() - state.last_distilled_at) / 60_000);
      console.log(`${label('Distilled:')} ${new Date(state.last_distilled_at).toISOString()} (${ago} min ago)`);
    } else {
      console.log(`${label('Distilled:')} never`);
    }

    if (state.last_uuid) {
      console.log(`${label('Last UUID:')} ${state.last_uuid}`);
    }

    const turns = state.turns_since_distill ?? 0;
    const threshold = parseInt(process.env.WYREN_TURNS_THRESHOLD ?? '5', 10);
    const progressLine = state.distiller_running
      ? `${turns} turns (distilling now...)`
      : `${turns} / ${threshold} turns until next distill`;
    console.log(`${label('Progress:')} ${progressLine}`);

    if (state.last_transcript) {
      console.log(`${label('Transcript:')} ${state.last_transcript}`);
    }
  } else {
    console.log(`${label('Progress:')} (no state yet — run a session to start tracking)`);
  }
  const inj = getLastInjection(logPath);
  if (inj) {
    const ago = Math.round((Date.now() - inj.ts) / 60_000);
    console.log(`${label('Injected:')} ${new Date(inj.ts).toISOString()} (${ago} min ago via ${inj.event})`);
  } else {
    console.log(`${label('Injected:')} never`);
  }

  // Git remote
  try {
    const r = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: targetDir,
      encoding: 'utf8',
      windowsHide: true,
    });
    const remote = (r.stdout || '').trim();
    if (r.status === 0 && remote) {
      console.log(`${label('Remote:')} origin → ${remote}`);
    } else {
      console.log(`${label('Remote:')} (none configured)`);
    }
  } catch {
    console.log(`${label('Remote:')} (none configured)`);
  }

  // Only show lock when held — not held is the normal state, not worth showing
  const lockPath = path.join(wyrenDir, 'state', '.lock');
  if (fs.existsSync(lockPath)) {
    try {
      const age = Math.round((Date.now() - fs.statSync(lockPath).mtimeMs) / 1000);
      console.log(`${label('Lock:')} held (${age}s old)`);
    } catch {
      console.log(`${label('Lock:')} held`);
    }
  }
}

export async function wyrenDistill(targetDir, argv) {
  const wyrenDir = path.join(targetDir, '.wyren');

  if (!fs.existsSync(wyrenDir)) {
    console.error('Wyren not initialized. Run: wyren init');
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
    const watermarkPath = path.join(wyrenDir, 'state', 'watermark.json');
    try {
      const state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
      transcriptPath = state.last_transcript;
    } catch {}
  }

  if (!transcriptPath) {
    console.error('No transcript found. Start a Claude Code session in this repo first, or pass --transcript <path>.');
    process.exit(1);
  }

  const memoryPath = path.join(wyrenDir, 'memory.md');
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
      if (e.message !== 'LOCKED') console.error(`wyren distill: lock error: ${e.message}`);
      else console.error('wyren distill: sync locked by another process — retry in a moment');
      // M1: exit 2 so callers can detect that push was skipped (not conflated with success)
      process.exit(2);
    }
    try {
      sync.push(targetDir, 'manual');
    } catch (e) {
      console.error(`wyren distill: push failed: ${e.message}`);
    } finally {
      release();
    }
  }

  process.exit(result.status ?? 0);
}

export function wyrenBroadcastSkill(targetDir, filePath) {
  const wyrenDir = path.join(targetDir, '.wyren');

  if (!fs.existsSync(wyrenDir)) {
    console.error('Wyren not initialized. Run: wyren init');
    return null;
  }

  if (!filePath) {
    console.error('Usage: wyren broadcast-skill <file>');
    return null;
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
  }

  const skillName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const TEXT_EXTS = new Set(['.md', '.toml', '.txt', '.json', '.yaml', '.yml']);
  if (!TEXT_EXTS.has(ext)) {
    console.warn(`Warning: "${skillName}" has extension "${ext}" — expected a text skill file (.md, .toml). Proceeding anyway.`);
  }

  const destDir = path.join(wyrenDir, 'broadcast', 'skills');
  fs.mkdirSync(destDir, { recursive: true });

  const destPath = path.join(destDir, skillName);
  fs.copyFileSync(filePath, destPath);
  console.log(`Broadcast: .wyren/broadcast/skills/${skillName}`);
  return destPath;
}

const HELP_TEXT =
  `Usage: wyren <command>\n\nCommands:\n` +
  `  init              Initialize wyren in current repository\n` +
  `  status            Show memory, watermark, and sync state\n` +
  `  log               Show distiller log [--lines <n>] (default 50)\n` +
  `  distill           Run distiller manually [--transcript <path>] [--force] [--dry-run] [--push]\n` +
  `  broadcast-skill   Broadcast a skill file to all teammates [<file>]\n` +
  `  install           Install wyren hooks on this machine [--from-local <path>] [--home <path>]\n` +
  `  update            Update wyren to latest version\n` +
  `  uninstall         Remove wyren hooks from this machine [--yes]\n` +
  `  doctor            Verify wyren install is working correctly\n\n` +
  `Options:\n` +
  `  --version         Print wyren version\n` +
  `  --help            Show this help`;

export function wyrenVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  try {
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(`wyren ${version}`);
  } catch {
    console.log('wyren (unknown version)');
  }
}

export function wyrenLog(targetDir, argv) {
  const logPath = path.join(targetDir, '.wyren', 'log');

  let lines = 50;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--lines' || argv[i] === '-n') && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!isNaN(n) && n > 0) lines = n;
      else if (!isNaN(n)) console.error(`wyren log: --lines must be a positive integer (got ${n}), using default ${lines}`);
    }
  }

  if (!fs.existsSync(logPath)) {
    console.log('No log yet — distiller has not run in this repo.');
    return;
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const allLines = content.split(/\r?\n/);
  // Drop trailing empty line from final newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();

  if (allLines.length === 0) {
    console.log('Log is empty.');
    return;
  }

  const tail = allLines.slice(-lines);
  if (allLines.length > lines) {
    console.log(`... (${allLines.length - lines} earlier lines omitted — use --lines to show more)\n`);
  }
  const inj = getLastInjection(logPath);
  if (inj) {
    const ago = Math.round((Date.now() - inj.ts) / 60_000);
    console.log(`Last injected: ${new Date(inj.ts).toISOString()} (${ago} min ago via ${inj.event})\n`);
  }
  console.log(tail.join('\n'));
}

function getLastInjection(logPath) {
  if (!fs.existsSync(logPath)) return null;
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/^\[([^\]]+)\]\s+injection:\s+([a-z0-9-]+)\s*$/i);
    if (!m) continue;
    const ts = Date.parse(m[1]);
    if (!isNaN(ts)) return { ts, event: m[2] };
  }
  return null;
}

if (isMain(import.meta.url)) {
  const [, , command, ...rest] = process.argv;

  if (command === '--version' || command === '-v') {
    wyrenVersion();
  } else if (command === '--help' || command === '-h') {
    console.log(HELP_TEXT);
  } else if (command === 'init') {
    wyrenInit(process.cwd());
  } else if (command === 'status') {
    wyrenStatus(process.cwd());
  } else if (command === 'log') {
    wyrenLog(process.cwd(), rest);
  } else if (command === 'distill') {
    await wyrenDistill(process.cwd(), rest);
  } else if (command === 'broadcast-skill') {
    const filePath = rest[0];
    const dest = wyrenBroadcastSkill(process.cwd(), filePath);
    if (!dest) process.exit(1);
    const { GitSync } = await import('../lib/sync.mjs');
    const sync = new GitSync();
    let release = () => {};
    try {
      release = sync.lock(process.cwd());
    } catch (e) {
      if (e.message === 'LOCKED') {
        console.error('wyren: sync locked by another process');
        process.exit(2);
      }
      throw e;
    }
    try {
      sync.push(process.cwd(), 'broadcast');
      console.log('Pushed to remote.');
    } catch (e) {
      console.error(`wyren: push failed: ${e.message}`);
      process.exit(1);
    } finally {
      release();
    }
  } else if (command === 'install' || command === 'update' || command === 'uninstall' || command === 'doctor') {
    const { main: installerMain } = await import('../scripts/installer.mjs');
    await installerMain([command, ...rest]);
  } else if (command === undefined) {
    console.log(HELP_TEXT);
  } else {
    console.error(`wyren: unknown command '${command}'\n\n${HELP_TEXT}`);
    process.exit(1);
  }
}
