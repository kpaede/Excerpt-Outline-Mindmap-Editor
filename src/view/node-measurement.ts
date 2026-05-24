import { Component, MarkdownRenderer } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import { openInternalLink } from '../utils/outline';
import type { MindmapView } from './mindmap-view';

async function waitForAsyncContent(container: HTMLElement, maxWaitTime: number = 3000): Promise<void> {
  const startTime = Date.now();
  const images = container.querySelectorAll('img');
  const imagePromises = Array.from(images).map((img) => {
    if (img.complete) return Promise.resolve();

    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      setTimeout(() => resolve(), 2000);
    });
  });

  const checkAsyncRenderers = async (): Promise<void> => {
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts && (Date.now() - startTime) < maxWaitTime) {
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

      if (verovioReady && codeBlocksReady) break;

      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      attempts++;
    }
  };

  await Promise.all([
    Promise.all(imagePromises),
    checkAsyncRenderers(),
  ]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function preprocessNodeMarkdown(text: string): string {
  let processedText = text;
  const codeBlockRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  const codeBlocks: string[] = [];
  let codeBlockIndex = 0;

  processedText = processedText.replace(codeBlockRegex, (match) => {
    const placeholder = `__CODEBLOCK_${codeBlockIndex}__`;
    codeBlocks[codeBlockIndex] = match;
    codeBlockIndex++;
    return placeholder;
  });

  processedText = processedText.replace(/\|([^|]*)\|/g, '`$1`');
  processedText = processedText.replace(/%%[^%]*%%/g, '');

  codeBlocks.forEach((codeBlock, index) => {
    processedText = processedText.replace(`__CODEBLOCK_${index}__`, codeBlock);
  });

  return processedText;
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

export async function measureNodesForLayout(view: MindmapView, flat: OutlineNode[]): Promise<void> {
  const measureContainer = document.createElement('div');
  measureContainer.className = 'mindmap-measurement-container';
  document.body.appendChild(measureContainer);
  view.sizeMap.clear();

  for (const node of flat) {
    const nodeOptions = view.getNodeOptions();
    const targetWidth = nodeOptions.nodeWidth;
    const measurementKey = `${targetWidth}\u0000${node.text}`;
    const cachedMeasurement = view.measurementCache.get(measurementKey);

    if (cachedMeasurement) {
      view.sizeMap.set(node.line, { w: cachedMeasurement.w, h: cachedMeasurement.h });
      if (cachedMeasurement.scaleFactor) {
        node.scaleFactor = cachedMeasurement.scaleFactor;
      }
      continue;
    }

    const tmpBox = document.createElement('div');
    tmpBox.className = 'mindmap-measure-box';
    tmpBox.style.setProperty('--mindmap-target-width', `${targetWidth}px`);

    if (node.text.trim() === '') {
      tmpBox.innerHTML = '&nbsp;';
    } else {
      try {
        await MarkdownRenderer.render(
          view.app,
          preprocessNodeMarkdown(node.text),
          tmpBox,
          view.file?.path || '',
          view as Component
        );

        await waitForAsyncContent(tmpBox);

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
        tmpBox.textContent = node.text;
      }
    }

    measureContainer.appendChild(tmpBox);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    if (tmpBox.querySelector('svg, .verovio-container, pre code')) {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 200));
    }

    const rect = tmpBox.getBoundingClientRect();
    let measuredW = rect.width;
    let measuredH = rect.height;

    if (measuredW === 0 || measuredH === 0) {
      console.warn('Zero dimensions detected for node:', node.text.substring(0, 50));
      const fallbackSize = fallbackMeasuredSize(tmpBox, node, targetWidth);
      measuredW = fallbackSize.w;
      measuredH = fallbackSize.h;
    }

    if (measuredW > targetWidth) {
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

    const measuredSize = { w: measuredW, h: measuredH };
    view.sizeMap.set(node.line, measuredSize);
    view.measurementCache.set(measurementKey, {
      ...measuredSize,
      scaleFactor: node.scaleFactor,
    });

    if (view.measurementCache.size > 1000) {
      const oldestKey = view.measurementCache.keys().next().value;
      if (oldestKey) view.measurementCache.delete(oldestKey);
    }

    measureContainer.removeChild(tmpBox);
  }

  document.body.removeChild(measureContainer);
}
