import { visit } from 'unist-util-visit';

// Prepends the Astro site base path to all root-relative <a href> values.
// Runs at build time so the output HTML is portable to any subpath.
export function rehypeBaseHref({ base }) {
	const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
	return (tree) => {
		if (!normalized) return;
		visit(tree, 'element', (node) => {
			if (node.tagName !== 'a') return;
			const href = node.properties?.href;
			if (typeof href !== 'string') return;
			if (!href.startsWith('/')) return;          // relative — skip
			if (href.startsWith('//')) return;          // protocol-relative — skip
			if (href.startsWith(normalized + '/')) return;  // already prefixed
			if (href === normalized) return;
			node.properties.href = normalized + href;
		});
	};
}
