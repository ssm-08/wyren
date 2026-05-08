import fs from 'node:fs';
import path from 'node:path';
import { atomicRename } from './util.mjs';

export function readMemory(memoryPath) {
  if (!fs.existsSync(memoryPath)) return '';
  return fs.readFileSync(memoryPath, 'utf8');
}

export function writeMemoryAtomic(memoryPath, content) {
  const dir = path.dirname(memoryPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(memoryPath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tmp, content, 'utf8');
  atomicRename(tmp, memoryPath);
}
