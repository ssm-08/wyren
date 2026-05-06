// ── Category weights ──────────────────────────────────────────────────────
const SIGNALS = [
  // High value — explicit decision language
  { weight: 3, pattern: /\b(decided?|we('re| are) going with|chose|choice|picked|settled on|agreed)\b/i },

  // High value — rejection / failure
  { weight: 3, pattern: /\b(rejected?|doesn'?t work|won'?t work|tried .{0,30} (but|and it)|abandoned|reverted)\b/i },

  // High value — deliberate hacks in code
  { weight: 3, pattern: /\b(workaround|hack|hardcod\w*|stub|mock|placeholder|skip for now)\b/i },

  // High value — known broken / intentionally deferred bugs
  { weight: 3, pattern: /\b(known (issue|bug|broken)|intentionally (broken|disabled)|won'?t fix|deliberately (broken|disabled)|leaving .{0,15} broken)\b/i },

  // Medium — scope signals
  { weight: 2, pattern: /\b(out of scope|descoped|added to scope|deferred|cut|dropping)\b/i },

  // Medium — open questions
  { weight: 2, pattern: /\b(open question|still (need|deciding)|not sure yet|revisit|TBD)\b/i },

  // Medium — maintenance flags
  { weight: 2, pattern: /\b(TODO|FIXME|before (demo|launch|merge))\b/ },

  // Low — weak signal words that need reinforcement
  { weight: 1, pattern: /\b(actually|instead|broken|later|for now)\b/i },
];

// File edits are strong signal — team changed something deliberately
const EDIT_TOOL_REGEX = /\[tool_use (Edit|Write|MultiEdit)\]/;
const EDIT_WEIGHT = 3;

// ── Structural signals (scored on transcript shape, not text) ─────────────
function structuralScore(lines) {
  let score = 0;
  const turns = lines.filter(l => l && (l.type === 'user' || l.type === 'assistant'));

  // Long sessions are more likely to contain decisions
  if (turns.length >= 10) score += 2;
  if (turns.length >= 20) score += 2;

  // User messages that are long = explaining context or decisions, not just commands
  const userLines = lines.filter(l => l && l.type === 'user');
  const avgUserLength = userLines.reduce((sum, l) => {
    const content = l.message?.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content || '');
    return sum + text.length;
  }, 0) / (userLines.length || 1);
  if (avgUserLength > 200) score += 2;

  // Multiple file edits = real work happened
  const editCount = lines.filter(l => {
    if (l?.type !== 'assistant') return false;
    const content = l.message?.content;
    return Array.isArray(content) && content.some(b =>
      b?.type === 'tool_use' && ['Edit', 'Write', 'MultiEdit'].includes(b.name)
    );
  }).length;
  if (editCount >= 3) score += 2;
  if (editCount >= 8) score += 2;

  return score;
}

// ── Threshold (env-overridable for faster test cycles) ────────────────────
// Read at call time (not module load) so tests can set the env var after import.
function getThreshold() {
  const p = parseInt(process.env.RELAY_TIER0_THRESHOLD ?? '3', 10);
  return isNaN(p) ? 3 : p;
}

// ── Main export ───────────────────────────────────────────────────────────
export function scoreTier0(transcriptText, lines = []) {
  if (typeof transcriptText !== 'string') return { score: 0, passes: false, breakdown: [] };
  let score = 0;
  const breakdown = [];

  // Text-based signals
  for (const { weight, pattern } of SIGNALS) {
    const matches = transcriptText.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      // Cap contribution per category to avoid one word dominating
      const contribution = Math.min(matches.length * weight, weight * 3);
      score += contribution;
      breakdown.push({ pattern: pattern.source, matches: matches.length, contribution });
    }
  }

  // Edit tool signal (rendered transcript format: [tool_use Edit] {...})
  const editMatches = (transcriptText.match(new RegExp(EDIT_TOOL_REGEX.source, 'g')) || []).length;
  if (editMatches > 0) {
    const contribution = Math.min(editMatches * EDIT_WEIGHT, EDIT_WEIGHT * 4);
    score += contribution;
    breakdown.push({ pattern: 'tool_use Edit/Write/MultiEdit', matches: editMatches, contribution });
  }

  // Structural score (operates on raw JSONL lines, not rendered text)
  const structural = structuralScore(lines);
  score += structural;
  if (structural > 0) breakdown.push({ pattern: 'structural', matches: 1, contribution: structural });

  const THRESHOLD = getThreshold();
  return { score, passes: score >= THRESHOLD, breakdown };
}

// Backwards-compatible export for distiller.mjs and tests
export function hasTier0Signal(transcriptText, lines = []) {
  const { score, passes, breakdown } = scoreTier0(transcriptText, lines);
  process.stderr.write(`[relay] tier0 score=${score} threshold=${getThreshold()} passes=${passes}\n`);
  return passes;
}
