import { visit } from 'unist-util-visit';

export function rehypeMermaidPre() {
	return (tree) => {
		visit(tree, 'element', (node) => {
			if (node.tagName !== 'pre') return;
			const code = node.children?.[0];
			if (!code || code.tagName !== 'code') return;
			const classes = code.properties?.className || [];
			const isMermaid = classes.some(
				(c) => c === 'language-mermaid' || c === 'mermaid',
			);
			if (!isMermaid) return;

			const text = (code.children || [])
				.filter((c) => c.type === 'text')
				.map((c) => c.value)
				.join('');

			node.tagName = 'pre';
			node.properties = { className: ['mermaid'] };
			node.children = [{ type: 'text', value: text }];
		});
	};
}
