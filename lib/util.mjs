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
