import { flattenOutline, isOutlineCompatible, parseOutline } from '../utils/outline';
import { frontmatterEnd, outlineVersion, serializeOutline } from './outline-format';

export interface MigrationPreview { before: string; after: string; nodeCount: number; }

export function previewMigration(before: string): MigrationPreview {
  const roots = parseOutline(before);
  const nodes = flattenOutline(roots);
  if (outlineVersion(before) === 2) return { before, after: before, nodeCount: nodes.length };
  if (!isOutlineCompatible(before)) throw new Error('Legacy file contains ambiguous continuation text. Original retained; review it in Markdown first.');
  const lines = before.split(/\r?\n/);
  const newline = before.includes('\r\n') ? '\r\n' : '\n';
  // Preserve each non-node line verbatim, including headings and frontmatter.
  const nodesByLine = new Map(nodes.map(node => [node.line, node]));
  const depthByNode = new Map<typeof nodes[number], number>();
  const stack = roots.map(node => ({ node, depth: 0 }));
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    depthByNode.set(node, depth);
    node.children.forEach(child => stack.push({ node: child, depth: depth + 1 }));
  }
  const migrated = lines.map((line, index) => {
    const node = nodesByLine.get(index);
    return node ? serializeOutline([{ ...node, children: [] }], depthByNode.get(node)) : line;
  });
  if (frontmatterEnd(lines)) migrated.splice(1, 0, 'eome-outline-format: 2');
  else migrated.unshift('---', 'eome-outline-format: 2', '---');
  const after = migrated.join(newline);
  const check = flattenOutline(parseOutline(after));
  if (check.length !== nodes.length || check.some((node, index) => node.text !== nodes[index].text || node.checkbox !== nodes[index].checkbox || node.children.length !== nodes[index].children.length)) {
    throw new Error('Migration verification failed. Original retained.');
  }
  return { before, after, nodeCount: nodes.length };
}
