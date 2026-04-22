---
title: Tech stack
description: Every layer, every choice, every reason.
---

## At a glance

| Layer | Choice | Why |
|---|---|---|
| **Language** | Node.js (ESM, `.mjs`) | Claude Code's native ecosystem. Hooks are shell commands → `node` is universally present. |
| **Runtime deps** | Zero for MVP | Stdlib only: `node:fs`, `node:child_process`, `node:path`, `node:readline`. Optional `@anthropic-ai/sdk` for SDK-fallback mode. No bundler. |
| **AI — preferred** | `claude -p` headless | Rides user's existing Claude Code auth. Zero new billing. |
| **AI — Tier 0 (filter)** | Local regex | **Free.** Kills ~70% of triggers before any API call. |
| **AI — Tier 1 (routine)** | Claude Haiku 4.5 | Cheap (~$0.003/call cached). Handles 90% of distillations. |
| **AI — Tier 2 (deep)** | Claude Sonnet 4.6 | Hourly + session-close cleanup. Fixes Haiku drift. |
| **Sync** | Git (scoped to `.relay/`) | Zero infra. LAN + WAN. Free history. Pluggable behind `RelaySync`. |
| **Storage** | Filesystem markdown | Human-readable, git-diffable, native Claude context format. |
| **Injection** | `SessionStart` → `additionalContext` | Only Claude Code surface that injects hidden system context at init. |
| **Trigger** | `Stop` hook + detached spawn | Never blocks user. Debounced 5 turns OR 2 min idle. |
| **Distribution** | Claude Code plugin | `/plugins add relay` → hooks auto-register. |
| **CLI** | `bin/relay` | `init`, `status`, `distill`, `broadcast-skill`. Pure node. |
| **Prompt caching** | Anthropic SDK caching | 90% discount on repeat system prompt + memory prefix (SDK path only). |
| **Docs site** | Astro Starlight → GitHub Pages | This site. Markdown-native, search, dark mode, Mermaid, Node-aligned. |

## Totals

- **New code:** ~800 LOC (hooks + distiller + sync + CLI + prompt).
- **External services:** Anthropic API (only if `claude -p` unavailable), git remote.
- **No database. No server. No auth. No frontend.**

## Non-choices (what we explicitly do NOT use)

| Thing | Why not |
|---|---|
| TypeScript | Node deps only, `.mjs` gets us ESM with zero build step. Hackathon speed. |
| Bundler (webpack, esbuild) | Nothing to bundle. Node runs `.mjs` directly. |
| Database | Filesystem markdown fits. No query surface needed. |
| Custom server | Git is the sync layer. |
| Auth | Trust model = same team. Git remote access is the permission boundary. |
| Docker | Nothing to containerize. |
| Observability stack | `.relay/log` + `relay status` CLI. |
| Test framework beyond `node:test` | Stdlib is enough for 48h. |
| React / Vue / Svelte | Docs site uses Starlight; plugin has no UI. |

## Why no MCP server?

MCP servers are **tool-invocable only** — Claude calls them as tools during a conversation. They cannot inject system context at session initialization.

Relay's core value is *automatic* context at start, which only hooks can do. An MCP server is still a **great post-hackathon addition** — on-demand query of teammate transcripts via `relay_search(query)` tool. Explicitly deferred to [Future](/future/).

## Why Node, not Python?

Two reasons:

1. **Claude Code is Node.** Hooks are shell commands; Node is guaranteed present.
2. **Zero deps possible.** Python distiller would need `anthropic` package + pip + venv. Node distiller shells out to `claude -p` with built-in `child_process` — zero install steps on teammate machines.

Python would be fine. Node is just marginally cheaper in hackathon-hours.
