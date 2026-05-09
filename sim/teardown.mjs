#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  console.log('Usage: node sim/teardown.mjs [--base <path>] --yes [--help]');
  console.log('');
  console.log('Options:');
  console.log('  --base <path>  Base directory to remove (default: read from sim/.last-base)');
  console.log('  --yes          Skip confirmation (required in non-interactive contexts)');
  console.log('  --help         Print usage and exit');
}

function parseArgs(argv) {
  const result = { base: null, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { result.help = true; }
    else if (argv[i] === '--yes') { result.yes = true; }
    else if (argv[i] === '--base' && argv[i + 1]) { result.base = argv[++i]; }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage();
  process.exit(0);
}

const lastBasePath = path.join(__dirname, '.last-base');

let base = args.base ? path.resolve(args.base) : null;

if (!base) {
  try {
    base = fs.readFileSync(lastBasePath, 'utf8').trim();
  } catch {
    console.error('[error] No --base provided and sim/.last-base not found.');
    console.error('        Pass --base <path> explicitly.');
    process.exit(1);
  }
}

if (!base) {
  console.error('[error] Base path is empty. Pass --base <path>.');
  process.exit(1);
}

if (!args.yes) {
  if (!process.stdin.isTTY) {
    console.error('[error] Non-interactive context detected. Pass --yes to confirm deletion.');
    process.exit(1);
  }
  // Interactive prompt (should rarely run in practice — Claude Code is non-interactive)
  process.stdout.write(`Will recursively delete ${base}. Continue? [y/N] `);
  const buf = Buffer.alloc(4);
  const n = fs.readSync(process.stdin.fd, buf, 0, 4);
  const answer = buf.slice(0, n).toString().trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Aborted.');
    process.exit(0);
  }
}

fs.rmSync(base, { recursive: true, force: true });

// Remove .last-base only if it pointed to the deleted path
try {
  const recorded = fs.readFileSync(lastBasePath, 'utf8').trim();
  if (recorded === base) {
    fs.unlinkSync(lastBasePath);
  }
} catch {
  // .last-base already gone or never existed — fine
}

console.log(`[ok] removed ${base}`);
