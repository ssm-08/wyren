#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function updateWatermark(relayDir) {
  const stateDir = path.join(relayDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  const watermarkPath = path.join(stateDir, 'watermark.json');
  let state = { turns_since_distill: 0 };
  try {
    state = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
  } catch {}

  state.turns_since_distill = (state.turns_since_distill ?? 0) + 1;
  state.last_turn_at = Date.now();

  fs.writeFileSync(watermarkPath, JSON.stringify(state, null, 2));
  return state;
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const { cwd } = input;
    const relayDir = path.join(cwd, '.relay');
    if (!fs.existsSync(relayDir)) process.exit(0);
    updateWatermark(relayDir);
  } catch (e) {
    process.stderr.write(`[relay] stop error: ${e.message}\n`);
  }
  process.exit(0);
}

main();
