# Security Policy

## Supported versions

The current npm release (`@ssm-08/wyren`) is the only supported version.

## Reporting a vulnerability

**Do not file a public GitHub issue for security vulnerabilities.**

Open a [GitHub Security Advisory](https://github.com/ssm-08/wyren/security/advisories/new)
to report privately. Include:

- Description of the vulnerability and potential impact
- Steps to reproduce or proof-of-concept
- Wyren version (`wyren --version`), OS, and Node version

You'll receive a response within 7 days. Fixes are released as patch versions and disclosed
publicly once a fix is available.

## Scope

Wyren runs on your local machine with your existing Claude Code credentials. It reads session
transcripts, writes to `.wyren/` in your repo, and calls the `claude` CLI subprocess.

Out of scope: vulnerabilities in Claude Code itself, npm, git, or Node.js — report those to
their respective maintainers.

## Privacy considerations

`.wyren/memory.md` is committed to your git repo. It contains distilled session context —
decisions, rejected approaches, and live workarounds. If your repo is **public**, this file
is publicly readable.

**Keep your repo private unless you are comfortable with your team's working memory being
publicly visible.** Treat `.wyren/memory.md` like any other committed file that may contain
sensitive project context.

Verbatim transcripts never leave your machine. The distiller extracts conclusions only — no
code snippets, no conversation quotes. But conclusions can still be sensitive.

To audit memory: `cat .wyren/memory.md`. Hand-edit or delete entries at any time — Wyren
treats your edits as trusted state.
