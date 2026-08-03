export function extractDrawingLink(markdown: string): string | null {
  const match = markdown.match(/!\[\[([^\]|]+\.svg)(?:\|[^\]]+)?\]\]/i);
  return match?.[1]?.trim() ?? null;
}
