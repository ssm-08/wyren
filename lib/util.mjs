import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    // realpathSync follows junctions/symlinks — avoids mismatch when plugin
    // is registered via junction into ~/.claude/plugins/wyren/
    const argv1 = fs.realpathSync(path.resolve(process.argv[1]));
    const meta = fs.realpathSync(path.resolve(fileURLToPath(metaUrl)));
    return argv1 === meta;
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
  }
}

// Atomically rename tmp → dest. Retries on Windows EPERM/EBUSY/EACCES contention.
// Deletes tmp on final failure.
export function atomicRename(tmp, dest, retries = 5) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { fs.renameSync(tmp, dest); return; } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') break;
      const end = Date.now() + i + 1;
      while (Date.now() < end) {}
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}
