import fs from 'node:fs';
import readline from 'node:readline';

const MAX_TOOL_RESULT_CHARS = 800;
const MAX_TOOL_INPUT_CHARS = 400;

export async function readTranscriptLines(filePath) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) {
    if (!raw) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {}
  }
  return lines;
}

export function sliceSinceUuid(lines, watermarkUuid) {
  if (!watermarkUuid) return lines;
  const idx = lines.findIndex((l) => l && l.uuid === watermarkUuid);
  if (idx < 0) return lines;
  return lines.slice(idx + 1);
}

export function lastUuid(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] && lines[i].uuid) return lines[i].uuid;
  }
  return null;
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n) + `... [truncated ${s.length - n} chars]`;
}

function stringifyInput(input) {
  if (!input) return '';
  try {
    return truncate(JSON.stringify(input), MAX_TOOL_INPUT_CHARS);
  } catch {
    return '[unserializable input]';
  }
}

function renderUserContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text' && block.text) {
      parts.push(block.text.trim());
    } else if (block.type === 'tool_result') {
      const body =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
          ? block.content
              .map((c) => (c && c.type === 'text' ? c.text : ''))
              .join('\n')
          : '';
      const err = block.is_error ? ' ERROR' : '';
      parts.push(`[tool_result${err}] ${truncate(body.trim(), MAX_TOOL_RESULT_CHARS)}`);
    } else if (block.type === 'image') {
      parts.push('[image omitted]');
    }
  }
  return parts.join('\n').trim();
}

function renderAssistantContent(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text' && block.text) {
      parts.push(block.text.trim());
    } else if (block.type === 'tool_use') {
      parts.push(`[tool_use ${block.name}] ${stringifyInput(block.input)}`);
    }
  }
  return parts.join('\n').trim();
}

export function renderForDistiller(lines) {
  let turn = 0;
  const out = [];
  for (const line of lines) {
    if (!line || line.isSidechain) continue;
    if (line.type === 'user') {
      const msg = line.message;
      if (!msg) continue;
      const text = renderUserContent(msg.content);
      if (!text) continue;
      turn++;
      out.push(`[turn ${turn}, user]\n${text}`);
    } else if (line.type === 'assistant') {
      const msg = line.message;
      if (!msg) continue;
      const text = renderAssistantContent(msg.content);
      if (!text) continue;
      turn++;
      out.push(`[turn ${turn}, assistant]\n${text}`);
    }
  }
  return out.join('\n\n');
}
