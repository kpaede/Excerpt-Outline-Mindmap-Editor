import { frontmatterEnd } from '../domain/outline-format';

/** Keep the current viewport preference in complete history snapshots. */
export function carrySavedZoom(source: string, zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return source;
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return `---${eol}excerpt-outline-mindmap: zoomFactor:${zoom}${eol}---${eol}${source}`;
  }
  const header = source.match(/^---\r?\n([\s\S]*?)^(?:---|\.\.\.)(?=\r?$)/m);
  if (!header) return source;
  const lines = header[1].split(/\r?\n/);
  const indexes = lines.map((line, i) => /^(?:excerpt-outline-mindmap|"excerpt-outline-mindmap"|'excerpt-outline-mindmap')\s*:/.test(line) ? i : -1).filter(i => i >= 0);
  if (indexes.length > 1) return source;
  const index = indexes[0];
  if (index !== undefined && !lines[index].startsWith('excerpt-outline-mindmap:')) return source;
  const prefix = 'excerpt-outline-mindmap:';
  const parts = index === undefined ? [] : lines[index].slice(prefix.length).trim().split(';').filter(Boolean);
  const existing = parts.findIndex(part => part.startsWith('zoomFactor:'));
  if (existing >= 0) parts[existing] = `zoomFactor:${zoom}`;
  else parts.push(`zoomFactor:${zoom}`);
  const property = `${prefix} ${parts.join(';')}`;
  if (index === undefined) lines.splice(lines.length - 1, 0, property);
  else lines[index] = property;
  return source.slice(0, 3 + eol.length) + lines.join(eol) + source.slice(header[0].length - 3);
}

/** Only the canonical saved zoom may bypass a Markdown/layout rebuild. */
export function savedZoomOnlyChanged(before: readonly string[], after: readonly string[]): boolean {
  if (before.length !== after.length) return false;
  const end = frontmatterEnd([...before]);
  if (!end || end !== frontmatterEnd([...after])) return false;
  const property = 'excerpt-outline-mindmap:';
  const indexes = before.map((line, i) => i > 0 && i < end - 1 && line.startsWith(property) ? i : -1).filter(i => i >= 0);
  if (indexes.length !== 1) return false;
  const index = indexes[0];
  if (!after[index].startsWith(property) || before[index] === after[index]) return false;
  const withoutZoom = (line: string): string | null => {
    const parts = line.slice(property.length).trim().split(';');
    const zoom = parts.filter(part => part.startsWith('zoomFactor:'));
    if (zoom.length > 1 || zoom.some(part => !/^zoomFactor:(?:\d+\.?\d*|\.\d+)$/.test(part) || Number(part.slice(11)) <= 0)) return null;
    return parts.filter(part => !part.startsWith('zoomFactor:')).join(';');
  };
  const first = withoutZoom(before[index]);
  const second = withoutZoom(after[index]);
  return first !== null && first === second && before.every((line, i) => i === index || line === after[i]);
}
