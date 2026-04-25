---
title: Future
description: Cloud sync, MCP RAG, permissions, dashboard — what comes next.
---

Everything below is designed for but not yet built. The architecture is already pluggable — these are the natural extensions.

## Cloud sync backend

The `RelaySync` interface has two methods: `pull()` and `push()`. `GitSync` is the default. A `CloudSync` implementation would slot in with zero changes to hooks.

**Candidate backends:**

| Backend | Pros | Cons |
|---|---|---|
| Cloudflare Worker + KV | 15-min deploy, global edge, free tier. | Shared secret distribution. |
| Supabase | Auth + realtime + postgres in one. | Overkill for just memory sync. |
| Firebase Realtime DB | Dead simple, free tier. | Locked to Google. |
| S3 + conditional writes | Cheap, durable, simple. | No realtime, need polling. |

**Preferred:** Cloudflare Worker + KV. Simple, fast, cheap.

**Interface:**

```js
class CloudSync extends RelaySync {
  constructor({ endpoint, teamId, secret }) { super(); /* ... */ }
  async pull() { /* GET /memory/<teamId> */ }
  async push(memory) { /* PUT /memory/<teamId> with If-Match ETag */ }
}
```

ETag conditional writes give optimistic concurrency control without app-level locks.

## MCP server for on-demand transcript RAG

Current Relay injects distilled memory. A separate MCP server could expose tools for *on-demand* retrieval:

```
relay_search(query: string) -> top-K transcript chunks from teammates
relay_history(topic: string) -> timeline of decisions on a topic
relay_who_decided(question: string) -> session/turn citation
```

Implementation: index teammate transcripts into a local embedding store (SQLite + sqlite-vec), expose via MCP. Claude calls the tool when it needs deep context — on-demand, not always-on.

Complements (doesn't replace) the SessionStart injection path.

## Permissions & multi-team

Current Relay assumes trust model = same team. A real product needs:

- **Per-user memory visibility.** "Alice can see what Bob decided on `/auth/*` but not on private sessions."
- **Team boundaries.** Memory is scoped to a team, not a repo.
- **Audit log.** Who saw what memory, when.

All of this requires a server (or at least a signed-identity layer over git). Out of scope for the current release.

## Dashboard / web UI

A browser view of:

- Current memory per repo.
- Recent distillations per teammate.
- Decisions timeline.
- Skills broadcast history.
- Memory diff view (before/after each distill).

Not a core value driver — memory.md in a text editor is already fine — but great for stakeholder pitches and async teams.

Most hackable version: a tiny Astro site that reads `.relay/*` and renders. GitHub Pages is enough.

## Cursor / Windsurf / other editors

Relay is Claude Code-specific today (uses Claude Code hooks). Generalizing requires:

1. A "transcript watcher" daemon that understands each editor's log format.
2. A unified memory format (already markdown — done).
3. A shared sync layer (already pluggable — done).

The plumbing is there. It's a matter of writing adapters.

## Self-hosted / offline distillation

If a team doesn't want any data to leave their network:

- **Tier 0** already runs locally.
- **Tier 1** could swap Haiku for a local model (Llama 3.1 8B via Ollama, Qwen 2.5, Gemma 3n).
- **Tier 2** could call a self-hosted Claude via `ANTHROPIC_BASE_URL` override.

Quality drops with small local models, but the pipeline is identical.

## Temporal memory / decision timeline

Current memory is a snapshot — latest state only. A future version could keep a **timeline**:

```markdown
## Timeline of decisions

### 2026-04-21 10:32
- Picked SQLite over Postgres  [session 7a2e]

### 2026-04-21 14:45
- Reversed — moved to Postgres (hit SQLite concurrency limits in /api/bulk)  [session 3f1b]
```

Useful for retrospectives, post-mortems, demo narratives. Implementation: append-only log alongside the snapshot file.

## Per-module memory

For larger codebases, split memory by directory:

```
.relay/
├── memory.md                    # cross-cutting
├── memory/
│   ├── auth.md                  # scoped to /src/auth
│   ├── api.md                   # scoped to /src/api
│   └── frontend.md              # scoped to /src/frontend
```

Distiller routes entries to the right module based on file paths mentioned in the transcript. Injection picks the relevant ones based on `cwd` at session start.

Out of scope for now — most projects don't need it early. Obvious addition as the codebase scales.

## Evaluation harness

A regression test suite for the distiller prompt:

- 10-20 real transcripts annotated with "what a good memory would contain."
- CI runs distiller on each, diffs against gold memory, reports drift.
- Gates prompt changes on quality metrics.

Prevents prompt regressions when iterating.

## Integration with existing tools

- **Linear / Jira:** `relay_sync_to_linear` tool — push open questions into tickets.
- **Slack:** bot posts memory diffs to a team channel.
- **GitHub Actions:** `.relay/memory.md` gets rendered into PR descriptions automatically.

All low-hanging once the core memory loop works.
