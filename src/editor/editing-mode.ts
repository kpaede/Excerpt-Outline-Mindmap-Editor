export type NodeEditingMode = 'multiline' | 'single-line';

/** Classic editing never flattens existing or newly pasted multiline content. */
export function useSingleLineEditor(mode: NodeEditingMode | undefined, text: string): boolean {
  return mode === 'single-line' && !/[\r\n]/.test(text);
}

export function countMultilineThoughts(nodes: readonly { text: string }[]): number {
  return nodes.filter(node => /[\r\n]/.test(node.text)).length;
}
