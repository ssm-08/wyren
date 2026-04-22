---
title: Chunk 2 — Plugin skeleton + injection
description: Hours 6-14. Install the plugin, inject memory at SessionStart. No distiller, no git.
---

## Goal

Plugin installable via `/plugins add relay`. `SessionStart` hook reads `memory.md` and emits it as `additionalContext`. No distiller wired yet, no git sync yet — just the injection pipe.

## Files

| File | Purpose |
|---|---|
| `package.json` | Plugin metadata |
| `hooks/hooks.json` | Plugin manifest (registers SessionStart + Stop) |
| `hooks/session-start.mjs` | Reads memory, emits `additionalContext` |
| `hooks/stop.mjs` | Stub — just updates watermark, no distiller call |
| `bin/relay` | CLI with `relay init` only |
| `README.md` | Install + usage |

## hooks.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs" }
        ]
      }
    ]
  }
}
```

## session-start.mjs (pseudocode)

```js
import fs from 'node:fs';
import path from 'node:path';

const stdin = await readAllStdin();           // {cwd, session_id, transcript_path, ...}
const { cwd } = JSON.parse(stdin);

const relayDir = path.join(cwd, '.relay');
if (!fs.existsSync(relayDir)) process.exit(0);  // not a relay repo; silent no-op

// Chunk 4 adds: await RelaySync.pull() here

let memory = '';
const memoryPath = path.join(relayDir, 'memory.md');
if (fs.existsSync(memoryPath)) memory = fs.readFileSync(memoryPath, 'utf8');

let broadcast = '';
const broadcastDir = path.join(relayDir, 'broadcast');
if (fs.existsSync(broadcastDir)) {
  broadcast = readBroadcastDir(broadcastDir);
}

const context = [
  memory && `# Relay Memory\n\n${memory}`,
  broadcast && `# Relay Broadcast\n\n${broadcast}`,
].filter(Boolean).join('\n\n---\n\n');

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}));
```

## bin/relay init

- Creates `.relay/memory.md` with empty stub.
- Creates `.relay/broadcast/` empty.
- Appends `.relay/state/` and `.relay/log` to `.gitignore`.
- Verifies `git remote` exists (warns if not).
- Prints next steps.

## Verification

1. Install plugin on local machine. Confirm `/plugins list` shows it.
2. Run `relay init` in a test repo.
3. Manually edit `.relay/memory.md` with test content.
4. Open Claude Code in that repo. Ask "what do you know about this project?"
5. Claude's first answer reflects the manually-written memory content.

## Exit criteria

- Plugin installs cleanly, hooks fire, injection works in a fresh Claude Code session.
- Editing `memory.md` is reflected in the *next* session.
- SessionStart hook completes in under 500ms for a small memory file.
