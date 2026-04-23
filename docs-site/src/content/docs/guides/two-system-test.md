---
title: Two-system test walkthrough
description: End-to-end guide for verifying Relay works across two machines — System A distills and pushes, System B receives memory at SessionStart.
---

This guide walks through a full end-to-end test of Relay across two machines. By the end, a session on **System A** will have its decisions distilled into `.relay/memory.md`, pushed to a shared git remote, and automatically injected into **System B**'s next session.

**Prerequisites on both systems:**
- Node.js 20+
- Claude Code installed and authenticated
- Git with SSH or HTTPS access to a shared remote repository

---

## Phase 1 — Shared repo setup

Do this once on either machine.

```bash
mkdir relay-test-repo && cd relay-test-repo
git init
git remote add origin git@github.com:YOUR_USERNAME/relay-test-repo.git

echo "# Test" > README.md
git add README.md && git commit -m "init"
git push -u origin master
```

---

## Phase 2 — Install plugin on System A

**Windows — one command (recommended):**

```powershell
# From inside the relay source dir (e.g. C:\Users\YourName\Documents\Vibejam)
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -RunTests
```

This creates the junction, patches `~/.claude/settings.json` with the hook entries, and runs the e2e smoke test. Use `-WhatIf` to preview first.

**Manual (Windows):**

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.claude\plugins\relay" `
  -Target "C:\path\to\relay"   # e.g. C:\Users\YourName\Documents\Vibejam
```

Then add hooks to `~/.claude/settings.json` — see [Plugin registration](/faq/) for the exact JSON block.

**macOS/Linux:**
```bash
ln -s /path/to/relay ~/.claude/plugins/relay
```

Then manually patch `~/.claude/settings.json` with the SessionStart and Stop hook entries (see FAQ).

Verify hooks are wired:
```bash
node scripts/test-e2e.mjs   # 21 tests, ~5s, no Claude session needed
```

---

## Phase 3 — Install plugin on System B

Clone the relay source on the second machine:

```bash
git clone https://github.com/ssm-08/relay ~/relay-plugin
```

**Windows — automated:**

```powershell
cd ~/relay-plugin
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -RunTests
```

**Manual:**

```powershell
# Windows
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.claude\plugins\relay" `
  -Target "$env:USERPROFILE\relay-plugin"
```

```bash
# macOS / Linux
ln -s ~/relay-plugin ~/.claude/plugins/relay
```

Patch `~/.claude/settings.json` manually on macOS/Linux (same JSON as Phase 2).

---

## Phase 4 — Initialize relay in the shared repo (System A)

```bash
cd relay-test-repo

node ~/.claude/plugins/relay/bin/relay.mjs init
# Output: "Relay initialized. Run: git add .relay/memory.md && git commit"

git add .relay/memory.md .gitignore
git commit -m "chore: init relay"
git push
```

---

## Phase 5 — Generate a session on System A

Open Claude Code in `relay-test-repo`:

```bash
cd relay-test-repo
claude
```

Have a conversation with **5+ substantive turns**. Make decisions, write or edit code, use tool calls. The Tier 0 filter looks for signal words — say things like:

> "I decided to use X instead of Y because…"  
> "This approach won't work because…"  
> "TODO: revisit this later"

After the fifth turn, end the session (`/exit` or Ctrl+C). The Stop hook spawns the distiller detached — it runs in the background for ~10–30 seconds.

**Verify distillation:**

```bash
# Wait ~30s, then:
cat .relay/log               # shows "wrote memory.md (N chars)" on success
cat .relay/memory.md         # bullet-point memory entries
node ~/.claude/plugins/relay/bin/relay.mjs status
```

Expected `relay status` output:

```
Memory:     .relay/memory.md  (1.2 KB, 34 lines)
Distilled:  2026-04-22T10:30:00.000Z (2 min ago)
Last UUID:  abc12345
Watermark:  turns_since_distill=0, distiller_running=false
Remote:     origin → git@github.com:YOUR_USERNAME/relay-test-repo.git
Lock:       not held
```

If `distiller_running=true` persists after 2+ minutes, the distiller crashed — check `.relay/log`.

---

## Phase 6 — Push memory to remote

The distiller auto-pushes after writing memory. Confirm:

```bash
git log --oneline -3
# Should show a "[relay] distill ..." commit
```

If the auto-push didn't fire (no remote configured at distill time):

```bash
node ~/.claude/plugins/relay/bin/relay.mjs distill --push --force
```

---

## Phase 7 — Receive memory on System B

Pull the shared repo:

```bash
cd relay-test-repo
git pull
cat .relay/memory.md   # confirm memory arrived
```

Open Claude Code in the same repo:

```bash
claude
```

The `Loading relay memory…` status message appears at startup — the Stop hook injected memory as hidden `additionalContext`. Verify by asking Claude:

> "What do you know about this project from previous sessions?"

Claude should recite the decisions from System A's session without being told anything.

---

## Quick force-test (skip the 5-turn wait)

Pipe a real transcript directly into the Stop hook to trigger distillation immediately:

```bash
TRANSCRIPT=$(ls ~/.claude/projects/*/transcripts/*.jsonl 2>/dev/null | tail -1)

echo "{\"cwd\": \"$(pwd)\", \"transcript_path\": \"$TRANSCRIPT\"}" \
  | node ~/.claude/plugins/relay/hooks/stop.mjs

sleep 30 && cat .relay/memory.md
```

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| Memory not injected on System B | `cat .relay/log` for session-start errors |
| Distiller never ran | `relay status` — `turns_since_distill` stuck at 5+? Stop hook not firing |
| `distiller_running` stuck | Distiller crashed. Check `.relay/log`, then run `relay distill --force` to reset |
| Push rejected | `git remote -v` — is remote configured? Does auth work? |
| Plugin hooks not firing | `ls ~/.claude/plugins/relay/hooks/hooks.json` — junction intact? |
| `claude -p` fails | Run `claude -p --bare "hello"` manually to check auth |
| Memory not on System B after distill | Distiller's auto-push may have been interrupted — run `git push` manually on System A, then `git pull` on System B |
| Random cmd window flashing during distillation | Pull latest relay source — fixed in `distiller.mjs` with `windowsHide: true` |
