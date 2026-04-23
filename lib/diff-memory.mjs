import crypto from 'node:crypto';

const SECTION_RE = /^## (.+)$/;
const BULLET_RE = /^- (.+)$/;

/**
 * Parse memory.md into a Map of section name → Set of bullet text.
 * Provenance tags like "[session X, turn N]" are kept as part of the bullet
 * so they don't cause spurious diffs (section-aware set diff ignores ordering).
 */
export function parseSections(markdown) {
  const sections = new Map();
  let current = null;
  for (const raw of (markdown || '').split('\n')) {
    const line = raw.trimEnd();
    const secMatch = line.match(SECTION_RE);
    if (secMatch) {
      current = secMatch[1].trim();
      if (!sections.has(current)) sections.set(current, new Set());
      continue;
    }
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch && current) {
      sections.get(current).add(bulletMatch[1].trim());
    }
  }
  return sections;
}

/**
 * Compute section-aware set diff between two memory.md strings.
 * Returns { added: Map<section, string[]>, removed: Map<section, string[]> }.
 * Bullet reordering within a section produces an empty diff.
 */
export function diffMemory(oldText, newText) {
  const oldSec = parseSections(oldText);
  const newSec = parseSections(newText);
  const added = new Map();
  const removed = new Map();

  const allSections = new Set([...oldSec.keys(), ...newSec.keys()]);
  for (const sec of allSections) {
    const oldBullets = oldSec.get(sec) || new Set();
    const newBullets = newSec.get(sec) || new Set();

    const addedBullets = [...newBullets].filter((b) => !oldBullets.has(b));
    const removedBullets = [...oldBullets].filter((b) => !newBullets.has(b));

    if (addedBullets.length > 0) added.set(sec, addedBullets);
    if (removedBullets.length > 0) removed.set(sec, removedBullets);
  }

  return { added, removed };
}

/**
 * Render a diff into a compact additionalContext string.
 * Truncates to maxBytes with a marker so the model knows it's partial.
 */
export function renderDelta(diff, { maxBytes = 4096 } = {}) {
  const { added, removed } = diff;
  if (added.size === 0 && removed.size === 0) return '';

  const lines = ['## Relay live update'];

  if (added.size > 0) {
    for (const [sec, bullets] of added) {
      lines.push(`### New in ${sec}`);
      for (const b of bullets) lines.push(`- ${b}`);
    }
  }
  if (removed.size > 0) {
    for (const [sec, bullets] of removed) {
      lines.push(`### Removed from ${sec}`);
      for (const b of bullets) lines.push(`- ${b}`);
    }
  }

  let result = lines.join('\n');
  if (Buffer.byteLength(result, 'utf8') > maxBytes) {
    // Truncate to maxBytes then add marker
    const buf = Buffer.from(result, 'utf8').slice(0, maxBytes - 60);
    result = buf.toString('utf8') + '\n_…truncated, see .relay/memory.md for full context…_';
  }
  return result;
}

/**
 * 12-char SHA-256 prefix of the memory text. Fast change detection.
 */
export function hashMemory(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex').slice(0, 12);
}
