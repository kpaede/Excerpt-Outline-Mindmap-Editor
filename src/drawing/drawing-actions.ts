import { Notice, TFile } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';
import { createDrawingSvg, parseDrawingSvg } from './drawing-svg';
import { extractDrawingLink } from './drawing-link';
import { warmWhiteboardRuntime } from './whiteboard-runtime';
import {
  createExcalidrawDrawing,
  isExcalidrawAvailable,
  openExcalidrawFile,
  resolveExcalidrawEmbed,
} from './excalidraw-integration';
import type { DrawingModalResult } from './drawing-modal';
import type { ExportedDrawingItem } from './types';

/**
 * Opens the editor, loading it on first use.
 *
 * The import must stay dynamic. This module is reachable from the node
 * context menu and therefore part of the bundle's eagerly evaluated startup
 * graph, while the editor pulls in Lit and the whiteboard element
 * definitions - both of which touch `document` and `HTMLElement` at module
 * scope. A static import here would evaluate all of that during Obsidian's
 * plugin startup and defer nothing but the whiteboard module itself.
 */
async function openDrawingEditor(
  view: MindmapView,
  items: ExportedDrawingItem[]
): Promise<DrawingModalResult | null> {
  let openDrawingModal: typeof import('./drawing-modal').openDrawingModal;
  try {
    ({ openDrawingModal } = await import('./drawing-modal'));
  } catch (error) {
    console.error('Could not load the drawing editor:', error);
    new Notice('Could not open the drawing editor. See the developer console for details.');
    return null;
  }

  return openDrawingModal(
    view.app,
    items,
    (close) => view.registerTransientCloser(close),
    view.penPreferences
  );
}

/**
 * Evaluates the editor and the whiteboard module ahead of the first drawing,
 * without blocking the caller. Called when the menu offering the drawing
 * actions opens, so the one-off cost overlaps with the user reading the menu.
 */
export function warmDrawingEditor(): void {
  void import('./drawing-modal').catch(() => {
    // Purely an optimisation: openDrawingEditor reports real failures when
    // the editor is actually opened.
  });
  warmWhiteboardRuntime();
}

function drawingBaseName(view: MindmapView, node: OutlineNode): string {
  const readableNode = node.text
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/[*_`#[\]<>:"/\\|?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const base = readableNode || view.file?.basename || 'Drawing';
  return `${base} drawing`;
}

async function createAttachment(view: MindmapView, node: OutlineNode, svg: string): Promise<TFile> {
  if (!view.file) throw new Error('No Markdown file is open.');
  const path = await view.app.fileManager.getAvailablePathForAttachment(
    `${drawingBaseName(view, node)}.svg`,
    view.file.path
  );
  return await view.app.vault.create(path, svg);
}

function attachmentEmbed(view: MindmapView, attachment: TFile): string {
  if (!view.file) return `![[${attachment.path}]]`;
  const link = view.app.metadataCache.fileToLinktext(attachment, view.file.path, true);
  return `![[${link}]]`;
}

function resolveLiveTarget(view: MindmapView, original: OutlineNode, sourcePath: string): OutlineNode | null {
  if (view.file?.path !== sourcePath) return null;
  const sameLine = view.getNodeByLine(original.line);
  if (sameLine?.text === original.text && sameLine.checkbox === original.checkbox) return sameLine;
  const matches = view.getFlatNodes().filter((node) =>
    node.text === original.text &&
    node.checkbox === original.checkbox &&
    node.indent === original.indent
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function addDrawingAsChild(view: MindmapView, node: OutlineNode): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  const result = await openDrawingEditor(view, []);
  if (!result) return;
  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice('The target node changed while the drawing editor was open. Nothing was saved.');
    return;
  }
  try {
    const attachment = await createAttachment(view, liveTarget, createDrawingSvg(result.items));
    try {
      await view.executeAddChildTextCommand(liveTarget, attachmentEmbed(view, attachment));
    } catch (error) {
      console.error('Drawing attachment was saved but its child node could not be inserted:', error);
      new Notice(`Drawing saved as ${attachment.path}, but the child node could not be inserted.`);
    }
  } catch (error) {
    console.error('Could not add drawing as child:', error);
    new Notice('Could not save the drawing.');
  }
}

export async function addDrawingAsSibling(view: MindmapView, node: OutlineNode): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  const result = await openDrawingEditor(view, []);
  if (!result) return;
  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice('The target node changed while the drawing editor was open. Nothing was saved.');
    return;
  }
  try {
    const attachment = await createAttachment(view, liveTarget, createDrawingSvg(result.items));
    try {
      await view.executeAddSiblingTextCommand(liveTarget, attachmentEmbed(view, attachment));
    } catch (error) {
      console.error('Drawing attachment was saved but its sibling node could not be inserted:', error);
      new Notice(`Drawing saved as ${attachment.path}, but the sibling node could not be inserted.`);
    }
  } catch (error) {
    console.error('Could not add drawing as sibling:', error);
    new Notice('Could not save the drawing.');
  }
}

export async function editDrawing(view: MindmapView, node: OutlineNode): Promise<void> {
  if (!view.file) return;
  const link = extractDrawingLink(node.text);
  if (!link) return;
  const attachment = view.app.metadataCache.getFirstLinkpathDest(link, view.file.path);
  if (!(attachment instanceof TFile) || attachment.extension.toLowerCase() !== 'svg') {
    new Notice('The drawing attachment could not be found.');
    return;
  }

  try {
    const originalSvg = await view.app.vault.read(attachment);
    const document = parseDrawingSvg(originalSvg);
    if (!document) {
      new Notice('This SVG is not an editable drawing created by this plugin.');
      return;
    }
    const result = await openDrawingEditor(view, document.items);
    if (!result) return;
    const latestSvg = await view.app.vault.read(attachment);
    if (latestSvg !== originalSvg) {
      new Notice('The drawing changed while the editor was open. Your edit was not saved to avoid overwriting newer changes.');
      return;
    }
    await view.app.vault.modify(attachment, createDrawingSvg(result.items, document.createdAt));
    // No wait for the metadata cache in between: it only tracks Markdown, so
    // an SVG attachment never emits its "changed" event and waiting for one
    // just cost every save the full fallback timeout. What the redraw
    // actually needs is the new mtime, and vault.modify has already committed
    // that by the time it resolves.
    view.attachmentVersions.markCurrent(attachment);
    await view.refreshRenderedAttachments(attachment);
  } catch (error) {
    console.error('Could not edit drawing:', error);
    new Notice('Could not update the drawing.');
  }
}

/**
 * Creates a drawing in Excalidraw's own format and folder, links it from a new
 * node, and hands editing over to Excalidraw's editor in a new tab.
 *
 * The drawing is created before the node so the node is never left pointing at
 * a file that does not exist; the tab opens last so a failed insert does not
 * pull the user away from the mindmap.
 */
async function addExcalidrawDrawing(
  view: MindmapView,
  node: OutlineNode,
  placement: 'child' | 'sibling'
): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  if (!isExcalidrawAvailable(view.app)) {
    new Notice('The Excalidraw plugin is not available.');
    return;
  }

  let attachment: TFile;
  try {
    attachment = await createExcalidrawDrawing(view.app, drawingBaseName(view, node));
  } catch (error) {
    console.error('Could not create the Excalidraw drawing:', error);
    new Notice('Could not create the Excalidraw drawing.');
    return;
  }

  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice(`The target node changed. ${attachment.path} was created, but no node was inserted.`);
    return;
  }

  try {
    await (placement === 'child'
      ? view.executeAddChildTextCommand(liveTarget, attachmentEmbed(view, attachment))
      : view.executeAddSiblingTextCommand(liveTarget, attachmentEmbed(view, attachment)));
  } catch (error) {
    console.error(`Excalidraw drawing was created but its ${placement} node could not be inserted:`, error);
    new Notice(`Drawing created as ${attachment.path}, but the ${placement} node could not be inserted.`);
    return;
  }

  try {
    await openExcalidrawFile(view.app, attachment);
  } catch (error) {
    // The node and the drawing both exist; only the convenience of jumping
    // straight into the editor was lost.
    console.error('Could not open the new Excalidraw drawing:', error);
    new Notice(`Drawing created as ${attachment.path}, but its editor could not be opened.`);
  }
}

export function addExcalidrawAsChild(view: MindmapView, node: OutlineNode): Promise<void> {
  return addExcalidrawDrawing(view, node, 'child');
}

export function addExcalidrawAsSibling(view: MindmapView, node: OutlineNode): Promise<void> {
  return addExcalidrawDrawing(view, node, 'sibling');
}

/**
 * Routes the "Edit" action to whatever the node actually holds: a built-in
 * drawing, an Excalidraw drawing, or plain text. One entry point rather than
 * one menu entry per possible content type.
 */
export function editNodeContent(view: MindmapView, node: OutlineNode): Promise<void> {
  const drawingOnly = /^\s*!\[\[[^\]]+\]\]\s*$/.test(node.text);
  if (drawingOnly && extractDrawingLink(node.text)) return editDrawing(view, node);
  if (drawingOnly && view.file && resolveExcalidrawEmbed(view.app, node.text, view.file.path)) {
    return editExcalidrawDrawing(view, node);
  }
  return view.enterEditModeForNodeByLine(node.line);
}

export async function editExcalidrawDrawing(view: MindmapView, node: OutlineNode): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  const attachment = resolveExcalidrawEmbed(view.app, node.text, sourcePath);
  if (!attachment) {
    new Notice('The Excalidraw drawing could not be found.');
    return;
  }

  try {
    await openExcalidrawFile(view.app, attachment);
  } catch (error) {
    console.error('Could not open the Excalidraw drawing:', error);
    new Notice('Could not open the Excalidraw drawing.');
  }
}
