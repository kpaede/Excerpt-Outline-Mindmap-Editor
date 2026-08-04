import type { NodeSingular } from 'cytoscape';

/**
 * Orders nodes by their position in the Markdown document, which is stored on
 * each node as `order` when the graph is built.
 */
export function sortByMarkdownOrder(a: NodeSingular, b: NodeSingular): number {
  return (Number(a.data('order')) || 0) - (Number(b.data('order')) || 0);
}
