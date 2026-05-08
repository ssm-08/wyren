import fs from 'node:fs';
import path from 'node:path';

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
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, memoryPath); return; } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY') break;
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}
