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
  return extractEmbedLinks(markdown)[0] ?? null;
}

export function extractEmbedLinks(markdown: string): string[] {
  const pattern = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}
