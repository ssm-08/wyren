#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { spawnSync } from 'node:child_process';
import { isMain } from '../lib/util.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_URL = 'https://github.com/ssm-08/relay';

// --------------------------------------------------------------------------
// Logging
// --------------------------------------------------------------------------

function log(level, phase, msg) {
  const tag = level === 'err' ? ' ERR' : level === 'warn' ? '  !!' : '  OK';
  process.stderr.write(`[relay] [${phase}]${tag}  ${msg}\n`);
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
  return env.RELAY_HOME ?? env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
}

export function relayPaths(home) {
  return {
    home,
    clone: path.join(home, 'relay'),
    plugin: path.join(home, 'plugins', 'relay'),
    settings: path.join(home, 'settings.json'),
  };
}

// --------------------------------------------------------------------------
// Preflight
// --------------------------------------------------------------------------

class PreflightError extends Error {}

export function preflight() {
  const r = reporter('preflight');

  // Node version — check via process.versions (already running in the right Node)
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    throw new PreflightError(
      `Node ${process.versions.node} found but >= 20 required.\n` +
      `Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm`
    );
  }
  r.ok(`Node v${process.versions.node}`);

  // git
  const gitResult = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (gitResult.error || gitResult.status !== 0) {
    throw new PreflightError(
      'git not found on PATH. Install from https://git-scm.com/'
    );
  }
  r.ok((gitResult.stdout || '').trim());

  // claude CLI — warn only. Use cmd /c on Windows to avoid DEP0190 (shell+args deprecation).
  const claudeResult = process.platform === 'win32'
    ? spawnSync('cmd', ['/c', 'claude', '--version'], { encoding: 'utf8' })
    : spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (claudeResult.error || claudeResult.status !== 0) {
    r.warn('claude CLI not found — distiller will fail at runtime. Install Claude Code first.');
  } else {
    r.ok(`claude ${(claudeResult.stdout || '').trim()}`);
  }
}

// --------------------------------------------------------------------------
// Git helper (mirrors lib/sync.mjs pattern, kept local to avoid coupling)
// --------------------------------------------------------------------------

function git(args, cwd, { timeout = 10_000 } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const msg = (r.stderr || '').trim() || `git exit ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return (r.stdout || '').trim();
}

// --------------------------------------------------------------------------
// Repo resolution
// --------------------------------------------------------------------------

export function validateRelayCheckout(dir) {
  const markers = ['bin/relay.mjs', 'hooks/run-hook.cmd', '.claude-plugin/plugin.json'];
  for (const m of markers) {
    if (!fs.existsSync(path.join(dir, m))) {
      throw new Error(
        `Not a valid Relay checkout (missing ${m}): ${dir}\n` +
        'Pass --from-local to the Relay repo root.'
      );
    }
  }
}

export function cloneOrUpdate(dest, { ref = 'master', force = false } = {}) {
  const r = reporter('clone');
  if (!fs.existsSync(dest)) {
    r.ok(`Cloning ${REPO_URL} → ${dest}`);
    // macOS first-run may trigger xcode-select; print hint before spawning git
    if (process.platform === 'darwin') {
      process.stderr.write(
        '[relay] [clone]  TIP  If macOS shows a Command Line Tools dialog, install it and re-run.\n'
      );
    }
    git(['clone', '--depth=1', '--branch', ref, REPO_URL, dest]);
    r.ok(`Cloned (${ref})`);
    return;
  }

  // Check dirty
  let dirty = false;
  try {
    const status = git(['status', '--porcelain'], dest, { timeout: 5_000 });
    dirty = status.trim().length > 0;
  } catch {}

  if (dirty && !force) {
    throw new Error(
      `Clone at ${dest} has local changes. Commit or stash them, or pass --force to overwrite.\n` +
      'This usually means you were dogfooding — your edits are safe, just stash first.'
    );
  }

  r.ok(`Updating ${dest}`);
  try {
    git(['fetch', '--depth=1', 'origin', ref], dest, { timeout: 15_000 });
    git(['reset', '--hard', 'FETCH_HEAD'], dest, { timeout: 5_000 });
    r.ok(`Updated to latest ${ref}`);
  } catch (e) {
    r.warn(`Update failed: ${e.message} — proceeding with existing clone`);
  }
}

export function resolveRepoDir({ fromLocal, clone, force }) {
  if (fromLocal) {
    const abs = path.resolve(fromLocal);
    validateRelayCheckout(abs);
    return abs;
  }
  cloneOrUpdate(clone, { force });
  return clone;
}

// --------------------------------------------------------------------------
// Symlink / junction
// --------------------------------------------------------------------------

export function inspectLink(p) {
  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) {
      let target = fs.readlinkSync(p);
      // Strip Windows extended-path prefix \\?\
      target = target.replace(/^\\\\\?\\/, '');
      return { kind: 'symlink', target };
    }
    if (stat.isDirectory()) {
      // Could be a junction (Windows) — junctions look like directories in lstat
      // Try readlink; if it succeeds it's a reparse point
      try {
        let target = fs.readlinkSync(p);
        target = target.replace(/^\\\\\?\\/, '');
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
      'Run "relay uninstall" first, or delete the link manually.'
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
    // Node <22: fs.unlinkSync fails on junctions; rmdirSync works
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

// --------------------------------------------------------------------------
// settings.json patching
// --------------------------------------------------------------------------

const HOOK_DETECTION_PATTERNS = ['run-hook.cmd', 'run-hook.sh', 'plugins/relay/hooks/'];

function isRelayHookEntry(entry) {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [entry.hooks].filter(Boolean);
  return hooks.some((h) =>
    h && h.command && HOOK_DETECTION_PATTERNS.some((p) => h.command.includes(p))
  );
}

function buildHookEntries() {
  return {
    SessionStart: {
      matcher: '',
      hooks: [{
        type: 'command',
        command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
        timeout: 2,
        statusMessage: 'Loading relay memory...',
      }],
    },
    Stop: {
      matcher: '',
      hooks: [{
        type: 'command',
        command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" stop',
        timeout: 5,
      }],
    },
  };
}

function stripJsoncComments(src) {
  // Remove // line comments (not inside strings) and /* */ block comments
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
  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function readSettings(p) {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, 'utf8');
  // Try strict JSON first
  try { return JSON.parse(raw); } catch {}
  // Try JSONC
  try { return JSON.parse(stripJsoncComments(raw)); } catch (e2) {
    throw new Error(`Failed to parse ${p}: ${e2.message}`);
  }
}

export function patchSettingsInMemory(settings, { mode }) {
  const out = JSON.parse(JSON.stringify(settings)); // deep clone

  if (!out.hooks || typeof out.hooks !== 'object') out.hooks = {};
  const hooks = out.hooks;

  for (const event of ['SessionStart', 'Stop']) {
    // Coerce to array
    let current = hooks[event];
    if (!current) current = [];
    else if (!Array.isArray(current)) current = [current];

    // Filter out stale relay entries
    const filtered = current.filter((entry) => !isRelayHookEntry(entry));

    if (mode === 'install') {
      const fresh = buildHookEntries();
      hooks[event] = [...filtered, fresh[event]];
    } else {
      // uninstall
      hooks[event] = filtered;
      if (filtered.length === 0) delete hooks[event];
    }
  }

  // Clean up empty hooks object
  if (mode === 'uninstall' && Object.keys(hooks).length === 0) {
    delete out.hooks;
  }

  return out;
}

export function writeSettingsAtomic(p, obj) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });

  // Backup existing
  if (fs.existsSync(p)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backup = `${p}.relay-backup-${ts}`;
    fs.copyFileSync(p, backup);
  }

  const tmp = `${p}.tmp`;
  const content = JSON.stringify(obj, null, 2).replace(/\r\n/g, '\n') + '\n';
  fs.writeFileSync(tmp, content, { encoding: 'utf8' });
  fs.renameSync(tmp, p);
}

// --------------------------------------------------------------------------
// chmod (POSIX only)
// --------------------------------------------------------------------------

export function chmodHookDispatcher(clone) {
  if (process.platform === 'win32') return;
  const dispatcherPath = path.join(clone, 'hooks', 'run-hook.cmd');
  if (fs.existsSync(dispatcherPath)) {
    fs.chmodSync(dispatcherPath, 0o755);
  }
}

// --------------------------------------------------------------------------
// Verify
// --------------------------------------------------------------------------

export function verifyInstall(paths) {
  const issues = [];

  // Plugin link must exist and point to a directory containing relay CLI
  const info = inspectLink(paths.plugin);
  if (info.kind === 'missing') {
    issues.push(`Plugin link missing: ${paths.plugin}`);
  }

  // relay CLI responds — resolve from actual link target (handles --from-local)
  const linkedDir = (info.target && info.kind !== 'missing')
    ? info.target
    : paths.clone;
  const relayBin = path.join(linkedDir, 'bin', 'relay.mjs');
  if (fs.existsSync(relayBin)) {
    const r = spawnSync('node', [relayBin, 'status'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      issues.push(`relay CLI failed: ${(r.stderr || '').trim()}`);
    }
  } else {
    issues.push(`relay CLI not found at: ${relayBin}`);
  }

  // settings.json has exactly one relay entry per event
  try {
    const settings = readSettings(paths.settings);
    const hooksObj = settings.hooks || {};
    for (const event of ['SessionStart', 'Stop']) {
      const entries = Array.isArray(hooksObj[event]) ? hooksObj[event] : [];
      const relayEntries = entries.filter(isRelayHookEntry);
      if (relayEntries.length === 0) {
        issues.push(`settings.json missing Relay ${event} hook`);
      } else if (relayEntries.length > 1) {
        issues.push(`settings.json has ${relayEntries.length} Relay ${event} hooks (expected 1)`);
      }
    }
  } catch (e) {
    issues.push(`settings.json unreadable: ${e.message}`);
  }

  // POSIX: hook dispatcher is executable
  if (process.platform !== 'win32') {
    const dispatcher = path.join(paths.clone, 'hooks', 'run-hook.cmd');
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
// Orchestrators
// --------------------------------------------------------------------------

export function install(opts) {
  const { home, fromLocal, force, dryRun } = opts;
  const r = reporter('install');
  const paths = relayPaths(home);

  r.ok(`Home: ${home}`);
  preflight();

  const repoDir = resolveRepoDir({ fromLocal, clone: paths.clone, force });
  r.ok(`Repo: ${repoDir}`);

  chmodHookDispatcher(repoDir);

  if (!dryRun) {
    createLink(repoDir, paths.plugin);

    const settings = readSettings(paths.settings);
    const patched = patchSettingsInMemory(settings, { mode: 'install' });
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

  if (!dryRun) {
    process.stderr.write('\n[relay] Install complete.\n');
    process.stderr.write('  Next: cd <your-repo> && relay init\n');
  }
  return result;
}

export function uninstall(opts) {
  const { home, dryRun } = opts;
  const r = reporter('uninstall');
  const paths = relayPaths(home);

  if (!dryRun) {
    removeLink(paths.plugin);
    r.ok(`Removed link: ${paths.plugin}`);

    if (fs.existsSync(paths.settings)) {
      const settings = readSettings(paths.settings);
      const patched = patchSettingsInMemory(settings, { mode: 'uninstall' });
      writeSettingsAtomic(paths.settings, patched);
      r.ok(`Removed relay entries from settings.json`);
    }
  } else {
    r.ok('[dry-run] would remove link + strip settings entries');
  }
}

export function update(opts) {
  const { home, force } = opts;
  const r = reporter('update');
  const paths = relayPaths(home);

  if (!fs.existsSync(paths.clone)) {
    throw new Error(
      `Relay not installed at ${paths.clone}. Run: relay install`
    );
  }

  cloneOrUpdate(paths.clone, { force });
  chmodHookDispatcher(paths.clone);

  // Re-patch settings in case hooks.json changed
  const settings = readSettings(paths.settings);
  const patched = patchSettingsInMemory(settings, { mode: 'install' });
  writeSettingsAtomic(paths.settings, patched);
  r.ok('settings.json re-patched');

  const result = verifyInstall(paths);
  if (!result.ok) {
    for (const issue of result.issues) r.warn(`Verify: ${issue}`);
  } else {
    r.ok('Verified install after update');
  }
}

export function doctor(opts) {
  const { home } = opts;
  const paths = relayPaths(home);
  const result = verifyInstall(paths);

  if (result.ok) {
    process.stdout.write('[relay] doctor: all checks passed\n');
  } else {
    process.stdout.write(`[relay] doctor: ${result.issues.length} issue(s) found:\n`);
    for (const issue of result.issues) {
      process.stdout.write(`  - ${issue}\n`);
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
      ? { ...process.env, RELAY_HOME: args.home }
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
        install(opts);
        break;
      }
      case 'uninstall': {
        uninstall(opts);
        break;
      }
      case 'update': {
        update(opts);
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
          '  --from-local <path>  Use local relay checkout instead of cloning\n' +
          '  --home <path>        Override ~/.claude/ location (for testing)\n' +
          '  --force              Overwrite dirty working tree during update\n' +
          '  --dry-run            Preview actions without making changes\n'
        );
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof Error && e.constructor.name === 'PreflightError') {
      process.stderr.write(`[relay] preflight failed: ${e.message}\n`);
    } else {
      process.stderr.write(`[relay] error: ${e && e.message ? e.message : e}\n`);
    }
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  await main(process.argv.slice(2));
}
