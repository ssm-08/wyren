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
    const logPath = path.join(cwd, '.relay', 'log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function resetWatermarkTurns(cwd) {
  const p = path.join(cwd, '.relay', 'state', 'watermark.json');
  try {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    s.turns_since_distill = 0;
    delete s.distiller_running; // prevent stuck flag if distiller was killed mid-flight
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, p);
  } catch {}
}

// Implements RelaySync interface. Swap for CloudSync later by replacing this class.
export class GitSync {
  // Pull latest .relay/ files from remote. Fail-open — session proceeds on any error.
  // Only fetches memory.md and broadcast/; .relay/state/ is gitignored and machine-local.
  // opts.fetchTimeoutMs / opts.checkoutTimeoutMs override defaults (UPS uses tight caps).
  pull(cwd, { fetchTimeoutMs = 3_000, checkoutTimeoutMs = 2_000 } = {}) {
    // I3: env escape hatch for local-only or demo environments
    if (process.env.RELAY_SKIP_PULL) return;

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

    // Checkout only .relay/ tracked files — no full rebase, no touch on user working tree
    try { git(['checkout', remote, '--', '.relay/memory.md'], cwd, { timeout: checkoutTimeoutMs }); } catch {}
    try { git(['checkout', remote, '--', '.relay/broadcast'], cwd, { timeout: checkoutTimeoutMs }); } catch {}
  }

  // Commit and push .relay/ changes. Retries on non-fast-forward with rebase.
  push(cwd, sessionId) {
    const shortId = (sessionId || 'unknown').slice(0, 8);

    // Stage each path separately — if broadcast dir doesn't exist yet, don't abort the whole push
    for (const p of ['.relay/memory.md', '.relay/broadcast']) {
      try {
        git(['add', p], cwd, { timeout: 5_000 });
      } catch (e) {
        appendLog(cwd, `sync.push: add ${p} failed (skipping): ${e.message}`);
      }
    }

    // git diff --cached --quiet exits 0 if nothing staged; spawnSync throws on non-zero
    try {
      git(['diff', '--cached', '--quiet', '--', '.relay/'], cwd, { timeout: 2_000 });
      return; // nothing to commit
    } catch {
      // has staged changes — proceed to commit
    }

    try {
      // I1: commit message as array arg — shortId never touches a shell
      git(['commit', '-m', `[relay] memory update (session ${shortId})`], cwd, { timeout: 5_000 });
    } catch (e) {
      appendLog(cwd, `sync.push: commit failed: ${e.message}`);
      return;
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
  // via reset --mixed (safe: doesn't touch working tree outside .relay/), reset turns.
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
      // (user's in-progress code changes are preserved; only .relay/ files differ).
      try { git(['reset', '--mixed', 'FETCH_HEAD'], cwd, { timeout: 2_000 }); } catch {}

      // Sync .relay/ tracked files in working tree to remote version
      try { git(['checkout', 'FETCH_HEAD', '--', '.relay/memory.md'], cwd, { timeout: 2_000 }); } catch {}
      try { git(['checkout', 'FETCH_HEAD', '--', '.relay/broadcast'], cwd, { timeout: 2_000 }); } catch {}

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
    const lockPath = path.join(cwd, '.relay', 'state', '.lock');
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
        // Stale (> 60s) — steal it
      } catch (e2) {
        if (e2.message === 'LOCKED') throw e2;
        // stat failed (file vanished) — proceed to write
      }
      // Overwrite stale or vanished lock
      const fd = fs.openSync(lockPath, 'w');
      fs.writeSync(fd, new Date().toISOString());
      fs.closeSync(fd);
    }

    return () => { try { fs.rmSync(lockPath, { force: true }); } catch {} };
  }
}
