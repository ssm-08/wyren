# Relay Chunk 2 — Plugin Skeleton + Injection

**Date:** 2026-04-21
**Status:** Approved, pending implementation

## Goal

Plugin installable via `/plugins add`. `SessionStart` hook reads `.relay/memory.md` (and
`.relay/broadcast/`) and injects as `additionalContext`. No distiller wired yet. No git
sync yet. Just the injection pipe.

## Non-goals (Chunk 2 scope boundary)

- Distiller auto-triggering from Stop hook (Chunk 3)
- Git push/pull sync (Chunk 4)
- Broadcast CLI command `relay broadcast-skill` (Chunk 5)
- Any changes to existing `lib/`, `distiller.mjs`, or `docs-site/`

---

## Files

```
Vibejam/                              ← plugin root (repo IS the plugin)
├── .claude-plugin/
│   └── plugin.json                   ← metadata only: name, description, version, author
├── hooks/
│   ├── hooks.json                    ← SessionStart + Stop hook definitions
│   ├── run-hook.cmd                  ← Windows/Unix polyglot dispatcher (→ node)
│   ├── session-start.mjs             ← reads memory.md + broadcast/, emits additionalContext
│   └── stop.mjs                      ← stub: increments watermark turn counter
├── bin/
│   └── relay                         ← CLI polyglot (node dispatch), Chunk 2 = init only
├── package.json                      ← "type":"module", no runtime deps
└── README.md
```

Existing files **not modified**: `distiller.mjs`, `lib/transcript.mjs`, `lib/memory.mjs`,
`prompts/distill.md`, `docs-site/**`.

---

## Plugin manifest

### `.claude-plugin/plugin.json`

```json
{
  "name": "relay",
  "description": "Shared team memory across Claude Code sessions via git-synced memory.md",
  "version": "0.2.0",
  "author": {
    "name": "ssm-08",
    "url": "https://github.com/ssm-08"
  },
  "homepage": "https://github.com/ssm-08/relay",
  "repository": "https://github.com/ssm-08/relay",
  "license": "MIT"
}
```

### `hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
            "async": false,
            "timeout": 5,
            "statusMessage": "Loading relay memory..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" stop",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

`Stop` stub writes only watermark.json — fast enough to not block the user turn.

---

## Component: `hooks/run-hook.cmd`

Windows/Unix polyglot. Mirrors superpowers pattern. On Windows: finds `node.exe` via PATH
and runs `%CLAUDE_PLUGIN_ROOT%\hooks\<script>.mjs`. On Unix/bash: runs `node` directly.

Script name is the first argument (`session-start`, `stop`). Resolves to the `.mjs` file in
the same directory.

---

## Component: `hooks/session-start.mjs`

```
Input:  JSON from stdin — { cwd, session_id, transcript_path, hook_event_name, ... }
Output: JSON to stdout — { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }
```

**Algorithm:**
1. `const input = JSON.parse(await readStdin())` — extract `cwd`
2. If `path.join(cwd, '.relay')` does not exist → `process.exit(0)` (not a relay repo)
3. Read `.relay/memory.md` via `readMemory()` from `../lib/memory.mjs`
4. Read all files under `.relay/broadcast/` recursively — flat concat, each prefixed with
   `## broadcast: <filename>\n`
5. Build context string:
   ```
   # Relay Memory\n\n${memory}\n\n---\n\n# Relay Broadcast\n\n${broadcast}
   ```
   Omit sections that are empty.
6. Write JSON envelope to stdout.
7. All logic wrapped in `try/catch` → on error: `process.stderr.write(...)`, `process.exit(0)`

**Performance target:** < 200ms (file reads only, no network, no subprocesses).

---

## Component: `hooks/stop.mjs` (Chunk 2 stub)

```
Input:  JSON from stdin — { cwd, session_id, ... }
Output: nothing (exits 0)
```

**Algorithm:**
1. Parse stdin → extract `cwd`
2. If `.relay/` missing → exit(0)
3. Read `.relay/state/watermark.json` (create if missing)
4. Increment `turns_since_distill`, update `last_turn_at: Date.now()`
5. Write watermark.json
6. exit(0)

No distiller spawn. This counter becomes the trigger condition in Chunk 3.

---

## Component: `bin/relay` (CLI)

Extensionless file, bash/node polyglot. Chunk 2 implements `relay init` only.

```
relay init
```

**init algorithm:**
1. If `.relay/` already exists → print "Already initialized." exit 0 (idempotent)
2. Create `.relay/memory.md` with empty stub:
   ```markdown
   # Relay Memory
   <!-- Populated by distiller. Edit manually to seed context. -->
   ```
3. Create `.relay/broadcast/` dir
4. Read `.gitignore`; if `.relay/state/` not present, append:
   ```
   .relay/state/
   .relay/log
   ```
5. Print: "Relay initialized. Run: git add .relay/memory.md && git commit"

---

## Error handling rules (all hook scripts)

| Condition | Behavior |
|-----------|----------|
| `.relay/` dir missing | `process.exit(0)` — silent no-op |
| `memory.md` missing | Inject nothing, continue |
| Broadcast dir missing | Skip broadcast section |
| stdin parse failure | Log to stderr, `process.exit(0)` |
| Any unhandled exception | Log to stderr, `process.exit(0)` |

**Never** call `process.exit(1)` from a hook. Relay failure must not break Claude Code.

---

## Installation (dev iteration)

```bash
# Symlink plugin root into ~/.claude/plugins/relay
ln -s ~/Documents/Vibejam ~/.claude/plugins/relay
# OR on Windows (run as admin or use junction):
mklink /J "C:\Users\Shree Sai\.claude\plugins\relay" "C:\Users\Shree Sai\Documents\Vibejam"
```

Final validation: push to `ssm-08/relay` and verify `/plugins add ssm-08/relay` installs cleanly.

---

## Exit criteria (from plan)

1. Plugin installs cleanly (symlink + final real install check).
2. `relay init` creates `.relay/` structure and updates `.gitignore`.
3. Edit `memory.md` manually with test content.
4. Open Claude Code in that repo. Ask "what do you know?" → Claude's answer reflects memory.md.
5. SessionStart hook completes in < 500ms.
6. `memory.md` changes are reflected in the NEXT session (not current).

---

## What's NOT in this chunk

- Distiller called from Stop hook (Chunk 3)
- `relay status`, `relay distill` CLI commands (Chunk 4)
- Git push/pull in hooks (Chunk 4)
- `relay broadcast-skill` CLI (Chunk 5)
- Tier 0 regex filter (Chunk 3)
