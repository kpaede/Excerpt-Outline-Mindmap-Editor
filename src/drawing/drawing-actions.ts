import { Notice, TFile } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';
import { createDrawingSvg, parseDrawingSvg } from './drawing-svg';
import { extractDrawingLink } from './drawing-link';
import { openDrawingModal } from './drawing-modal';

function drawingBaseName(view: MindmapView, node: OutlineNode): string {
  const readableNode = node.text
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/[*_`#[\]<>:"/\\|?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const base = readableNode || view.file?.basename || 'Drawing';
  return `${base} drawing.svg`;
}

async function createAttachment(view: MindmapView, node: OutlineNode, svg: string): Promise<TFile> {
  if (!view.file) throw new Error('No Markdown file is open.');
  const path = await view.app.fileManager.getAvailablePathForAttachment(drawingBaseName(view, node), view.file.path);
  return await view.app.vault.create(path, svg);
}

function attachmentEmbed(view: MindmapView, attachment: TFile): string {
  if (!view.file) return `![[${attachment.path}]]`;
  const link = view.app.metadataCache.fileToLinktext(attachment, view.file.path, true);
  return `![[${link}]]`;
}

/**
 * vault.modify() resolves once the write lands on disk, but Obsidian updates
 * its metadata cache for the file asynchronously afterward. Rendering the
 * embed immediately can race that update and show the pre-edit SVG - this
 * waits for the cache's own "changed" event for this exact file (with a
 * bounded fallback in case the event doesn't fire) before the caller redraws.
 */
function waitForMetadataCacheRefresh(view: MindmapView, attachment: TFile): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      view.app.metadataCache.offref(ref);
      window.clearTimeout(timeout);
      resolve();
    };
    const ref = view.app.metadataCache.on('changed', (file) => {
      if (file.path === attachment.path) finish();
    });
    const timeout = window.setTimeout(finish, 500);
  });
}

/**
 * The redraw above re-renders the node's markdown fresh, but Obsidian's own
 * resource URL for the embedded image can still be identical to the one the
 * webview already has cached (its cache-busting, if any, depends on the
 * TFile's mtime being visible by the time the embed resolves - not
 * guaranteed here even after waitForMetadataCacheRefresh). Forcing a new
 * query string on the exact <img> for this attachment guarantees a fresh
 * fetch regardless of what Obsidian's own caching does internally.
 */
function forceReloadEmbeddedImage(view: MindmapView, attachment: TFile): void {
  const resourceBase = view.app.vault.getResourcePath(attachment).split('?')[0];
  view.wrapper.querySelectorAll('img').forEach((img) => {
    if (img.src.split('?')[0] === resourceBase) {
      img.src = `${resourceBase}?t=${Date.now()}`;
    }
  });
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
  const result = await openDrawingModal(view.app, [], (close) => view.registerTransientCloser(close), view.penPreferences);
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
  const result = await openDrawingModal(view.app, [], (close) => view.registerTransientCloser(close), view.penPreferences);
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
    const result = await openDrawingModal(
      view.app,
      document.items,
      (close) => view.registerTransientCloser(close),
      view.penPreferences
    );
    if (!result) return;
    const latestSvg = await view.app.vault.read(attachment);
    if (latestSvg !== originalSvg) {
      new Notice('The drawing changed while the editor was open. Your edit was not saved to avoid overwriting newer changes.');
      return;
    }
    await view.app.vault.modify(attachment, createDrawingSvg(result.items, document.createdAt));
    await waitForMetadataCacheRefresh(view, attachment);
    await view.refreshRenderedAttachments();
    forceReloadEmbeddedImage(view, attachment);
  } catch (error) {
    console.error('Could not edit drawing:', error);
    new Notice('Could not update the drawing.');
  }
}
