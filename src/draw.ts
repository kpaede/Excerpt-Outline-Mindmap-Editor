import { MarkdownRenderer, Component } from 'obsidian';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
// @ts-ignore - no types available for cytoscape-dagre
import dagre from 'cytoscape-dagre';

import { parseOutline, OutlineNode } from './util';
import {
  addChild,
  addSibling,
  writeNode,
  deleteNode,
  moveSubtree,
  DocString,
} from './mindmap-file';
import { VerticalToolbar } from './vertical-toolbar';
import { MindmapView } from './mindmapView';

cytoscape.use(dagre);

/**
 * Wait for all async content to finish rendering
 */
async function waitForAsyncContent(container: HTMLElement, maxWaitTime: number = 3000): Promise<void> {
  const startTime = Date.now();
  
  // Wait for images to load
  const images = container.querySelectorAll('img');
  const imagePromises = Array.from(images).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve(); // Continue even if image fails
      // Timeout for individual images
      setTimeout(() => resolve(), 2000);
    });
  });
  
  // Wait for common async renderers to finish
  const checkAsyncRenderers = async (): Promise<void> => {
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds at 100ms intervals
    
    while (attempts < maxAttempts && (Date.now() - startTime) < maxWaitTime) {
      // Check for Verovio
      const verovioContainers = Array.from(container.querySelectorAll('.verovio-container'));
      let verovioReady = true;
      for (const verovio of verovioContainers) {
        const svg = verovio.querySelector('svg');
        if (!svg || svg.getAttribute('width') === '0' || !svg.getAttribute('width')) {
          verovioReady = false;
          break;
        }
      }
      
      // Check for other code block renderers that create SVG content
      const codeBlocks = Array.from(container.querySelectorAll('pre code, .block-language-chart, .block-language-plantuml'));
      let codeBlocksReady = true;
      for (const block of codeBlocks) {
        // If it has async content being rendered, it might have loading indicators
        if (block.textContent?.includes('Loading...') || 
            block.classList.contains('is-loading') ||
            block.querySelector('.loading')) {
          codeBlocksReady = false;
          break;
        }
      }
      
      if (verovioReady && codeBlocksReady) {
        break;
      }
      
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  };
  
  // Wait for both images and async renderers
  await Promise.all([
    Promise.all(imagePromises),
    checkAsyncRenderers()
  ]);
  
  // Final wait for any layout changes
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export async function draw(view: MindmapView): Promise<void> {
  if (!view.file) return;

  const isInitialDraw = !view.cy;

  if (isInitialDraw) {
    view.contentEl.empty();
    view.wrapper = view.contentEl.createDiv({ cls: 'mindmap-wrapper' });
    if (!view.toolbar) {
      view.toolbar = new VerticalToolbar(view);
    }
  }

  // Only clear overlays on true initial draw
  if (isInitialDraw) {
    view.wrapper.querySelectorAll('[data-overlay]').forEach((e) => e.remove());
  }

  const flat: OutlineNode[] = [];
  (function walk(arr: OutlineNode[]) {
    arr.forEach((n) => {
      flat.push(n);
      walk(n.children);
    });
  })(parseOutline(view.data));

  const measureContainer = document.createElement('div');
  measureContainer.className = 'mindmap-measurement-container';
  document.body.appendChild(measureContainer);

  // Clear sizeMap to ensure fresh measurements
  view.sizeMap.clear();

  for (const n of flat) {
    const tmpBox = document.createElement('div');
    tmpBox.className = 'mindmap-measure-box';
    
    const nodeOptions = view.getNodeOptions();
    const targetWidth = nodeOptions.nodeWidth;
    
    tmpBox.style.maxWidth = `${targetWidth}px`;

    if (n.text.trim() === '') {
      tmpBox.innerHTML = '&nbsp;';
    } else {
      // Improved text preprocessing for code blocks
      let processedText = n.text;
      
      // Protect code blocks from interference
      const codeBlockRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
      const codeBlocks: string[] = [];
      let codeBlockIndex = 0;
      
      // Extract and protect code blocks
      processedText = processedText.replace(codeBlockRegex, (match) => {
        const placeholder = `__CODEBLOCK_${codeBlockIndex}__`;
        codeBlocks[codeBlockIndex] = match;
        codeBlockIndex++;
        return placeholder;
      });
      
      // Remove problematic patterns outside of code blocks
      processedText = processedText.replace(/\|([^|]*)\|/g, '`$1`'); // Convert |text| to `text`
      processedText = processedText.replace(/%%[^%]*%%/g, ''); // Remove Obsidian comments
      
      // Restore code blocks
      codeBlocks.forEach((codeBlock, index) => {
        processedText = processedText.replace(`__CODEBLOCK_${index}__`, codeBlock);
      });
      
      try {
        await MarkdownRenderer.render(
          view.app,
          processedText,
          tmpBox,
          view.file?.path || '',
          view as Component
        );

        // Wait for all async content to finish rendering
        await waitForAsyncContent(tmpBox);

        // Enhanced code block styling
        tmpBox.querySelectorAll('pre code').forEach((codeEl) => {
          const preEl = codeEl.parentElement as HTMLPreElement;
          if (preEl) {
            // CSS classes will handle the styling
            preEl.classList.add('mindmap-code-block');
            (codeEl as HTMLElement).classList.add('mindmap-code-content');
          }
        });

        tmpBox.querySelectorAll('img').forEach((img) => {
          img.classList.add('mindmap-image');
        });

        tmpBox.querySelectorAll('a.internal-link').forEach((link) => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const href = link.getAttribute('href');
            if (href && view.file) {
              view.app.workspace.openLinkText(href, view.file.path);
            }
          });
        });
      } catch (error) {
        console.warn('MarkdownRenderer failed during measurement, using plain text:', error);
        tmpBox.textContent = n.text;
      }
    }

    measureContainer.appendChild(tmpBox);
    
    // Additional wait after appending to DOM
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    
    // For complex content, wait a bit more to ensure proper rendering
    const hasComplexContent = tmpBox.querySelector('svg, .verovio-container, pre code');
    if (hasComplexContent) {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 200));
    }

    const rect = tmpBox.getBoundingClientRect();
    let measuredW = rect.width;
    let measuredH = rect.height;

    // If we still get zero dimensions, use fallback measurements
    if (measuredW === 0 || measuredH === 0) {
      console.warn('Zero dimensions detected for node:', n.text.substring(0, 50));
      
      // Try to get dimensions from child elements
      const children = Array.from(tmpBox.children) as HTMLElement[];
      if (children.length > 0) {
        let maxWidth = 0;
        let totalHeight = 0;
        
        children.forEach(child => {
          const childRect = child.getBoundingClientRect();
          maxWidth = Math.max(maxWidth, childRect.width);
          totalHeight += childRect.height;
        });
        
        if (maxWidth > 0 && totalHeight > 0) {
          measuredW = maxWidth;
          measuredH = totalHeight;
        }
      }
      
      // Final fallback based on content
      if (measuredW === 0 || measuredH === 0) {
        const textLength = n.text.length;
        measuredW = Math.min(targetWidth, Math.max(200, textLength * 8));
        measuredH = Math.max(60, Math.ceil(textLength / 30) * 24);
      }
    }

    // Always apply scaling to fit target width
    if (measuredW > targetWidth) {
      const scale = targetWidth / measuredW;
      n.scaleFactor = scale;
      measuredW = targetWidth;
      // Scale height proportionally
      measuredH = measuredH * scale;
    } else {
      // Use target width even if content is smaller
      measuredW = targetWidth;
    }

    if (measuredW < 80) {
      measuredW = 80;
    }

    view.sizeMap.set(n.line, { w: measuredW, h: measuredH });
    measureContainer.removeChild(tmpBox);
  }

  document.body.removeChild(measureContainer);

  const els: ElementDefinition[] = [];
  for (const n of flat) {
    const dims = view.sizeMap.get(n.line)!;
    els.push({
      data: {
        id: `n${n.line}`,
        node: n,
        width: dims.w,
        height: dims.h,
      },
    });
  }
  for (const p of flat) {
    p.children.forEach((c) => {
      els.push({
        data: {
          id: `e${p.line}-${c.line}`,
          source: `n${p.line}`,
          target: `n${c.line}`,
        },
      });
    });
  }

  const L = view.layoutOptions;
  const layoutOpts = {
    name: 'dagre',
    rankDir: L.rankDir,
    align: L.align,
    nodeSep: L.nodeSep,
    edgeSep: L.edgeSep,
    rankSep: L.rankSep,
    marginx: L.marginx,
    marginy: L.marginy,
    acyciler: L.acyciler,
    ranker: L.ranker,
    fit: false,
    padding: 20,
    nodeDimensionsIncludeLabels: false,
    spacingFactor: L.spacingFactor,
  } as any;

  if (!view.cy) {
    const canvas = view.wrapper.createDiv({ cls: 'mindmap-canvas' });

    view.cy = cytoscape({
      container: canvas,
      elements: els,
      layout: layoutOpts,
      style: [
        {
          selector: 'node',
          style: {
            'background-opacity': 0,
            width: 'data(width)',
            height: 'data(height)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': 'rgba(120,120,120,.75)',
            'curve-style': 'straight',
          },
        },
      ],
      wheelSensitivity: 0.2, // This controls zoom sensitivity
    });

    view.cy.on('pan zoom', () => view.updateOverlays());

    view.cy.on('layoutstop', () => {
      if (!view.firstFitDone) {
        view.cy!.fit(view.cy!.elements(), 50);
        view.cy!.center(view.cy!.elements());
        view.firstFitDone = true;
      }
      view.updateOverlays();
    });

    view.cy.layout(layoutOpts).run();
  } else {
    view.cy.json({ elements: els });
    view.cy.layout(layoutOpts).run();
  }
}
