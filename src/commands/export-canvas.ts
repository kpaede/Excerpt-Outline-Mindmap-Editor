import { Notice, normalizePath, type TFile, type WorkspaceLeaf } from 'obsidian';
import type MindmapPlugin from '../main';
import { outlineToJsonCanvas, validateJsonCanvas } from '../domain/json-canvas';
import { flattenOutline, isOutlineCompatible, parseOutline } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';

export async function exportMindmapViewToCanvas(
  plugin: MindmapPlugin,
  view: MindmapView
): Promise<void> {
  if (!view.file) {
    new Notice('Open a mindmap before exporting to Canvas.');
    return;
  }

  const markdown = view.getViewData();
  if (!isOutlineCompatible(markdown)) {
    new Notice('This file is not a compatible mindmap outline.');
    return;
  }

  const roots = parseOutline(markdown);
  if (flattenOutline(roots).length === 0) {
    new Notice('This mindmap has no nodes to export.');
    return;
  }

  try {
    const canvas = outlineToJsonCanvas(roots);
    validateJsonCanvas(canvas);
    const canvasPath = await getAvailableCanvasPath(plugin, view.file);
    const canvasFile = await plugin.app.vault.create(canvasPath, `${JSON.stringify(canvas, null, 2)}\n`);
    new Notice(`Created Canvas: ${canvasFile.name}`);
    await openCanvasFile(plugin, canvasFile);
  } catch (error) {
    console.error('Failed to export mindmap to Canvas:', error);
    new Notice('Failed to export mindmap to Canvas.');
  }
}

async function getAvailableCanvasPath(plugin: MindmapPlugin, sourceFile: TFile): Promise<string> {
  const withoutExtension = sourceFile.path.replace(/\.md$/i, '');
  let candidate = normalizePath(`${withoutExtension}.canvas`);
  let counter = 1;

  while (await plugin.app.vault.adapter.exists(candidate)) {
    candidate = normalizePath(`${withoutExtension} ${counter}.canvas`);
    counter++;
  }

  return candidate;
}

async function openCanvasFile(plugin: MindmapPlugin, file: TFile): Promise<void> {
  const leaf = getWorkspaceLeaf(plugin, true);
  await leaf.setViewState({
    type: 'canvas',
    state: { file: file.path },
    active: true,
  });
  revealLeaf(plugin, leaf);
}

function getWorkspaceLeaf(plugin: MindmapPlugin, split: boolean): WorkspaceLeaf {
  const ws: any = plugin.app.workspace;
  if (typeof ws.getLeaf === 'function') {
    return ws.getLeaf(split);
  }

  if (split && typeof ws.splitActiveLeaf === 'function') {
    return ws.splitActiveLeaf();
  }

  return ws.activeLeaf;
}

function revealLeaf(plugin: MindmapPlugin, leaf: WorkspaceLeaf): void {
  const ws: any = plugin.app.workspace;
  if (typeof ws.revealLeaf === 'function') {
    ws.revealLeaf(leaf);
    return;
  }
  if (typeof ws.setActiveLeaf === 'function') {
    ws.setActiveLeaf(leaf);
  }
}
