---
title: Tech stack
description: Every layer, every choice, every reason.
---

## At a glance

| Layer | Choice | Why |
|---|---|---|
| **Language** | Node.js (ESM, `.mjs`) | Claude Code's native ecosystem. Hooks are shell commands — `node` is universally present. |
| **Runtime deps** | Zero | Stdlib only: `node:fs`, `node:child_process`, `node:path`, `node:readline`, `node:os`. Optional `@anthropic-ai/sdk` for SDK-fallback mode. No bundler. |
| **AI — preferred** | `claude -p` headless | Rides user's existing Claude Code auth. Zero additional billing. |
| **AI — Tier 0 (filter)** | Local weighted scoring | **Free.** Kills ~70% of triggers before any API call. Runs in Node, no subprocess. |
| **AI — Tier 1 (routine)** | Claude Haiku 4.5 | Cheap (~$0.003/call cached). Handles all automated distillation. |
| **AI — Tier 2 (deep cleanup)** | Claude Sonnet 4.6 | Available via `--model` flag; no automatic trigger yet. Planned for Haiku drift correction. |
| **Sync** | Git (scoped to `.wyren/`) | Zero infra. LAN + WAN. Free history. Pluggable behind `WyrenSync`. |
| **Storage** | Filesystem markdown | Human-readable, git-diffable, native Claude context format. |
| **SessionStart hook** | `additionalContext` injection | Only Claude Code surface that injects hidden system context at session init. |
| **Stop hook** | Watermark + detached spawn | Tracks turn count; spawns distiller detached after threshold (5 turns or 2 min idle). Never blocks. |
| **UserPromptSubmit hook** | Live sync delta injection | Pulls remote on every user turn; injects only sections added since last injection. 3 s budget. |
| **Distribution** | `install.sh` / `install.ps1` one-liners | Clone to `~/.claude/wyren/`, wire hooks in `settings.json`, register `wyren` CLI via `npm install -g`. |
| **CLI** | `bin/wyren.mjs` | `init`, `status`, `distill`, `broadcast-skill`, `install`, `update`, `uninstall`, `doctor`, `log`. Pure Node. |
| **Docs site** | Astro Starlight → GitHub Pages | Markdown-native, search, dark mode, Mermaid, Node-aligned. |

## Totals

- **External services:** Anthropic API (only if `claude -p` unavailable), git remote.
- **No database. No server. No auth. No frontend.**

## Non-choices (what we explicitly do NOT use)

| Thing | Why not |
|---|---|
| TypeScript | Zero build step. Node runs `.mjs` directly; stdlib types are sufficient. |
| Bundler (webpack, esbuild) | Nothing to bundle. |
| Database | Filesystem markdown fits. No query surface needed. |
| Custom server | Git is the sync layer. |
| Auth | Trust model = same team. Git remote access is the permission boundary. |
| Docker | Nothing to containerize. |
| Observability stack | `.wyren/log` + `wyren status` CLI. |
| Test framework beyond `node:test` | Stdlib is sufficient. |
| React / Vue / Svelte | Docs site uses Starlight; plugin has no UI. |

## Why no MCP server?

MCP servers are **tool-invocable only** — Claude calls them as tools during a conversation. They cannot inject system context at session initialization.

Wyren's core value is *automatic* context at start, which only hooks can deliver. An MCP server is a viable post-ship addition — on-demand query of teammate transcripts via a `wyren_search(query)` tool — but is intentionally deferred. See [Future](/future/).

## Why Node, not Python?

Two reasons:

1. **Claude Code is Node.** Hooks are shell commands; Node is guaranteed present on any machine running Claude Code.
2. **Zero deps possible.** A Python distiller would need `anthropic` package + pip + venv. The Node distiller shells out to `claude -p` via built-in `child_process` — zero install steps on teammate machines.
