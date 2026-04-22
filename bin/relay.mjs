#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function relayInit(targetDir) {
  const relayDir = path.join(targetDir, '.relay');

  if (fs.existsSync(relayDir)) {
    console.log('Relay already initialized.');
    return false;
  }

  // Create .relay/memory.md
  fs.mkdirSync(relayDir, { recursive: true });
  fs.writeFileSync(
    path.join(relayDir, 'memory.md'),
    '# Relay Memory\n<!-- Populated by distiller. Edit manually to seed context. -->\n',
    'utf8'
  );

  // Create .relay/broadcast/ with .gitkeep so git tracks the empty dir
  fs.mkdirSync(path.join(relayDir, 'broadcast'), { recursive: true });
  fs.writeFileSync(path.join(relayDir, 'broadcast', '.gitkeep'), '', 'utf8');

  // Update .gitignore — idempotent
  const gitignorePath = path.join(targetDir, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch {}

  const toAdd = [];
  if (!existing.includes('.relay/state/')) toAdd.push('.relay/state/');
  if (!existing.includes('.relay/log')) toAdd.push('.relay/log');

  if (toAdd.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gitignorePath, prefix + toAdd.join('\n') + '\n', 'utf8');
  }

  console.log('Relay initialized. Run: git add .relay/memory.md && git commit');
  return true;
}

// CLI entry point — only runs when invoked directly
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const [, , command] = process.argv;
  if (command === 'init') {
    relayInit(process.cwd());
  } else {
    console.error(
      `Usage: relay <command>\n\nCommands:\n  init    Initialize relay in current repository`
    );
    process.exit(1);
  }
}
