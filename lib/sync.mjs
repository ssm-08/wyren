import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function git(args, cwd, { timeout = 10_000 } = {}) {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
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
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
  } catch {}
}

// Implements RelaySync interface. Swap for CloudSync later by replacing this class.
export class GitSync {
  // Pull latest .relay/ files from remote. Fail-open — session proceeds on any error.
  pull(cwd) {
    try {
      git('fetch --quiet', cwd, { timeout: 3_000 });
    } catch (e) {
      appendLog(cwd, `sync.pull: fetch failed: ${e.message}`);
      return;
    }

    let remote;
    try {
      // Prefer the configured upstream tracking branch
      remote = git('rev-parse --abbrev-ref --symbolic-full-name @{upstream}', cwd, { timeout: 2_000 });
    } catch {
      try {
        const branch = git('rev-parse --abbrev-ref HEAD', cwd, { timeout: 2_000 });
        remote = `origin/${branch}`;
      } catch {
        appendLog(cwd, 'sync.pull: cannot determine remote tracking branch');
        return;
      }
    }

    // Checkout only .relay/ files — no full rebase, no touch on user's working tree
    try { git(`checkout ${remote} -- .relay/memory.md`, cwd, { timeout: 2_000 }); } catch {}
    try { git(`checkout ${remote} -- .relay/broadcast`, cwd, { timeout: 2_000 }); } catch {}
  }

  // Commit and push .relay/ changes. Retries on non-fast-forward with rebase.
  push(cwd, sessionId) {
    const shortId = (sessionId || 'unknown').slice(0, 8);

    try {
      git('add .relay/memory.md .relay/broadcast', cwd, { timeout: 5_000 });
    } catch (e) {
      appendLog(cwd, `sync.push: add failed: ${e.message}`);
      return;
    }

    // git diff --cached --quiet exits 0 if nothing staged (execSync throws on non-zero exit)
    try {
      git('diff --cached --quiet -- .relay/', cwd, { timeout: 2_000 });
      return; // nothing to commit
    } catch {
      // has staged changes — proceed to commit
    }

    try {
      git(`commit -m "[relay] memory update (session ${shortId})"`, cwd, { timeout: 5_000 });
    } catch (e) {
      appendLog(cwd, `sync.push: commit failed: ${e.message}`);
      return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        git('push origin HEAD', cwd, { timeout: 10_000 });
        return; // success
      } catch {
        if (attempt < 2) {
          const rebased = this._rebase(cwd);
          if (!rebased) return; // conflict resolved by rollback — stop retrying
        } else {
          appendLog(cwd, 'sync.push: failed after 3 attempts — leaving commit local');
        }
      }
    }
  }

  // Fetch + rebase FETCH_HEAD. On conflict: abort, roll back relay commit, reset turns.
  // Returns true if rebase succeeded (push can retry), false if conflict (caller should stop).
  _rebase(cwd) {
    try {
      git('fetch --quiet', cwd, { timeout: 5_000 });
      git('rebase FETCH_HEAD', cwd, { timeout: 10_000 });
      return true;
    } catch {
      try { git('rebase --abort', cwd, { timeout: 5_000 }); } catch {}
      // Roll back the relay commit so repo stays clean (no orphan local commit)
      try { git('reset --mixed HEAD~1', cwd, { timeout: 2_000 }); } catch {}
      // Restore remote memory.md to working tree so next session sees correct state
      try { git('checkout FETCH_HEAD -- .relay/memory.md', cwd, { timeout: 2_000 }); } catch {}
      try { git('reset HEAD -- .relay/memory.md', cwd, { timeout: 2_000 }); } catch {}
      // Reset turn counter so next Stop hook triggers a fresh distillation
      resetWatermarkTurns(cwd);
      appendLog(cwd, 'sync._rebase: conflict — rolled back relay commit, re-distill queued');
      return false;
    }
  }

  // Advisory local lock. Prevents two concurrent distillers from double-pushing.
  // Returns a release function. Throws Error('LOCKED') if a fresh lock exists.
  lock(cwd) {
    const lockPath = path.join(cwd, '.relay', 'state', '.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    if (fs.existsSync(lockPath)) {
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age < 60_000) throw new Error('LOCKED');
        // stale lock (> 60s) — steal it
      } catch (e) {
        if (e.message === 'LOCKED') throw e;
        // stat failed (file vanished) — proceed
      }
    }

    fs.writeFileSync(lockPath, new Date().toISOString(), 'utf8');
    return () => { try { fs.rmSync(lockPath, { force: true }); } catch {} };
  }
}
