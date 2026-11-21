import { Notice, type App } from 'obsidian';
import { outlineVersion, serializeOutline } from '../domain/outline-format';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';

const clipboardFormats = new WeakMap<App, { text: string; format: 1 | 2 }>();

export function getTopLevelNodes(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.filter((node) => {
    return !nodes.some((other) => (
      other !== node &&
      node.line > other.line &&
      node.line <= other.endLine
    ));
  });
}

export function getNodesAsMarkdown(data: string, nodes: OutlineNode[]): string {
  if (outlineVersion(data) === 2) {
    return serializeOutline(getTopLevelNodes(nodes).sort((a, b) => a.line - b.line));
  }
  const lines = data.split(/\r?\n/);
  return getTopLevelNodes(nodes)
    .sort((a, b) => a.line - b.line)
    .map((node) => lines.slice(node.line, node.endLine + 1).join('\n'))
    .join('\n');
}

export async function copyNodesToClipboard(view: MindmapView, nodes: OutlineNode[]): Promise<boolean> {
  const text = getNodesAsMarkdown(view.data, nodes);
  if (!text) return false;

  view.mindmapClipboardText = text;
  clipboardFormats.set(view.app, { text, format: outlineVersion(view.data) });
  view.pendingCutNodeLines.clear();
  view.updateSelectionStyling();

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Copy failed:', error);
    new Notice('Copied inside mindmap.');
    return true;
  }
}

export async function cutNodesToClipboard(view: MindmapView, nodes: OutlineNode[]): Promise<void> {
  const text = getNodesAsMarkdown(view.data, nodes);
  const topLevelNodes = getTopLevelNodes(nodes);
  if (!text || topLevelNodes.length === 0) return;

  view.mindmapClipboardText = text;
  clipboardFormats.set(view.app, { text, format: outlineVersion(view.data) });
  view.pendingCutNodeLines = new Set(topLevelNodes.map((node) => node.line));
  view.updateSelectionStyling();

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.error('Cut clipboard write failed:', error);
    new Notice('Cut saved inside mindmap.');
  }

  view.wrapper?.focus();
}

export async function pasteClipboardAsChildren(view: MindmapView, targetNode: OutlineNode): Promise<void> {
  try {
    let text = '';

    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      console.error('Paste clipboard read failed:', error);
    }

    if (!text.trim()) {
      text = view.mindmapClipboardText ?? '';
    }

    if (!text.trim()) return;

    const pendingCutNodes = getPendingCutNodes(view);
    if (pendingCutNodes.length > 0 && text === view.mindmapClipboardText) {
      await view.executeCutPasteNodesCommand(pendingCutNodes, targetNode, text);
      return;
    }

    const record = clipboardFormats.get(view.app);
    await view.executePasteNodesCommand(targetNode, text, record?.text === text ? record.format : undefined);
  } catch (error) {
    console.error('Paste failed:', error);
    new Notice('Paste failed.');
  }
}

function getPendingCutNodes(view: MindmapView): OutlineNode[] {
  if (view.pendingCutNodeLines.size === 0) return [];

  return view.getFlatNodes()
    .filter((node) => view.pendingCutNodeLines.has(node.line))
    .sort((a, b) => a.line - b.line);
}
