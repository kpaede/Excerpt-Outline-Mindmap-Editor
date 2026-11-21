import { Component, MarkdownRenderer } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import { openInternalLink } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import { waitForMeasurementStyles } from './measurement-styles';
import { hasUnrenderedExcalidrawEmbed } from '../drawing/excalidraw-integration';
import { nodeMarkdown } from '../editor/node-markdown';

// Background Obsidian tabs throttle animation frames. A measurement must still
// finish so writes, undo and switching to another file cannot wait indefinitely.
function measurementFrame(): Promise<void> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => { window.cancelAnimationFrame(frame); resolve(); }, 50);
    const frame = window.requestAnimationFrame(() => { window.clearTimeout(timeout); resolve(); });
  });
}

function waitForImages(container: HTMLElement): Promise<unknown> {
  return Promise.all(Array.from(container.querySelectorAll('img')).map((img) => {
    if (img.complete) return Promise.resolve();

    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      window.setTimeout(() => resolve(), 2000);
    });
  }));
}

// Excalidraw renders its embeds through a global task queue shared with every
// other embed in the app, so it can be slower than the in-process renderers
// below. Only nodes that actually embed a drawing ever wait this long, and a
// measurement taken too early is cached and stays visibly wrong.
const EXCALIDRAW_WAIT_MS = 8000;
const DEFAULT_WAIT_MS = 3000;

async function waitForAsyncContent(view: MindmapView, container: HTMLElement): Promise<void> {
  const startTime = Date.now();
  const sourcePath = view.file?.path ?? '';

  let attempts = 0;
  const maxAttempts = 80;

  while (attempts < maxAttempts) {
    const verovioContainers = Array.from(container.querySelectorAll('.verovio-container'));
    let verovioReady = true;
    for (const verovio of verovioContainers) {
      const svg = verovio.querySelector('svg');
      if (!svg || svg.getAttribute('width') === '0' || !svg.getAttribute('width')) {
        verovioReady = false;
        break;
      }
    }

    const codeBlocks = Array.from(container.querySelectorAll('pre code, .block-language-chart, .block-language-plantuml'));
    let codeBlocksReady = true;
    for (const block of codeBlocks) {
      if (
        block.textContent?.includes('Loading...') ||
        block.classList.contains('is-loading') ||
        block.querySelector('.loading')
      ) {
        codeBlocksReady = false;
        break;
      }
    }

    const excalidrawPending = hasUnrenderedExcalidrawEmbed(view.app, container, sourcePath);

    if (verovioReady && codeBlocksReady && !excalidrawPending) break;
    if ((Date.now() - startTime) >= (excalidrawPending ? EXCALIDRAW_WAIT_MS : DEFAULT_WAIT_MS)) break;

    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    attempts++;
  }

  // Collected only now: Excalidraw replaces its embed placeholder with a
  // freshly created image, so an image list taken before the loop would miss
  // exactly the element the node has to be sized around.
  await waitForImages(container);
  await measurementFrame();
}

function fallbackMeasuredSize(box: HTMLElement, node: OutlineNode, targetWidth: number): { w: number; h: number } {
  const children = Array.from(box.children) as HTMLElement[];
  let measuredW = 0;
  let measuredH = 0;

  children.forEach((child) => {
    const childRect = child.getBoundingClientRect();
    measuredW = Math.max(measuredW, childRect.width);
    measuredH += childRect.height;
  });

  if (measuredW > 0 && measuredH > 0) {
    return { w: measuredW, h: measuredH };
  }

  const textLength = node.text.length;
  return {
    w: Math.min(targetWidth, Math.max(200, textLength * 8)),
    h: Math.max(60, Math.ceil(textLength / 30) * 24),
  };
}

export async function measureNodesForLayout(
  view: MindmapView,
  flat: OutlineNode[],
  isCurrent: () => boolean = () => true
): Promise<Map<number, { w: number; h: number }>> {
  const sizeMap = new Map<number, { w: number; h: number }>();
  const doc = view.wrapper?.ownerDocument ?? document;
  const renderScope = view.addChild(new Component());
  // Typography is inherited from the actual mindmap, not document.body.
  const measureContainer = view.wrapper.createDiv({ cls: 'mindmap-measurement-container' });
  const font = doc.defaultView!.getComputedStyle(doc.documentElement).getPropertyValue('--font-family').trim();

  let nodesSinceYield = 0;
  try {
    for (const node of flat) {
      if (!isCurrent()) break;
      const nodeOptions = view.getNodeOptions();
      const targetWidth = nodeOptions.nodeWidth;
      const measurementKey = `${targetWidth}\u0000${node.text}`;
      const cachedMeasurement = view.measurementCache.get(measurementKey);

      if (cachedMeasurement) {
        sizeMap.set(node.line, { w: cachedMeasurement.w, h: cachedMeasurement.h });
        node.scaleFactor = cachedMeasurement.scaleFactor;
        continue;
      }

      const tmpBox = measureContainer.createDiv({ cls: 'mindmap-overlay mindmap-measure-box' });
      tmpBox.setCssProps({ '--mindmap-target-width': `${targetWidth}px` });
      if (font) tmpBox.setCssStyles({ fontFamily: font });
      const content = tmpBox.createDiv({ cls: 'markdown-rendered mindmap-node-content' });
      node.scaleFactor = undefined;
      // Attached before rendering, not after. Obsidian's Markdown
      // post-processors are free to skip work for disconnected nodes, and
      // Excalidraw does exactly that - it drops any embed whose placeholder is
      // not in the document, which left drawing nodes measured at the height
      // of the embed's one-line fallback text.
      measureContainer.appendChild(tmpBox);
      const stylesReady = await waitForMeasurementStyles(
        targetWidth, () => doc.defaultView!.getComputedStyle(tmpBox).maxWidth,
        measurementFrame, isCurrent
      );
      if (!isCurrent()) break;

      if (node.text.trim() === '') {
        content.textContent = '\u00a0';
      } else {
        try {
          await MarkdownRenderer.render(
            view.app,
            nodeMarkdown(node),
            content,
            view.file?.path || '',
            renderScope
          );

          // Before waiting: the node has to be measured around the image it
          // will actually display, so the measurement pass must load the same
          // version the overlay will render.
          view.attachmentVersions.applyTo(tmpBox, view.app);
          if (tmpBox.querySelector('img, svg, iframe, .internal-embed, .verovio-container, pre code')) {
            await waitForAsyncContent(view, tmpBox);
            nodesSinceYield = 0;
          }

          tmpBox.querySelectorAll('pre code').forEach((codeEl) => {
            const preEl = codeEl.parentElement as HTMLPreElement;
            if (preEl) {
              preEl.classList.add('mindmap-code-block');
              (codeEl as HTMLElement).classList.add('mindmap-code-content');
            }
          });

          tmpBox.querySelectorAll('img').forEach((img) => {
            img.classList.add('mindmap-image');
          });

          tmpBox.querySelectorAll('a.internal-link').forEach((link) => {
            link.addEventListener('click', (event) => {
              event.preventDefault();
              const href = link.getAttribute('href');
              if (href && view.file) {
                void openInternalLink(view.app, href, view.file.path);
              }
            });
          });
        } catch (error) {
          console.warn('MarkdownRenderer failed during measurement, using plain text:', error);
          content.textContent = node.text;
        }
      }

      // Plain Markdown measures synchronously. Yield in small batches instead
      // of waiting for two frames (and 200ms for code) for every single node.
      if (++nodesSinceYield >= 8) {
        await measurementFrame();
        nodesSinceYield = 0;
      }

      if (!isCurrent()) break;
      const rect = tmpBox.getBoundingClientRect();
      let measuredW = rect.width;
      let measuredH = rect.height;

      if (measuredW === 0 || measuredH === 0) {
        console.warn('Zero dimensions detected for node:', node.text.substring(0, 50));
        const fallbackSize = fallbackMeasuredSize(tmpBox, node, targetWidth);
        measuredW = fallbackSize.w;
        measuredH = fallbackSize.h;
      }

      if (stylesReady && measuredW > targetWidth) {
        const scale = targetWidth / measuredW;
        node.scaleFactor = scale;
        measuredW = targetWidth;
        measuredH = measuredH * scale;
      } else {
        measuredW = targetWidth;
      }

      if (measuredW < 80) {
        measuredW = 80;
      }

      measuredH = Math.max(60, Math.ceil(measuredH));
      const measuredSize = { w: measuredW, h: measuredH };
      sizeMap.set(node.line, measuredSize);
      if (stylesReady) view.measurementCache.set(measurementKey, {
        ...measuredSize,
        scaleFactor: node.scaleFactor,
      });


      measureContainer.removeChild(tmpBox);
    }
  } finally {
    measureContainer.remove();
    view.removeChild(renderScope);
  }

  return sizeMap;
}
