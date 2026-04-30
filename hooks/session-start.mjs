#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readMemory } from '../lib/memory.mjs';
import { readStdin, isMain } from '../lib/util.mjs';
import { GitSync } from '../lib/sync.mjs';

// Returns { content: string, skillFiles: string[] }
export function readBroadcastDir(broadcastDir) {
  if (!fs.existsSync(broadcastDir)) return { content: '', skillFiles: [] };
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== '.gitkeep') files.push(full);
    }
  }
  walk(broadcastDir);
  files.sort();
  if (files.length === 0) return { content: '', skillFiles: [] };

  const skillsDir = path.join(broadcastDir, 'skills');
  const skillFiles = files
    .filter((f) => path.dirname(f) === skillsDir)
    .map((f) => path.basename(f));

  const content = files
    .map((f) => {
      const name = path.relative(broadcastDir, f).replace(/\\/g, '/');
      const body = fs.readFileSync(f, 'utf8');
      return `## broadcast: ${name}\n\n${body.trim()}`;
    })
    .join('\n\n---\n\n');

  return { content, skillFiles };
}

export function buildContext(cwd) {
  const relayDir = path.join(cwd, '.relay');
  if (!fs.existsSync(relayDir)) return '';

  const memory = readMemory(path.join(relayDir, 'memory.md'));
  const { content: broadcast, skillFiles } = readBroadcastDir(path.join(relayDir, 'broadcast'));

  const parts = [];
  if (memory.trim()) parts.push(`# Relay Memory\n\n${memory.trim()}`);
  if (broadcast.trim()) {
    let broadcastSection = `# Relay Broadcast\n\n${broadcast.trim()}`;
    if (skillFiles.length > 0) {
      const count = skillFiles.length;
      const names = skillFiles
        .map((f) => '`' + path.basename(f, path.extname(f)) + '`')
        .join(', ');
      broadcastSection +=
        `\n\n_Relay: ${count} team skill(s) loaded — ${names}.` +
        ` Acknowledge in your first response with one line: "Loaded ${count} team skill(s): ${names}."_`;
    }
    parts.push(broadcastSection);
  }

  return parts.join('\n\n---\n\n');
}

function appendLog(cwd, msg) {
  try {
    const logPath = path.join(cwd, '.relay', 'log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd } = input;

    // Pull latest .relay/ from remote before reading memory (fail-open, 3s cap inside pull)
    if (fs.existsSync(path.join(cwd, '.relay'))) {
      try { new GitSync().pull(cwd, { fetchTimeoutMs: 1500, checkoutTimeoutMs: 500 }); } catch {}
    }

    const context = buildContext(cwd);
    if (!context) process.exit(0);
    appendLog(cwd, 'injection: session-start');
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

if (isMain(import.meta.url)) main();
