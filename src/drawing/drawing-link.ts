export function extractDrawingLink(markdown: string): string | null {
  const match = markdown.match(/!\[\[([^\]|]+\.svg)(?:\|[^\]]+)?\]\]/i);
  return match?.[1]?.trim() ?? null;
}

/**
 * Returns the target of the first embed in a node, whatever it points at.
 *
 * Unlike extractDrawingLink this makes no assumption about the extension,
 * because an Excalidraw drawing can be an ordinary `.md` file. Callers resolve
 * the target and decide what it is.
 */
export function extractEmbedLink(markdown: string): string | null {
  const match = markdown.match(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return match?.[1]?.trim() ?? null;
}
