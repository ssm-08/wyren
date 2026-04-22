const TIER0_REGEX = /\b(decide|decided|won'?t|doesn'?t work|workaround|hack|TODO|FIXME|rejected|tried|instead|actually|broken|skip|stub|hardcod|mock|placeholder|out of scope|for now|revisit|later)\b/i;

// renderForDistiller emits tool calls as: [tool_use ToolName] {...}
const TIER0_TOOL_REGEX = /\[tool_use (Edit|Write)\]/;

export function hasTier0Signal(transcriptText) {
  if (TIER0_REGEX.test(transcriptText)) return true;
  if (TIER0_TOOL_REGEX.test(transcriptText)) return true;
  return false;
}
