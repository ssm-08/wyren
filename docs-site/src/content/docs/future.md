---
title: Future
description: Persistent memory graph, cloud sync, MCP RAG, permissions, dashboard — what comes next.
---

Everything below is designed for but not yet built. The architecture is already pluggable — these are the natural extensions.

## Cloud sync backend

The `WyrenSync` interface has two methods: `pull()` and `push()`. `GitSync` is the default. A `CloudSync` implementation would slot in with zero changes to hooks.

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
class CloudSync extends WyrenSync {
  constructor({ endpoint, teamId, secret }) { super(); /* ... */ }
  async pull() { /* GET /memory/<teamId> */ }
  async push(memory) { /* PUT /memory/<teamId> with If-Match ETag */ }
}
```

ETag conditional writes give optimistic concurrency control without app-level locks.

## MCP server for on-demand transcript RAG

Current Wyren injects distilled memory. A separate MCP server could expose tools for *on-demand* retrieval:

```
wyren_search(query: string) -> top-K transcript chunks from teammates
wyren_history(topic: string) -> timeline of decisions on a topic
wyren_who_decided(question: string) -> session/turn citation
```

Implementation: index teammate transcripts into a local embedding store (SQLite + sqlite-vec), expose via MCP. Claude calls the tool when it needs deep context — on-demand, not always-on.

Complements (doesn't replace) the SessionStart injection path.

## Permissions & multi-team

Current Wyren assumes trust model = same team. A real product needs:

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

Most hackable version: a tiny Astro site that reads `.wyren/*` and renders. GitHub Pages is enough.

## Cursor / Windsurf / other editors

Wyren is Claude Code-specific today (uses Claude Code hooks). Generalizing requires:

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

## Persistent memory graph

Current Wyren culls. When `memory.md` fills up, the distiller drops the least load-bearing entries to stay under the 60-line cap. Old-but-valid decisions fall out.

The long-term direction: replace culling with rendering. `memory.md` becomes a **viewport** into a persistent knowledge graph. Nothing is ever discarded — entries outside the current view remain in the graph, connected and queryable.

**What changes:**

- The 60-line cap becomes a rendering limit, not a storage limit.
- Decisions persist through connections, not manual retention. A decision made in session 12 resurfaces in session 47 when relevant context reappears — without anyone explicitly keeping it alive.
- Reasoning is queryable: not just *what* is known, but *why*, *what it impacts*, and *what's been tried*.
- Cross-time, cross-domain connectivity: a rejected approach from three months ago resurfaces when the same problem recurs, regardless of who originally tried it.

**Mental model shift:**

| | |
|---|---|
| Before | Memory = what survived culling |
| After | Memory = everything, selectively rendered by relevance |

**Backwards compatibility:** `memory.md` stays as the rendered output format. The graph is the backing store. v1 consumers see no change.

**Implementation sketch:** a local graph DB (SQLite + edges table) stores every distilled entry with session ID, timestamp, and source turns. On session start, a relevance query against current `cwd` and recent transcript signal determines the rendered slice. The distiller writes to the graph first, then renders `memory.md` from it.

Not yet designed in detail. Building this requires settling on a storage layer and query model before touching the distiller.

## Per-module memory

For larger codebases, split memory by directory:

```
.wyren/
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

- **Linear / Jira:** `wyren_sync_to_linear` tool — push open questions into tickets.
- **Slack:** bot posts memory diffs to a team channel.
- **GitHub Actions:** `.wyren/memory.md` gets rendered into PR descriptions automatically.

All low-hanging once the core memory loop works.
