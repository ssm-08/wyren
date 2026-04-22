---
title: Install
description: Five commands. Two minutes. One shared brain.
---

## Prerequisites

- Claude Code installed on every teammate's machine.
- Git remote for the target repo (GitHub, GitLab, or self-hosted — any works).
- Node.js 20+ (bundled with recent Claude Code installs).

## Step 1 — Install the plugin

Every teammate runs once:

```bash
claude /plugins add https://github.com/ssm-08/relay
```

This installs `~/.claude/plugins/relay/` and registers the `SessionStart` + `Stop` hooks automatically.

Verify:

```bash
claude /plugins list
# should show: relay v0.1.0
```

## Step 2 — Initialize the repo

One teammate, once per repo:

```bash
cd <your-repo>
relay init
```

This creates:

```
.relay/
├── memory.md           # git-tracked, empty stub
├── broadcast/          # git-tracked, empty
└── state/              # NOT tracked — per-machine
```

And appends to `.gitignore`:

```
.relay/state/
.relay/log
```

## Step 3 — Commit and push

```bash
git add .relay .gitignore
git commit -m "Add Relay shared memory"
git push
```

## Step 4 — Teammates pull

```bash
git pull
```

That's it. Next time anyone opens Claude Code in this repo, `SessionStart` hook kicks in automatically. Memory injects, background distillation begins, git syncs the results.

## Verifying the install

```bash
relay status
```

Example output:

```
Relay v0.1.0
─────────────────────────────────────
Repo:         /path/to/repo
Memory:       .relay/memory.md (23 lines, 1.2 KB)
Broadcast:    3 files
Last distill: 4 minutes ago (session 7a2e)
Watermark:    at turn 47 of 52
Git remote:   origin (push OK)
Lock:         free
```

## Uninstall

```bash
claude /plugins remove relay
rm -rf ~/.claude/plugins/relay
```

In a repo:
```bash
rm -rf .relay
# remove .relay entries from .gitignore
```

## Environment variables (optional)

| Var | Default | Purpose |
|---|---|---|
| `RELAY_MODEL` | `claude-haiku-4-5-20251001` | Tier 1 distillation model |
| `RELAY_DEEP_MODEL` | `claude-sonnet-4-6` | Tier 2 deep re-compression |
| `RELAY_TURN_THRESHOLD` | `5` | Turns between distillations |
| `RELAY_IDLE_MS` | `120000` | Idle timeout in ms |
| `RELAY_DISABLE` | `0` | Set to `1` to silently no-op all hooks |
| `ANTHROPIC_API_KEY` | (unset) | SDK fallback if `claude -p` unavailable |

## Troubleshooting

See [FAQ](/faq/) for common issues.
