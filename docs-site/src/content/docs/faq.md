---
title: FAQ
description: Known issues, gotchas, and answers to the obvious questions.
---

## Why not just use CLAUDE.md?

`CLAUDE.md` is written by hand. It captures conclusions — the final answer to "what did we decide?" What it doesn't capture is the reasoning: why that decision was made, what was tried first, what broke, what's intentionally left in a broken state for now. That reasoning is exactly what a new Claude session needs to be useful from the first message.

Relay is complementary to `CLAUDE.md`, not a replacement. Think of it this way:

- **`CLAUDE.md`** — the project brief. You write it once (or occasionally update it). It covers stable facts: architecture, conventions, how to run the project.
- **`.relay/memory.md`** — the session log. Relay writes it continuously. It covers the moving parts: what changed today, what was rejected, what's temporarily broken.

Both get injected. Neither replaces the other.

## Why not Claude Projects?

Claude Projects let you upload documents as persistent context. That's useful for stable reference material. It has two limitations for team work: it doesn't update automatically as you work, and it's tied to one person's project — there's no shared sync across teammates.

## Will this work if we're not all on the same network?

Yes. Sync is over git, so any git remote (GitHub, self-hosted) works the same over LAN or WAN. Tested in both.

## What if git push fails?

Relay retries with `pull --rebase` up to 3 times. On final failure, the memory update stays local — it'll push on the next successful distill. Teammates are out of sync for one cycle. Documented as acceptable.

## Will my conversations leak to my teammates?

No. Only the *distilled* memory is pushed. Verbatim transcripts never leave your machine. The distiller's prompt explicitly forbids code snippets and conversation quotes.

That said: if you say something secret in a session on a shared repo, the *conclusion* of it may end up in memory. Treat `.relay/memory.md` like any other committed file.

## How do I disable Relay temporarily?

Use the Claude Code slash command:

```
/plugins disable relay
```

Re-enable with `/plugins enable relay`. This is the only supported toggle — the `RELAY_DISABLE` env var mentioned in early drafts is not wired up.

If you want to skip git fetch on a specific session (e.g. offline demo), set `RELAY_SKIP_PULL=1` before launching Claude Code. Memory injection still works from whatever is already on disk; only the pre-session pull is skipped.

## How do I stop distillation on a specific turn?

You can't, and you don't need to. The Tier 0 regex filter already kills ~70% of triggers. For fully private turns, disable the plugin for that session:

```
/plugins disable relay
```

Re-enable with `/plugins enable relay` when done.

## Memory is wrong / stale / contradictory — what do I do?

Hand-edit `.relay/memory.md`. The distiller treats your edits as trusted starting state. On the next distill, it merges new transcript signal against your edits.

If you want something permanent that the distiller should never touch, put it in `.relay/broadcast/CLAUDE.md` instead.

## A resolved workaround keeps showing up in memory. Why?

Most likely the transcript didn't mention the resolution explicitly. The distiller can't detect something it wasn't told. Two fixes:

1. Say "that workaround is fixed now" in the session — next distill catches it.
2. Hand-edit the memory file to remove it.

## Does this work with Cursor or Windsurf?

No. Relay uses Claude Code's hook system. Other editors have different (or no) hook surfaces.

Post-hackathon: a generic "transcript watcher" daemon could in theory support Cursor + Windsurf via their respective APIs. See [Future](/future/).

## How does Relay handle merge conflicts on `memory.md`?

If two teammates distill within the same second and both push, the second push fails non-fast-forward. Relay pulls the first person's version, re-runs the distiller against that new base (idempotent — transcripts are per-session), and pushes on attempt 2.

If the actual content conflicts on the same lines (rare), Relay takes `--theirs` (the incoming version) and re-distills locally. Ships the later one.

## What Claude Code version is supported?

Tested against Claude Code `2.1.x` (transcript schema observed during development). Earlier versions may have different JSONL shapes. README will pin the supported range.

## What about tmux, multi-tab, multi-process sessions?

Each Claude Code session has its own UUID and transcript. Relay handles them independently — each spawns its own distiller based on its own `Stop` hook firings. Watermarks are per-session.

The only coordination point is git pushes, which are serialized by the advisory lock.

## Why not just use `CLAUDE.md` and be done with it?

`CLAUDE.md` is static. It requires a human to remember to write it, at the moment they have least time to do so.

Relay is `CLAUDE.md` that writes itself, and syncs itself, and keeps itself honest. And it captures reasoning — rejected paths, live workarounds — that nobody would think to write into `CLAUDE.md` even if they had the time.

You can still use `CLAUDE.md` alongside Relay. They compose cleanly. Relay's broadcast mechanism even lets teams share a single canonical `CLAUDE.md` via `.relay/broadcast/CLAUDE.md`.

## Known limitations

1. **Distiller needs signal to work.** Pure research sessions (read, read, read) produce almost nothing in memory. That's intentional — noise is worse than nothing.
2. **Resolved-but-unmentioned workarounds linger.** Fix: say it's fixed, or hand-edit.
3. **Real-time sync is session-boundary, not per-turn.** Two teammates working simultaneously won't see each other's decisions until the next SessionStart cycle.
4. **`claude -p` required for zero-billing path.** Otherwise set `ANTHROPIC_API_KEY`.

## Where do I report bugs?

[GitHub issues](https://github.com/ssm-08/relay/issues).
