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
