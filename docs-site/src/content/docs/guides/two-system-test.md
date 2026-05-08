---
title: Two-system test walkthrough
description: End-to-end guide for verifying Wyren works across two machines — System A distills and pushes, System B receives memory at SessionStart.
---

This guide walks through a full end-to-end test of Wyren across two machines. By the end, a session on **System A** will have its decisions distilled into `.wyren/memory.md`, pushed to a shared git remote, and automatically injected into **System B**'s next session.

**Prerequisites on both systems:**
- Node.js 20+
- Claude Code installed and authenticated
- Git with SSH or HTTPS access to a shared remote repository

---

## Phase 1 — Shared repo setup

Do this once on either machine.

```bash
mkdir wyren-test-repo && cd wyren-test-repo
git init
git remote add origin git@github.com:YOUR_USERNAME/wyren-test-repo.git

echo "# Test" > README.md
git add README.md && git commit -m "init"
git push -u origin master
```

---

## Phase 2 — Install plugin on System A

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/ssm-08/wyren/master/install.sh | sh
```

**Windows (PowerShell):**

```powershell
iwr -useb https://raw.githubusercontent.com/ssm-08/wyren/master/install.ps1 | iex
```

**Dev / local clone (any OS):**

```bash
# From inside your wyren checkout
node scripts/installer.mjs install --from-local .
```

Verify install is healthy:
```bash
wyren doctor
# [wyren] doctor: all checks passed

node scripts/test-e2e.mjs   # 32 tests, ~25s, no Claude session needed
```

---

## Phase 3 — Install plugin on System B

Same one-liner as Phase 2 — run it on the second machine:

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/ssm-08/wyren/master/install.sh | sh
```

**Windows:**

```powershell
iwr -useb https://raw.githubusercontent.com/ssm-08/wyren/master/install.ps1 | iex
```

Verify:

```bash
wyren doctor
```

---

## Phase 4 — Initialize wyren in the shared repo (System A)

```bash
cd wyren-test-repo

wyren init
# Output: "Wyren initialized. Run: git add .wyren/memory.md && git commit"

git add .wyren/ .gitignore
git commit -m "chore: init wyren"
git push
```

---

## Phase 5 — Generate a session on System A

Open Claude Code in `wyren-test-repo`:

```bash
cd wyren-test-repo
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
cat .wyren/log               # shows "wrote memory.md (N chars)" on success
cat .wyren/memory.md         # bullet-point memory entries
wyren status
```

Expected `wyren status` output:

```
Memory:     .wyren/memory.md  (1.2 KB, 34 lines)
Distilled:  2026-04-22T10:30:00.000Z (2 min ago)
Last UUID:  abc12345
Progress:   0 / 5 turns until next distill
Transcript: /Users/alice/.claude/projects/.../abc12345.jsonl
Remote:     origin → git@github.com:YOUR_USERNAME/wyren-test-repo.git
```

The `Lock:` line only appears when a distiller process is actively running. If distillation appears stuck, run `wyren distill --force` to reset — check `.wyren/log` for the crash reason.

---

## Phase 6 — Push memory to remote

The distiller auto-pushes after writing memory. Confirm:

```bash
git log --oneline -3
# Should show a "[wyren] distill ..." commit
```

If the auto-push didn't fire (no remote configured at distill time):

```bash
wyren distill --push --force
```

---

## Phase 5b — Live sync: A's updates reach B without restart

Once both systems have active Claude Code sessions open in the shared repo, live sync kicks in automatically. After System A finishes a turn and the distiller pushes updated memory to git, System B's **next user prompt** triggers the `UserPromptSubmit` hook: it pulls the latest `.wyren/memory.md` (1.5s cap), diffs it against the last-seen snapshot, and injects only the new sections as hidden `additionalContext`. System B should see a `Wyren live update` block in its session context containing just the delta — no restart needed. To disable the pull while keeping the diff-based injection, set `WYREN_SKIP_PULL=1` in System B's environment.

---

## Phase 7 — Receive memory on System B

Pull the shared repo:

```bash
cd wyren-test-repo
git pull
cat .wyren/memory.md   # confirm memory arrived
```

Open Claude Code in the same repo:

```bash
claude
```

The `Loading wyren memory…` status message appears at startup — the SessionStart hook injected memory as hidden `additionalContext`. Verify by asking Claude:

> "What do you know about this project from previous sessions?"

Claude should recite the decisions from System A's session without being told anything.

---

## Quick force-test (skip the 5-turn wait)

Pipe a real transcript directly into the Stop hook to trigger distillation immediately:

```bash
TRANSCRIPT=$(ls ~/.claude/projects/*/transcripts/*.jsonl 2>/dev/null | tail -1)

echo "{\"cwd\": \"$(pwd)\", \"transcript_path\": \"$TRANSCRIPT\"}" \
  | node ~/.claude/wyren/hooks/stop.mjs

sleep 30 && cat .wyren/memory.md
```

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| Memory not injected on System B | `cat .wyren/log` for session-start errors |
| Distiller never ran | `wyren status` — `turns_since_distill` stuck at 5+? Stop hook not firing |
| `distiller_running` stuck | Distiller crashed. Check `.wyren/log`, then run `wyren distill --force` to reset |
| Push rejected | `git remote -v` — is remote configured? Does auth work? |
| Plugin hooks not firing | `wyren doctor` — check if plugin link exists and settings.json is wired |
| `claude -p` fails | Run `claude -p --bare "hello"` manually to check auth |
| Memory not on System B after distill | Distiller's auto-push may have been interrupted — run `git push` manually on System A, then `git pull` on System B |
| Random cmd window flashing during distillation | Pull latest wyren source — fixed in `distiller.mjs` with `windowsHide: true` |
