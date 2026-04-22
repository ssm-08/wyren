import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Walks dist/ after build and rewrites root-relative href attributes that
// start with "/" but don't already start with the site base.
// Skips protocol-relative, absolute URLs, anchors, and anything already prefixed.
export function baseHrefFixup({ base }) {
	const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
	return {
		name: 'relay:base-href-fixup',
		hooks: {
			'astro:build:done': async ({ dir }) => {
				if (!prefix) return;
				const root = fileURLToPath(dir);
				const files = await collectHtmlFiles(root);
				const re = /(\s(?:href|src))="(\/[^"#][^"]*)"/g;
				for (const file of files) {
					let html = await fs.readFile(file, 'utf8');
					let changed = false;
					const next = html.replace(re, (match, attr, url) => {
						if (url.startsWith('//')) return match;
						if (url.startsWith(prefix + '/')) return match;
						if (url === prefix) return match;
						changed = true;
						return `${attr}="${prefix}${url}"`;
					});
					if (changed) await fs.writeFile(file, next);
				}
			},
		},
	};
}

async function collectHtmlFiles(dir) {
	const out = [];
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...(await collectHtmlFiles(p)));
		else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
	}
	return out;
}
