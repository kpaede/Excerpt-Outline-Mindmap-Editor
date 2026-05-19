export function getPrimaryZoteroLink(text: string): string | null {
  const links: string[] = [];
  const linkRegex = /\]\((zotero:\/\/[^)\s]+(?:\([^)]*\)[^)\s]*)?)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    links.push(match[1]);
  }

  return links.find((link) => /^zotero:\/\/open-/i.test(link)) ?? links[0] ?? null;
}
