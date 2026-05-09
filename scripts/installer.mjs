#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { spawnSync } from 'node:child_process';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const argv1 = fs.realpathSync(path.resolve(process.argv[1]));
    const meta = fs.realpathSync(path.resolve(url.fileURLToPath(metaUrl)));
    return argv1 === meta;
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(metaUrl));
  }
}

const NPM_PACKAGE = '@ssm-08/wyren';

// --------------------------------------------------------------------------
// Logging
// --------------------------------------------------------------------------

function log(level, phase, msg) {
  const tag = level === 'err' ? ' ERR' : level === 'warn' ? '  !!' : '  OK';
  process.stderr.write(`[wyren] [${phase}]${tag}  ${msg}\n`);
}

function reporter(phase) {
  return {
    ok: (msg) => log('ok', phase, msg),
    warn: (msg) => log('warn', phase, msg),
    err: (msg) => log('err', phase, msg),
  };
}

// --------------------------------------------------------------------------
// Path helpers
// --------------------------------------------------------------------------

export function resolveHome(env = process.env) {
  return env.WYREN_HOME ?? env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
}

export function wyrenPaths(home) {
  return {
    home,
    plugin: path.join(home, 'plugins', 'wyren'),
    settings: path.join(home, 'settings.json'),
  };
}

// --------------------------------------------------------------------------
// Preflight
// --------------------------------------------------------------------------

class PreflightError extends Error {}

export function preflight() {
  const r = reporter('preflight');

  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    throw new PreflightError(
      `Node ${process.versions.node} found but >= 20 required.\n` +
      `Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm`
    );
  }
  r.ok(`Node v${process.versions.node}`);

  // git is required by wyren's sync mechanism at runtime
  const gitResult = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (gitResult.error || gitResult.status !== 0) {
    throw new PreflightError(
      'git not found on PATH. Install from https://git-scm.com/'
    );
  }
  r.ok((gitResult.stdout || '').trim());

  const claudeResult = process.platform === 'win32'
    ? spawnSync('cmd', ['/c', 'claude', '--version'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
    : spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  if (claudeResult.error || claudeResult.status !== 0) {
    r.warn('claude CLI not found — distiller will fail at runtime. Install Claude Code first.');
  } else {
    r.ok(`claude ${(claudeResult.stdout || '').trim()}`);
  }
}

// --------------------------------------------------------------------------
// Repo resolution
// --------------------------------------------------------------------------

export function validateWyrenCheckout(dir) {
  const markers = ['bin/wyren.mjs', 'hooks/run-hook.cmd', '.claude-plugin/plugin.json'];
  for (const m of markers) {
    if (!fs.existsSync(path.join(dir, m))) {
      throw new Error(
        `Not a valid Wyren checkout (missing ${m}): ${dir}\n` +
        'Pass --from-local to the Wyren repo root.'
      );
    }
  }
}

// Resolve the directory where wyren source files live.
// - --from-local: user-provided path (dev/local checkout)
// - default: package root derived from __dirname (works for npm global install)
export function resolvePackageDir(fromLocal) {
  if (fromLocal) {
    const abs = path.resolve(fromLocal);
    validateWyrenCheckout(abs);
    return abs;
  }
  return path.resolve(path.join(__dirname, '..'));
}

// --------------------------------------------------------------------------
// Symlink / junction
// --------------------------------------------------------------------------

function stripWinPathPrefix(target) {
  return target.replace(/^(?:\\\\[?]|\\[?][?])\\/, '');
}

export function inspectLink(p) {
  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) {
      let target = fs.readlinkSync(p);
      target = stripWinPathPrefix(target);
      return { kind: 'symlink', target };
    }
    if (stat.isDirectory()) {
      try {
        let target = fs.readlinkSync(p);
        target = stripWinPathPrefix(target);
        return { kind: 'junction', target };
      } catch {
        return { kind: 'dir', target: null };
      }
    }
    return { kind: 'file', target: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { kind: 'missing', target: null };
    throw e;
  }
}

export function createLink(src, dst) {
  const r = reporter('link');

  if (!fs.existsSync(src)) {
    throw new Error(`Source does not exist: ${src}`);
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });

  const existing = inspectLink(dst);
  if (existing.kind !== 'missing') {
    const normalSrc = src.replace(/\\/g, '/').replace(/\/$/, '');
    const normalTarget = (existing.target || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (normalTarget === normalSrc) {
      r.ok(`Link already correct — skipping`);
      return;
    }
    throw new Error(
      `${dst} exists and points to: ${existing.target}\n` +
      `Expected: ${src}\n` +
      'Run "wyren uninstall" first, or delete the link manually.'
    );
  }

  if (process.platform === 'win32') {
    fs.symlinkSync(src, dst, 'junction');
    r.ok(`Junction created: ${dst} → ${src}`);
  } else {
    fs.symlinkSync(src, dst, 'dir');
    r.ok(`Symlink created: ${dst} → ${src}`);
  }
}

export function removeLink(p) {
  const info = inspectLink(p);
  if (info.kind === 'missing') return;
  if (process.platform === 'win32' && info.kind === 'junction') {
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

// --------------------------------------------------------------------------
// settings.json patching
// --------------------------------------------------------------------------

const HOOK_DETECTION_PATTERNS = ['run-hook.cmd', 'run-hook.sh', 'plugins/wyren/hooks/'];

function isWyrenHookEntry(entry) {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [entry.hooks].filter(Boolean);
  return hooks.some((h) =>
    h && h.command && HOOK_DETECTION_PATTERNS.some((p) => h.command.includes(p))
  );
}

function buildHookEntries(repoDir) {
  const dispatcher = path.join(repoDir, 'hooks', 'run-hook.cmd');
  const q = `"${dispatcher}"`;
  return {
    SessionStart: {
      matcher: '',
      hooks: [{ type: 'command', command: `${q} session-start`, timeout: 4, statusMessage: 'Loading wyren memory...' }],
    },
    Stop: {
      matcher: '',
      hooks: [{ type: 'command', command: `${q} stop`, timeout: 5 }],
    },
    UserPromptSubmit: {
      matcher: '',
      hooks: [{ type: 'command', command: `${q} user-prompt-submit`, timeout: 3 }],
    },
  };
}

function stripJsoncComments(src) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < src.length) {
    if (!inString && src[i] === '"') {
      inString = true; out += src[i++]; continue;
    }
    if (inString) {
      if (src[i] === '\\') { out += src[i++] + src[i++]; continue; }
      if (src[i] === '"') inString = false;
      out += src[i++]; continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += src[i++];
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function readSettings(p) {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(stripJsoncComments(raw)); } catch (e2) {
    throw new Error(`Failed to parse ${p}: ${e2.message}`);
  }
}

export function patchSettingsInMemory(settings, { mode, repoDir = '' }) {
  const out = JSON.parse(JSON.stringify(settings));

  if (!out.hooks || typeof out.hooks !== 'object') out.hooks = {};
  const hooks = out.hooks;

  for (const event of ['SessionStart', 'Stop', 'UserPromptSubmit']) {
    let current = hooks[event];
    if (!current) current = [];
    else if (!Array.isArray(current)) current = [current];

    const filtered = current.filter((entry) => !isWyrenHookEntry(entry));

    if (mode === 'install') {
      const fresh = buildHookEntries(repoDir);
      hooks[event] = [...filtered, fresh[event]];
    } else {
      hooks[event] = filtered;
      if (filtered.length === 0) delete hooks[event];
    }
  }

  if (mode === 'uninstall' && Object.keys(hooks).length === 0) {
    delete out.hooks;
  }

  return out;
}

export function writeSettingsAtomic(p, obj, { backup = true } = {}) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });

  if (backup && fs.existsSync(p)) {
    const base = path.basename(p);
    const old = fs.readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.wyren-backup-`))
      .map((f) => path.join(dir, f));
    for (const f of old) { try { fs.unlinkSync(f); } catch {} }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(p, `${p}.wyren-backup-${ts}`);
  }

  const tmp = `${p}.tmp`;
  const content = JSON.stringify(obj, null, 2).replace(/\r\n/g, '\n') + '\n';
  fs.writeFileSync(tmp, content, { encoding: 'utf8' });
  fs.renameSync(tmp, p);
}

// --------------------------------------------------------------------------
// chmod (POSIX only)
// --------------------------------------------------------------------------

export function chmodHookDispatcher(repoDir) {
  if (process.platform === 'win32') return;
  const dispatcherPath = path.join(repoDir, 'hooks', 'run-hook.cmd');
  if (fs.existsSync(dispatcherPath)) {
    fs.chmodSync(dispatcherPath, 0o755);
  }
}

// --------------------------------------------------------------------------
// Verify
// --------------------------------------------------------------------------

export function verifyInstall(paths) {
  const issues = [];

  const info = inspectLink(paths.plugin);
  if (info.kind === 'missing') {
    issues.push(`Plugin link missing: ${paths.plugin}`);
  }

  const linkedDir = (info.target && info.kind !== 'missing') ? info.target : null;
  if (linkedDir) {
    const wyrenBin = path.join(linkedDir, 'bin', 'wyren.mjs');
    if (fs.existsSync(wyrenBin)) {
      const r = spawnSync('node', [wyrenBin, 'status'], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (r.status !== 0) {
        issues.push(`wyren CLI failed: ${(r.stderr || '').trim()}`);
      }
    } else {
      issues.push(`wyren CLI not found at: ${wyrenBin}`);
    }
  }

  try {
    const settings = readSettings(paths.settings);
    const hooksObj = settings.hooks || {};
    for (const event of ['SessionStart', 'Stop', 'UserPromptSubmit']) {
      const entries = Array.isArray(hooksObj[event]) ? hooksObj[event] : [];
      const wyrenEntries = entries.filter(isWyrenHookEntry);
      if (wyrenEntries.length === 0) {
        issues.push(`settings.json missing Wyren ${event} hook`);
      } else if (wyrenEntries.length > 1) {
        issues.push(`settings.json has ${wyrenEntries.length} Wyren ${event} hooks (expected 1)`);
      }
    }
  } catch (e) {
    issues.push(`settings.json unreadable: ${e.message}`);
  }

  if (process.platform !== 'win32' && linkedDir) {
    const dispatcher = path.join(linkedDir, 'hooks', 'run-hook.cmd');
    if (fs.existsSync(dispatcher)) {
      try {
        fs.accessSync(dispatcher, fs.constants.X_OK);
      } catch {
        issues.push(`Hook dispatcher not executable: ${dispatcher} — run: chmod +x ${dispatcher}`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

// --------------------------------------------------------------------------
// CLI registration — for --from-local dev installs only
// --------------------------------------------------------------------------

export function registerCli(repoDir, r) {
  const [npmExe, npmArgs] = process.platform === 'win32'
    ? ['cmd', ['/c', 'npm', 'link']]
    : ['npm', ['link']];
  const result = spawnSync(npmExe, npmArgs, {
    cwd: repoDir,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    const npmErr = (result.stderr || result.stdout || '').trim().slice(0, 500);
    r.warn(
      `Could not register wyren CLI globally (npm link failed).\n` +
      (npmErr ? `  npm: ${npmErr}\n` : '') +
      `  Run manually: cd "${repoDir}" && npm link\n` +
      `  Or invoke directly: node "${path.join(repoDir, 'bin', 'wyren.mjs')}" <command>`
    );
  } else {
    r.ok('wyren CLI registered globally via npm link (wyren <command> now works)');
  }
}

// --------------------------------------------------------------------------
// Orchestrators
// --------------------------------------------------------------------------

export function install(opts) {
  const { home, fromLocal, dryRun } = opts;
  const r = reporter('install');
  const paths = wyrenPaths(home);

  r.ok(`Home: ${home}`);
  preflight();

  const repoDir = resolvePackageDir(fromLocal);
  r.ok(`${fromLocal ? 'Repo (local)' : 'Repo'}: ${repoDir}`);

  chmodHookDispatcher(repoDir);

  if (!dryRun) {
    createLink(repoDir, paths.plugin);

    const settings = readSettings(paths.settings);
    const patched = patchSettingsInMemory(settings, { mode: 'install', repoDir });
    writeSettingsAtomic(paths.settings, patched);
    r.ok(`settings.json updated`);
  } else {
    r.ok('[dry-run] would create link + patch settings');
  }

  const result = verifyInstall(paths);
  if (!dryRun && !result.ok) {
    for (const issue of result.issues) r.warn(`Verify: ${issue}`);
  } else if (!dryRun) {
    r.ok('Verified install');
  }

  // For --from-local dev installs, wire the CLI via npm link.
  // npm global installs already have wyren on PATH — skip.
  // WYREN_SKIP_CLI_REGISTER=1 lets e2e tests skip the slow global npm mutation.
  if (!dryRun && fromLocal && !process.env.WYREN_SKIP_CLI_REGISTER) {
    registerCli(repoDir, reporter('cli'));
  }

  if (!dryRun) {
    let repoHint = '';
    try {
      const gitTop = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8', windowsHide: true, timeout: 3_000,
      });
      const top = (gitTop.stdout || '').trim();
      if (gitTop.status === 0 && top && !top.startsWith(repoDir)) {
        repoHint = top;
      }
    } catch {}

    process.stderr.write('\n[wyren] Install complete.\n\n');
    if (repoHint) {
      process.stderr.write(`  Detected repo: ${repoHint}\n`);
      process.stderr.write(`  Run from that directory:\n\n`);
    } else {
      process.stderr.write('  Next — cd into your project repo, then:\n\n');
    }
    process.stderr.write('    wyren init\n');
    process.stderr.write('    git add .wyren/ .gitignore\n');
    process.stderr.write('    git commit -m "chore: add wyren shared memory"\n');
    process.stderr.write('    git push\n\n');
    process.stderr.write('  Verify: wyren doctor\n');
  }
  return result;
}

export function uninstall(opts) {
  const { home, dryRun } = opts;
  const r = reporter('uninstall');
  const paths = wyrenPaths(home);

  if (!dryRun) {
    removeLink(paths.plugin);
    r.ok(`Removed link: ${paths.plugin}`);

    if (fs.existsSync(paths.settings)) {
      const settings = readSettings(paths.settings);
      const patched = patchSettingsInMemory(settings, { mode: 'uninstall' });
      writeSettingsAtomic(paths.settings, patched, { backup: false });
      r.ok(`Removed wyren entries from settings.json`);
    }

    // Deregister global CLI — fail-open
    const [npmExe, npmArgs] = process.platform === 'win32'
      ? ['cmd', ['/c', 'npm', 'uninstall', '-g', NPM_PACKAGE]]
      : ['npm', ['uninstall', '-g', NPM_PACKAGE]];
    const npmResult = spawnSync(npmExe, npmArgs, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    if (!npmResult.error && npmResult.status === 0) {
      r.ok('wyren CLI deregistered from global PATH');
    } else {
      r.warn(`Could not deregister wyren CLI — remove manually: npm uninstall -g ${NPM_PACKAGE}`);
    }

    // Clean up settings backup files
    const settingsDir = path.dirname(paths.settings);
    const settingsBase = path.basename(paths.settings);
    try {
      const backups = fs.readdirSync(settingsDir)
        .filter((f) => f.startsWith(`${settingsBase}.wyren-backup-`));
      for (const f of backups) {
        try { fs.unlinkSync(path.join(settingsDir, f)); } catch {}
      }
      if (backups.length > 0) r.ok(`Removed ${backups.length} settings backup(s)`);
    } catch {}
  } else {
    r.ok(`[dry-run] would remove link + strip settings entries + npm uninstall -g ${NPM_PACKAGE} + remove backups`);
  }
}

export function update(opts) {
  const { home } = opts;
  const r = reporter('update');
  const paths = wyrenPaths(home);

  const linkInfo = inspectLink(paths.plugin);
  if (linkInfo.kind === 'missing') {
    throw new Error('Wyren not installed. Run: wyren install');
  }

  // Detect --from-local install: link target does not pass through node_modules
  const isNpmInstall = linkInfo.target && linkInfo.target.includes('node_modules');
  if (!isNpmInstall) {
    throw new Error(
      `Local install detected — plugin points to: ${linkInfo.target}\n` +
      `  wyren update only works for npm installs.\n` +
      `  Pull your local checkout manually, then re-run:\n` +
      `    wyren install --from-local "${linkInfo.target}"`
    );
  }

  r.ok(`Updating ${NPM_PACKAGE} via npm...`);
  const [npmExe, npmArgs] = process.platform === 'win32'
    ? ['cmd', ['/c', 'npm', 'update', '-g', NPM_PACKAGE]]
    : ['npm', ['update', '-g', NPM_PACKAGE]];
  const npmResult = spawnSync(npmExe, npmArgs, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    stdio: 'inherit',
  });
  if (npmResult.error || npmResult.status !== 0) {
    throw new Error(`npm update failed. Try manually: npm update -g ${NPM_PACKAGE}`);
  }

  // Re-derive repoDir from __dirname — path is stable across npm updates for global installs
  const repoDir = path.resolve(path.join(__dirname, '..'));
  chmodHookDispatcher(repoDir);

  const settings = readSettings(paths.settings);
  const patched = patchSettingsInMemory(settings, { mode: 'install', repoDir });
  writeSettingsAtomic(paths.settings, patched);
  r.ok('settings.json refreshed');

  const result = verifyInstall(paths);
  if (!result.ok) {
    for (const issue of result.issues) r.warn(`Verify: ${issue}`);
  } else {
    r.ok('Verified install after update');
  }
  return result;
}

function issueHint(issue) {
  if (issue.includes('Plugin link missing')) return 'wyren install';
  if (issue.includes('wyren CLI')) return 'wyren install';
  if (issue.includes('settings.json missing Wyren')) return 'wyren install';
  if (issue.includes('settings.json has') && issue.includes('hooks')) return 'wyren uninstall && wyren install';
  if (issue.includes('not executable')) {
    const m = issue.match(/: (.+?) —/);
    return m ? `chmod +x "${m[1]}"` : 'wyren install';
  }
  if (issue.includes('settings.json unreadable')) return 'Check settings.json is valid JSON, then: wyren install';
  return 'wyren install';
}

export function doctor(opts) {
  const { home } = opts;
  const paths = wyrenPaths(home);
  const result = verifyInstall(paths);

  const claudeCheck = process.platform === 'win32'
    ? spawnSync('cmd', ['/c', 'claude', '--version'], { encoding: 'utf8', windowsHide: true, timeout: 3_000 })
    : spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 3_000 });
  const claudeOk = !claudeCheck.error && claudeCheck.status === 0;

  if (result.ok && claudeOk) {
    process.stdout.write('[wyren] doctor: all checks passed\n');
  } else {
    if (!result.ok) {
      process.stdout.write(`[wyren] doctor: ${result.issues.length} issue(s) found:\n`);
      for (const issue of result.issues) {
        process.stdout.write(`  - ${issue}\n`);
        process.stdout.write(`    Fix: ${issueHint(issue)}\n`);
      }
    }
    if (!claudeOk) {
      process.stdout.write('  ! claude CLI not found — distiller will not run\n');
      process.stdout.write('    Fix: Install Claude Code from https://claude.ai/download\n');
    }
    if (!result.ok) {
      process.stdout.write('\n  Run: wyren install to repair most issues.\n');
    }
  }
  return result;
}

// --------------------------------------------------------------------------
// CLI entry
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = val;
      i++;
    }
  }
  return out;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const [command] = args._;
  const home = resolveHome(
    args.home
      ? { ...process.env, WYREN_HOME: args.home }
      : process.env
  );

  const opts = {
    home,
    fromLocal: args['from-local'] && args['from-local'] !== true ? args['from-local'] : null,
    force: !!args.force,
    dryRun: !!args['dry-run'],
  };

  try {
    switch (command) {
      case 'install': {
        const installResult = install(opts);
        if (installResult && !installResult.ok) process.exit(1);
        break;
      }
      case 'uninstall': {
        uninstall(opts);
        break;
      }
      case 'update': {
        const updateResult = update(opts);
        if (updateResult && !updateResult.ok) process.exit(1);
        break;
      }
      case 'verify':
      case 'doctor': {
        const result = doctor(opts);
        process.exit(result.ok ? 0 : 1);
        break;
      }
      default:
        process.stderr.write(
          'Usage: node scripts/installer.mjs <install|uninstall|update|doctor>\n' +
          '  --from-local <path>  Use local wyren checkout (dev only)\n' +
          '  --home <path>        Override ~/.claude/ location (for testing)\n' +
          '  --dry-run            Preview actions without making changes\n'
        );
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof Error && e.constructor.name === 'PreflightError') {
      process.stderr.write(`[wyren] preflight failed: ${e.message}\n`);
    } else {
      process.stderr.write(`[wyren] error: ${e && e.message ? e.message : e}\n`);
    }
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  await main(process.argv.slice(2));
}
