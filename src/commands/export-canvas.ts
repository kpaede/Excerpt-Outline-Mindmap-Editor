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
    new Notice('Canvas export needs an open mindmap.');
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
    console.error('Canvas export failed:', error);
    new Notice('Canvas export failed.');
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
  return plugin.app.workspace.getLeaf(split);
}

function revealLeaf(plugin: MindmapPlugin, leaf: WorkspaceLeaf): void {
  void plugin.app.workspace.revealLeaf(leaf);
}
