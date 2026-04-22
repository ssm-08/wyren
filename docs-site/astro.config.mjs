// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { rehypeMermaidPre } from './src/plugins/rehype-mermaid-pre.mjs';
import { rehypeBaseHref } from './src/plugins/rehype-base-href.mjs';
import { baseHrefFixup } from './src/plugins/astro-base-href-fixup.mjs';

// https://astro.build/config
// site/base can be overridden via env for GitHub Pages deployment:
//   RELAY_SITE=https://<user>.github.io  RELAY_BASE=/<repo-name>  npm run build
const BASE = process.env.RELAY_BASE || '/relay';

export default defineConfig({
	site: process.env.RELAY_SITE || 'https://ssm-08.github.io',
	base: BASE,
	markdown: {
		syntaxHighlight: {
			type: 'shiki',
			excludeLangs: ['mermaid'],
		},
		rehypePlugins: [
			rehypeMermaidPre,
			[rehypeBaseHref, { base: BASE }],
		],
	},
	integrations: [
		baseHrefFixup({ base: BASE }),
		starlight({
			title: 'Relay',
			description: 'Shared brain for teams using Claude Code. One memory, every session warm.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/ssm-08/relay' },
			],
			head: [
				{
					tag: 'script',
					attrs: { type: 'module' },
					content: `
						import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
						const preferDark = matchMedia('(prefers-color-scheme: dark)').matches;
						mermaid.initialize({
							startOnLoad: true,
							theme: preferDark ? 'dark' : 'default',
							securityLevel: 'loose',
						});
						document.addEventListener('astro:page-load', () => {
							mermaid.run({ querySelector: 'pre.mermaid' });
						});
					`,
				},
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'What is Relay?', slug: 'index' },
						{ label: 'The problem', slug: 'problem' },
						{ label: 'How it works', slug: 'how-it-works' },
					],
				},
				{
					label: 'Design',
					items: [
						{ label: 'Architecture', slug: 'architecture' },
						{ label: 'Tech stack', slug: 'tech-stack' },
						{ label: 'Cost model', slug: 'cost-model' },
					],
				},
				{
					label: 'Roadmap',
					items: [
						{ label: 'Six chunks overview', slug: 'roadmap/overview' },
						{ label: 'Chunk 1 — Distiller', slug: 'roadmap/1-distiller' },
						{ label: 'Chunk 2 — Plugin skeleton', slug: 'roadmap/2-skeleton' },
						{ label: 'Chunk 3 — Distillation wired', slug: 'roadmap/3-distillation' },
						{ label: 'Chunk 4 — Git sync', slug: 'roadmap/4-git-sync' },
						{ label: 'Chunk 5 — Broadcast + demo', slug: 'roadmap/5-broadcast' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Install', slug: 'reference/install' },
						{ label: 'Hook contracts', slug: 'reference/hooks' },
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'memory.md schema', slug: 'reference/memory-schema' },
						{ label: 'Distiller prompt', slug: 'reference/distiller-prompt' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Two-system test', slug: 'guides/two-system-test' },
					],
				},
				{
					label: 'Meta',
					items: [
						{ label: 'Demo script', slug: 'demo' },
						{ label: 'FAQ', slug: 'faq' },
						{ label: 'Future', slug: 'future' },
					],
				},
			],
			customCss: ['./src/styles/custom.css'],
		}),
	],
});
