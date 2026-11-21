import type { MindmapCommand } from '../history/command-history';
import type { OutlineNode } from '../utils/outline';

export interface CommandContext {
  filePath?: string;
  nodes: OutlineNode[];
  selectedIds: Set<string | undefined>;
  cutIds: Set<string | undefined>;
}
interface Range { start: number; end: number; }

/** Preserve identities from the actual command, including indistinguishable empty nodes. */
export function commandNodeIdentities(command: MindmapCommand, nodes: OutlineNode[]): Map<number, string> {
  const ids = new Map<number, string>();
  const source = nodes.find(node => node.line === command.nodeInfo.line);
  const target = nodes.find(node => node.line === command.targetInfo?.line);
  const metadata = command.metadata ?? {};
  const delta = command.afterState.split(/\r?\n/).length - command.beforeState.split(/\r?\n/).length;
  const lines = Array.isArray(metadata.sourceLines) ? metadata.sourceLines.filter((line): line is number => typeof line === 'number') : [command.nodeInfo.line];
  const selected = nodes.filter(node => lines.includes(node.line));
  let removed: Range[] = [];
  let insertion = 0;
  let inserted = Math.max(0, delta);
  let moved = false;
  let preserveSource = false;
  switch (command.type) {
    case 'move-subtree': {
      removed = (metadata.cutPaste ? selected : source ? [source] : []).map(node => ({ start: node.line, end: node.endLine + 1 }));
      insertion = typeof metadata.targetHeadingLine === 'number' ? metadata.targetHeadingLine + 1
        : metadata.cutPaste ? (target?.endLine ?? -1) + 1
        : metadata.insertAsChild ? metadata.childInsertPosition === 'last' ? (target?.endLine ?? -1) + 1 : target?.ownEnd ?? (target?.line ?? -1) + 1
        : metadata.siblingInsertPosition === 'before' ? target?.line ?? 0 : (target?.endLine ?? -1) + 1;
      moved = true; break;
    }
    case 'delete-node': removed = selected.map(node => ({ start: node.line, end: node.endLine + 1 })); break;
    case 'delete-node-keep-children': removed = selected.map(node => ({ start: node.line, end: node.ownEnd ?? node.line + 1 })); break;
    case 'delete-heading': removed = [{ start: command.nodeInfo.line, end: command.nodeInfo.line + 1 }]; break;
    case 'add-heading': insertion = command.nodeInfo.line; break;
    case 'add-sibling': insertion = metadata.siblingInsertPosition === 'before' ? source?.line ?? 0 : (source?.endLine ?? -1) + 1; break;
    case 'add-child':
    case 'add-child-text': insertion = command.nodeInfo.marker === '#' ? command.nodeInfo.line + 1
      : metadata.childInsertPosition === 'first' ? source?.ownEnd ?? (source?.line ?? -1) + 1 : (source?.endLine ?? -1) + 1; break;
    case 'edit-node':
      if (delta && source) {
        removed = [{ start: source.line, end: source.ownEnd ?? source.line + 1 }];
        insertion = source.line; inserted = (source.ownEnd ?? source.line + 1) - source.line + delta;
        preserveSource = true;
      }
      break;
    default: break;
  }
  removed.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: Range[] = [];
  for (const range of removed) {
    const last = ranges[ranges.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else ranges.push({ ...range });
  }
  const length = (range: Range) => range.end - range.start;
  if (moved) inserted = ranges.reduce((count, range) => count + length(range), 0);
  const destination = insertion - ranges.filter(range => range.end <= insertion).reduce((count, range) => count + length(range), 0);
  for (const node of nodes) {
    if (!node.id) continue;
    const rangeIndex = ranges.findIndex(range => node.line >= range.start && node.line < range.end);
    if (rangeIndex >= 0) {
      if (moved) ids.set(destination + ranges.slice(0, rangeIndex).reduce((count, range) => count + length(range), 0) + node.line - ranges[rangeIndex].start, node.id);
      else if (preserveSource && node.line === source?.line) ids.set(destination, node.id);
      continue;
    }
    let line = node.line - ranges.filter(range => range.end <= node.line).reduce((count, range) => count + length(range), 0);
    if (inserted && line >= destination) line += inserted;
    ids.set(line, node.id);
  }
  return ids;
}
