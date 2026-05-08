# Wyren docs site

Astro Starlight site for the Wyren project.

Source: `src/content/docs/`
Live: `https://ssm-08.github.io/wyren/` (deploys via `.github/workflows/docs.yml`)

## Local dev

```bash
npm install
npm run dev     # http://localhost:4321/wyren/ — live reload
```

## Build

```bash
npm run build   # static HTML in dist/
npm run preview # serve dist/ locally
```

## Deploy

Push to `main` or `master` with changes under `docs-site/**` triggers the
GitHub Actions workflow. Pages settings must be set to "GitHub Actions"
as the deployment source (not "Deploy from a branch").

Base path and site URL are auto-derived from the GitHub repo in CI:
`WYREN_SITE=https://<owner>.github.io` and `WYREN_BASE=/<repo>`.
Override locally or in CI by exporting either var.

## Custom plugins

- `src/plugins/rehype-mermaid-pre.mjs` — transforms \`\`\`mermaid fences into
  `<pre class="mermaid">` for client-side rendering.
- `src/plugins/rehype-base-href.mjs` — prepends the site base path to
  root-relative links in markdown output.
- `src/plugins/astro-base-href-fixup.mjs` — post-build HTML walker that
  fixes root-relative hrefs in Starlight-generated layout (hero
  buttons) that bypass the markdown pipeline.

## Content layout

```
src/content/docs/
├── index.mdx                  # landing (splash)
├── problem.md                 # shared-context pain
├── how-it-works.md            # Alice/Bob walkthrough
├── architecture.md            # diagrams + components
├── tech-stack.md              # layer-by-layer choices
├── cost-model.md              # tiered extraction pricing
├── roadmap/
│   ├── overview.md            # six chunks at a glance
│   └── {1..5}-*.md            # per-chunk deep dives
├── reference/
│   ├── install.md
│   ├── hooks.md
│   ├── cli.md
│   ├── memory-schema.md
│   └── distiller-prompt.md
├── demo.md
├── faq.md
└── future.md
```
