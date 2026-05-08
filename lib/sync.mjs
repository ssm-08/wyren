import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// I1: array args to spawnSync — no shell, no injection surface
// windowsHide: true prevents console window flash on Windows for each git call
function git(args, cwd, { timeout = 10_000 } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const msg = (r.stderr || '').trim() || `exit code ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status, stderr: r.stderr });
  }
  return (r.stdout || '').trim();
}

function appendLog(cwd, msg) {
  try {
    const logPath = path.join(cwd, '.wyren', 'log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function resetWatermarkTurns(cwd) {
  const p = path.join(cwd, '.wyren', 'state', 'watermark.json');
  let renameLogged = false;
  try {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    s.turns_since_distill = 0;
    delete s.distiller_running; // prevent stuck flag if distiller was killed mid-flight
    delete s.distiller_pid;     // clear stale PID alongside the flag
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    try { fs.renameSync(tmp, p); } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      appendLog(cwd, `sync.resetWatermarkTurns: rename failed: ${e.message}`);
      renameLogged = true;
      throw e;
    }
  } catch (e) {
    if (renameLogged) return;
    appendLog(cwd, `sync.resetWatermarkTurns: failed: ${e.message}`);
  }
}

// Implements WyrenSync interface. Swap for CloudSync later by replacing this class.
export class GitSync {
  // Pull latest .wyren/ files from remote. Fail-open — session proceeds on any error.
  // Only fetches memory.md and broadcast/; .wyren/state/ is gitignored and machine-local.
  // opts.fetchTimeoutMs / opts.checkoutTimeoutMs override defaults (UPS uses tight caps).
  pull(cwd, { fetchTimeoutMs = 3_000, checkoutTimeoutMs = 2_000 } = {}) {
    // I3: env escape hatch for local-only or demo environments
    if (process.env.WYREN_SKIP_PULL) return;

    // I3: short-circuit if no remote configured — avoids 50ms spawn + guaranteed failure
    try {
      git(['config', '--get', 'remote.origin.url'], cwd, { timeout: 1_000 });
    } catch {
      return;
    }

    try {
      git(['fetch', '--quiet'], cwd, { timeout: fetchTimeoutMs });
    } catch (e) {
      appendLog(cwd, `sync.pull: fetch failed: ${e.message}`);
      return;
    }

    let remote;
    try {
      // Prefer the configured upstream tracking branch
      remote = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd, { timeout: 2_000 });
    } catch {
      try {
        const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, { timeout: 2_000 });
        remote = `origin/${branch}`;
      } catch {
        appendLog(cwd, 'sync.pull: cannot determine remote tracking branch');
        return;
      }
    }

    // Checkout only .wyren/ tracked files — no full rebase, no touch on user working tree
    try { git(['checkout', remote, '--', '.wyren/memory.md'], cwd, { timeout: checkoutTimeoutMs }); } catch {}
    try { git(['checkout', remote, '--', '.wyren/broadcast'], cwd, { timeout: checkoutTimeoutMs }); } catch {}
  }

  // Commit and push .wyren/ changes. Retries on non-fast-forward with rebase.
  push(cwd, sessionId) {
    const shortId = (sessionId || 'unknown').slice(0, 8);

    // Stage each path separately — if broadcast dir doesn't exist yet, don't abort the whole push
    for (const p of ['.wyren/memory.md', '.wyren/broadcast']) {
      try {
        git(['add', p], cwd, { timeout: 5_000 });
      } catch (e) {
        appendLog(cwd, `sync.push: add ${p} failed (skipping): ${e.message}`);
      }
    }

    // One diff call: get all staged names, bail if no wyren files, unstage any non-wyren files.
    let nonWyrenStaged = [];
    try {
      const staged = git(['diff', '--cached', '--name-only'], cwd, { timeout: 2_000 });
      const allStaged = (staged || '').split('\n').filter(Boolean);
      if (!allStaged.some((f) => f.startsWith('.wyren/'))) return; // nothing wyren to commit
      nonWyrenStaged = allStaged.filter((f) => !f.startsWith('.wyren/'));
      if (nonWyrenStaged.length > 0) {
        git(['reset', 'HEAD', '--', ...nonWyrenStaged], cwd, { timeout: 5_000 });
      }
    } catch (e) {
      appendLog(cwd, `sync.push: could not check staged files: ${e.message}`);
    }

    try {
      // I1: commit message as array arg — shortId never touches a shell
      git(['commit', '-m', `[wyren] memory update (session ${shortId})`], cwd, { timeout: 5_000 });
    } catch (e) {
      appendLog(cwd, `sync.push: commit failed: ${e.message}`);
      // Re-stage user files before returning so we don't silently unstage their work
      if (nonWyrenStaged.length > 0) {
        try { git(['add', '--', ...nonWyrenStaged], cwd, { timeout: 5_000 }); } catch {}
      }
      return;
    }

    // Re-stage user files after wyren commit
    if (nonWyrenStaged.length > 0) {
      try { git(['add', '--', ...nonWyrenStaged], cwd, { timeout: 5_000 }); } catch {}
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        git(['push', 'origin', 'HEAD'], cwd, { timeout: 10_000 });
        return; // success
      } catch {
        if (attempt < 2) {
          const rebased = this._rebase(cwd);
          if (!rebased) return; // conflict rolled back — stop retrying
        } else {
          appendLog(cwd, 'sync.push: failed after 3 attempts — leaving commit local');
        }
      }
    }
  }

  // Fetch + rebase onto FETCH_HEAD. On conflict: abort, advance local HEAD to FETCH_HEAD
  // via reset --mixed (safe: doesn't touch working tree outside .wyren/), reset turns.
  // Returns true if rebase succeeded (push can retry), false if conflict (caller stops).
  _rebase(cwd) {
    try {
      git(['fetch', '--quiet'], cwd, { timeout: 5_000 });
      git(['rebase', 'FETCH_HEAD'], cwd, { timeout: 10_000 });
      return true;
    } catch {
      try { git(['rebase', '--abort'], cwd, { timeout: 5_000 }); } catch {}

      // C1 fix: advance local HEAD to FETCH_HEAD so repo is no longer behind remote.
      // reset --mixed moves HEAD + index to FETCH_HEAD without touching working tree
      // (user's in-progress code changes are preserved; only .wyren/ files differ).
      try { git(['reset', '--mixed', 'FETCH_HEAD'], cwd, { timeout: 2_000 }); } catch {}

      // Sync .wyren/ tracked files in working tree to remote version
      try { git(['checkout', 'FETCH_HEAD', '--', '.wyren/memory.md'], cwd, { timeout: 2_000 }); } catch {}
      try { git(['checkout', 'FETCH_HEAD', '--', '.wyren/broadcast'], cwd, { timeout: 2_000 }); } catch {}

      // Reset turn counter so next Stop hook triggers a fresh distillation
      resetWatermarkTurns(cwd);
      appendLog(cwd, 'sync._rebase: conflict — advanced to FETCH_HEAD, re-distill queued');
      return false;
    }
  }

  // Advisory local lock. Prevents two concurrent distillers from double-pushing on same machine.
  // Returns a release function. Throws Error('LOCKED') if a fresh lock exists.
  // Note: M4 edge case — if this is the repo's very first commit (no HEAD~1 parent),
  // _rebase()'s reset --mixed HEAD~1 would fail silently; lock is still released correctly.
  lock(cwd) {
    const lockPath = path.join(cwd, '.wyren', 'state', '.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    // I4: 'wx' flag is atomic — fails with EEXIST if file already exists (no TOCTOU window)
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, new Date().toISOString());
      fs.closeSync(fd);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // File exists — check if stale
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age < 60_000) throw new Error('LOCKED');
        // Stale (> 60s) — steal it atomically: unlink first, then re-acquire with 'wx'.
        // This avoids the TOCTOU race where two processes both observe stale age and both
        // open with 'w' (non-exclusive), both believing they hold the lock.
      } catch (e2) {
        if (e2.message === 'LOCKED') throw e2;
        // stat failed (e.g. ENOENT — file vanished between EEXIST and stat).
        // Fall through to steal attempt — unlink is a no-op if file is gone.
      }
      // Atomic steal: unlink stale lock, then acquire exclusively.
      // If another process steals it first, our 'wx' open throws EEXIST → LOCKED.
      try { fs.unlinkSync(lockPath); } catch {}
      const fd = fs.openSync(lockPath, 'wx'); // throws EEXIST if stolen by another process
      fs.writeSync(fd, new Date().toISOString());
      fs.closeSync(fd);
    }

    return () => { try { fs.rmSync(lockPath, { force: true }); } catch {} };
  }
}
