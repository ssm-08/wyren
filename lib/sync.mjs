import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { atomicRename } from './util.mjs';

// I1: array args to spawnSync — no shell, no injection surface
// windowsHide: true prevents console window flash on Windows for each git call
function git(args, cwd, { timeout = 10_000, env = undefined } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
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

function restoreWorktreeFromRef(cwd, ref, paths, { timeout = 2_000 } = {}) {
  try {
    git(['restore', `--source=${ref}`, '--worktree', '--', ...paths], cwd, { timeout });
    return;
  } catch (e) {
    appendLog(cwd, `sync.restore: git restore failed, falling back to checkout: ${e.message}`);
  }
  // Compatibility fallback for older Git. checkout <tree> -- <path> also updates
  // the index, so immediately unstage those paths to preserve the user's index.
  git(['checkout', ref, '--', ...paths], cwd, { timeout });
  try { git(['reset', '-q', 'HEAD', '--', ...paths], cwd, { timeout }); } catch {}
}

function isNonFastForwardPushError(e) {
  const msg = `${e?.message || ''}\n${e?.stderr || ''}`.toLowerCase();
  return msg.includes('non-fast-forward') ||
    msg.includes('(fetch first)') ||
    msg.includes('updates were rejected because') ||
    msg.includes('tip of your current branch is behind') ||
    (msg.includes('rejected') && msg.includes('fetch first'));
}

function resetWatermarkTurns(cwd) {
  const p = path.join(cwd, '.wyren', 'state', 'watermark.json');
  try {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    s.turns_since_distill = 0;
    delete s.distiller_running; // prevent stuck flag if distiller was killed mid-flight
    delete s.distiller_pid;     // clear stale PID alongside the flag
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    atomicRename(tmp, p);
  } catch (e) {
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

    // Restore only .wyren/ tracked files into the working tree — no full rebase, no index changes.
    try { restoreWorktreeFromRef(cwd, remote, ['.wyren/memory.md', '.wyren/broadcast'], { timeout: checkoutTimeoutMs }); } catch {}
  }

  // Commit and push .wyren/ changes without touching the user's index. The commit is
  // built with a temporary Git index, then HEAD is advanced with update-ref. Returns
  // a structured result so CLI callers can avoid claiming a push happened when it did not.
  push(cwd, sessionId) {
    const shortId = (sessionId || 'unknown').slice(0, 8);
    let commitInfo;
    try {
      commitInfo = this._commitWyrenOnly(cwd, `[wyren] memory update (session ${shortId})`);
    } catch (e) {
      appendLog(cwd, `sync.push: commit failed: ${e.message}`);
      return { committed: false, pushed: false, reason: 'commit_failed', error: e.message };
    }

    if (!commitInfo.committed) {
      return { committed: false, pushed: false, reason: commitInfo.reason || 'no_changes' };
    }

    try {
      git(['config', '--get', 'remote.origin.url'], cwd, { timeout: 1_000 });
    } catch {
      appendLog(cwd, 'sync.push: no origin remote configured — leaving commit local');
      return { committed: true, pushed: false, reason: 'no_remote', commit: commitInfo.commit };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        git(['push', 'origin', 'HEAD'], cwd, { timeout: 10_000 });
        return { committed: true, pushed: true, reason: 'pushed', commit: commitInfo.commit };
      } catch (e) {
        if (!isNonFastForwardPushError(e)) {
          appendLog(cwd, `sync.push: push failed without non-fast-forward; leaving commit local: ${e.message}`);
          return { committed: true, pushed: false, reason: 'push_failed', commit: commitInfo.commit, error: e.message };
        }
        if (attempt < 2) {
          const recovered = this._recoverNonFastForward(cwd, commitInfo.base, commitInfo.commit);
          if (!recovered.retry) {
            return {
              committed: true,
              pushed: false,
              reason: recovered.reason,
              commit: commitInfo.commit,
              error: e.message,
            };
          }
          // The local auto-commit was discarded during safe recovery; create a fresh
          // Wyren-only commit on top of the fast-forwarded remote before retrying.
          try {
            commitInfo = this._commitWyrenOnly(cwd, `[wyren] memory update (session ${shortId})`);
            if (!commitInfo.committed) {
              return { committed: false, pushed: false, reason: commitInfo.reason || 'no_changes_after_recovery' };
            }
          } catch (e2) {
            appendLog(cwd, `sync.push: recommit after recovery failed: ${e2.message}`);
            return { committed: false, pushed: false, reason: 'commit_failed_after_recovery', error: e2.message };
          }
        } else {
          appendLog(cwd, 'sync.push: failed after 3 attempts — leaving commit local');
          return { committed: true, pushed: false, reason: 'push_failed', commit: commitInfo.commit, error: e.message };
        }
      }
    }

    return { committed: true, pushed: false, reason: 'push_failed', commit: commitInfo.commit };
  }

  _commitWyrenOnly(cwd, message) {
    const stateDir = path.join(cwd, '.wyren', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const indexPath = path.join(stateDir, `.push-index-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: indexPath };
    let base;
    try {
      base = git(['rev-parse', '--verify', 'HEAD'], cwd, { timeout: 2_000 });
      git(['read-tree', base], cwd, { timeout: 5_000, env });

      let addedAny = false;
      for (const p of ['.wyren/memory.md', '.wyren/broadcast']) {
        try {
          git(['add', '--', p], cwd, { timeout: 5_000, env });
          addedAny = true;
        } catch (e) {
          appendLog(cwd, `sync.push: add ${p} failed (skipping): ${e.message}`);
        }
      }
      if (!addedAny) return { committed: false, reason: 'nothing_to_add' };

      try {
        git(['diff', '--cached', '--quiet'], cwd, { timeout: 2_000, env });
        return { committed: false, reason: 'no_changes' };
      } catch (e) {
        // git diff --quiet exits 1 when there are staged changes; other statuses are errors.
        if (e.status !== 1) throw e;
      }

      const tree = git(['write-tree'], cwd, { timeout: 5_000, env });
      const commit = git(['commit-tree', tree, '-p', base, '-m', message], cwd, { timeout: 5_000, env });
      git(['update-ref', '-m', 'wyren memory update', 'HEAD', commit, base], cwd, { timeout: 5_000 });
      this._refreshWyrenIndex(cwd);
      return { committed: true, base, commit };
    } finally {
      try { fs.rmSync(indexPath, { force: true }); } catch {}
    }
  }

  _refreshWyrenIndex(cwd) {
    try { git(['reset', '-q', 'HEAD', '--', '.wyren/memory.md', '.wyren/broadcast'], cwd, { timeout: 2_000 }); } catch {}
  }

  // Recover from a rejected push without rebasing or resetting the whole repository.
  // If the remote is a fast-forward from the user's pre-Wyren HEAD, it is safe to
  // drop only the auto-generated Wyren commit and advance HEAD to the remote branch. If
  // the user's branch has diverged, leave HEAD alone and only restore remote Wyren
  // files so a future distillation can try again after the user reconciles Git.
  _recoverNonFastForward(cwd, preWyrenHead, wyrenCommit) {
    let branch;
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, { timeout: 2_000 });
      if (!branch || branch === 'HEAD') throw new Error('detached HEAD');
    } catch (e) {
      appendLog(cwd, `sync.push: cannot determine push branch for recovery: ${e.message}`);
      return { retry: false, reason: 'branch_unknown' };
    }

    const remoteRef = `refs/remotes/origin/${branch}`;
    try {
      git(['fetch', '--quiet', 'origin', `refs/heads/${branch}:${remoteRef}`], cwd, { timeout: 5_000 });
    } catch (e) {
      appendLog(cwd, `sync.push: fetch before retry failed: ${e.message}`);
      return { retry: false, reason: 'fetch_failed' };
    }

    let canFastForward = false;
    try {
      git(['merge-base', '--is-ancestor', preWyrenHead, remoteRef], cwd, { timeout: 2_000 });
      canFastForward = true;
    } catch {}

    if (canFastForward) {
      try {
        git(['update-ref', '-m', 'wyren remote recovery', 'HEAD', remoteRef, wyrenCommit], cwd, { timeout: 5_000 });
      } catch (e) {
        appendLog(cwd, `sync.push: safe HEAD advance failed: ${e.message}`);
        return { retry: false, reason: 'head_update_failed' };
      }
    } else {
      appendLog(cwd, 'sync.push: remote diverged from local user commits — not moving HEAD');
    }

    try { restoreWorktreeFromRef(cwd, remoteRef, ['.wyren/memory.md', '.wyren/broadcast'], { timeout: 2_000 }); } catch {}

    resetWatermarkTurns(cwd);
    appendLog(cwd, canFastForward
      ? 'sync.push: recovered by safely fast-forwarding to FETCH_HEAD, re-distill queued'
      : 'sync.push: conflict — remote .wyren restored, user branch left untouched');
    return { retry: canFastForward, reason: canFastForward ? 'recovered_fast_forward' : 'remote_diverged' };
  }

  // Advisory local lock. Prevents two concurrent distillers from double-pushing on same machine.
  // Returns a release function. Throws Error('LOCKED') if a fresh lock exists.
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
