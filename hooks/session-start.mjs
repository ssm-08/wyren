#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMemory } from '../lib/memory.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function readBroadcastDir(broadcastDir) {
  if (!fs.existsSync(broadcastDir)) return '';
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(broadcastDir);
  files.sort();
  if (files.length === 0) return '';
  return files
    .map((f) => {
      const name = path.relative(broadcastDir, f).replace(/\\/g, '/');
      const content = fs.readFileSync(f, 'utf8');
      return `## broadcast: ${name}\n\n${content.trim()}`;
    })
    .join('\n\n---\n\n');
}

export function buildContext(cwd) {
  const relayDir = path.join(cwd, '.relay');
  if (!fs.existsSync(relayDir)) return '';

  const memory = readMemory(path.join(relayDir, 'memory.md'));
  const broadcast = readBroadcastDir(path.join(relayDir, 'broadcast'));

  const parts = [];
  if (memory.trim()) parts.push(`# Relay Memory\n\n${memory.trim()}`);
  if (broadcast.trim()) parts.push(`# Relay Broadcast\n\n${broadcast.trim()}`);

  return parts.join('\n\n---\n\n');
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd } = input;
    const context = buildContext(cwd);
    if (!context) process.exit(0);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: context,
        },
      }) + '\n'
    );
  } catch (e) {
    process.stderr.write(`[relay] session-start error: ${e.message}\n`);
    process.exit(0);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) main();
