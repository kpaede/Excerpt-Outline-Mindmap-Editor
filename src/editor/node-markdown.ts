import type { OutlineNode } from '../utils/outline';

/** Preserve legacy presentation; v2 must pass full Markdown through intact. */
export function nodeMarkdown(node: OutlineNode): string {
  if (node.format === 2) return node.text;
  return node.text.replace(/\|([^|]*)\|/g, '`$1`').replace(/%%[^%]*%%/g, '');
}
