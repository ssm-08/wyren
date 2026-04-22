import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  fs.renameSync(tmp, memoryPath);
}

export function countLines(content) {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export const EOL = os.EOL;
