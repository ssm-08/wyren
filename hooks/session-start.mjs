#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readMemory } from '../lib/memory.mjs';
import { readStdin, isMain } from '../lib/util.mjs';
import { GitSync } from '../lib/sync.mjs';

// Returns { content: string, skillFiles: string[] }
function isInsideDir(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function truncateUtf8(s, maxBytes) {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  return buf.subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
}

export function readBroadcastDir(broadcastDir) {
  if (!fs.existsSync(broadcastDir)) return { content: '', skillFiles: [] };
  const files = [];
  let rootReal;
  try { rootReal = fs.realpathSync(broadcastDir); } catch { return { content: '', skillFiles: [] }; }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== '.gitkeep') {
        let real;
        try { real = fs.realpathSync(full); } catch { continue; }
        if (isInsideDir(real, rootReal)) files.push(full);
      }
    }
  }
  walk(broadcastDir);
  files.sort();
  if (files.length === 0) return { content: '', skillFiles: [] };

  const skillsDir = path.join(broadcastDir, 'skills');
  const skillFiles = files
    .filter((f) => path.dirname(f) === skillsDir)
    .map((f) => path.basename(f));

  const MAX_FILE_BYTES = 50_000;
  const MAX_TOTAL_BYTES = 200_000;
  let totalBytes = 0;
  const parts = [];
  for (const f of files) {
    const name = path.relative(broadcastDir, f).replace(/\\/g, '/');
    let body = fs.readFileSync(f, 'utf8');
    if (Buffer.byteLength(body, 'utf8') > MAX_FILE_BYTES) {
      body = truncateUtf8(body, MAX_FILE_BYTES) + '\n<!-- wyren: truncated — file exceeds 50 KB -->';
    }
    const entry = `## broadcast: ${name}\n\n${body.trim()}`;
    const entryBytes = Buffer.byteLength(entry, 'utf8');
    if (totalBytes + entryBytes > MAX_TOTAL_BYTES) break; // aggregate cap
    parts.push(entry);
    totalBytes += entryBytes;
  }
  const content = parts.join('\n\n---\n\n');

  return { content, skillFiles };
}

export function buildContext(cwd) {
  const wyrenDir = path.join(cwd, '.wyren');
  if (!fs.existsSync(wyrenDir)) return '';

  const memory = readMemory(path.join(wyrenDir, 'memory.md'));
  const { content: broadcast, skillFiles } = readBroadcastDir(path.join(wyrenDir, 'broadcast'));

  const parts = [];
  if (memory.trim()) parts.push(`# Wyren Memory\n\n${memory.trim()}`);
  if (broadcast.trim()) {
    let broadcastSection = `# Wyren Broadcast\n\n${broadcast.trim()}`;
    if (skillFiles.length > 0) {
      const count = skillFiles.length;
      const names = skillFiles
        .map((f) => '`' + path.basename(f, path.extname(f)) + '`')
        .join(', ');
      broadcastSection +=
        `\n\n_Wyren: ${count} team skill(s) loaded — ${names}.` +
        ` Acknowledge in your first response with one line: "Loaded ${count} team skill(s): ${names}."_`;
    }
    parts.push(broadcastSection);
  }

  return parts.join('\n\n---\n\n');
}

function appendLog(cwd, msg) {
  try {
    const logPath = path.join(cwd, '.wyren', 'log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd } = input;

    // Pull latest .wyren/ from remote before reading memory (fail-open, 3s cap inside pull)
    if (fs.existsSync(path.join(cwd, '.wyren'))) {
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
    process.stderr.write(`[wyren] session-start error: ${e.message}\n`);
    process.exit(0);
  }
}

if (isMain(import.meta.url)) main();
