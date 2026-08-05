import {
  Component,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  TFile,
  setIcon,
} from 'obsidian';
import cytoscape, { ElementDefinition, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

import type MindmapPlugin from '../main';
import { isOutlineCompatible, OutlineNode, parseOutline } from '../utils/outline';
import { parseHeadingSections } from '../utils/heading-sections';
import { sortByMarkdownOrder } from '../utils/cytoscape';
import { renderHeadingFrames } from '../view/heading-frames';
import { arrangeTopLevelTrees } from '../view/tree-layout';

cytoscape.use(dagre);

function getEmbedFileName(source: string): string | null {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return null;

  return lines[0].replace(/^["']|["']$/g, '');
}

function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  const flat: OutlineNode[] = [];

  const walk = (items: OutlineNode[]) => {
    items.forEach((node) => {
      flat.push(node);
      walk(node.children);
    });
  };

  walk(nodes);
  return flat;
}

async function waitForAsyncContent(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));

  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();

    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      window.setTimeout(resolve, 1500);
    });
  }));

  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function measureNodes(
  plugin: MindmapPlugin,
  component: Component,
  file: TFile,
  flat: OutlineNode[]
): Promise<Map<number, { w: number; h: number }>> {
  const sizeMap = new Map<number, { w: number; h: number }>();
  const targetWidth = 300;
  const measureContainer = createDiv();
  measureContainer.className = 'mindmap-eome-measurement-container';
  document.body.appendChild(measureContainer);

  for (const node of flat) {
    const box = createDiv();
    box.className = 'mindmap-measure-box';
    box.setCssProps({ '--mindmap-target-width': `${targetWidth}px` });

    if (node.text.trim() === '') {
      box.textContent = '\u00a0';
    } else {
      await MarkdownRenderer.render(plugin.app, node.text, box, file.path, component);
      await waitForAsyncContent(box);
    }

    measureContainer.appendChild(box);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    const rect = box.getBoundingClientRect();
    let measuredW = rect.width || targetWidth;
    let measuredH = rect.height || 40;

    if (measuredW > targetWidth) {
      const scale = targetWidth / measuredW;
      node.scaleFactor = scale;
      measuredW = targetWidth;
      measuredH = measuredH * scale;
    } else {
      measuredW = targetWidth;
    }

    sizeMap.set(node.line, {
      w: Math.max(80, measuredW),
      h: Math.max(40, measuredH),
    });
    measureContainer.removeChild(box);
  }

  document.body.removeChild(measureContainer);
  return sizeMap;
}

function buildElements(flat: OutlineNode[], sizeMap: Map<number, { w: number; h: number }>): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const orderByLine = new Map<number, number>();
  flat.forEach((node, index) => orderByLine.set(node.line, index));

  flat.forEach((node) => {
    const dims = sizeMap.get(node.line);
    if (!dims) return;

    elements.push({
      data: {
        id: `n${node.line}`,
        node,
        width: dims.w,
        height: dims.h,
        order: orderByLine.get(node.line) ?? node.line,
      },
    });
  });

  flat.forEach((parent) => {
    parent.children.forEach((child) => {
      elements.push({
        data: {
          id: `e${parent.line}-${child.line}`,
          source: `n${parent.line}`,
          target: `n${child.line}`,
          order: orderByLine.get(child.line) ?? child.line,
        },
      });
    });
  });

  return elements;
}

async function renderOverlays(
  plugin: MindmapPlugin,
  component: Component,
  file: TFile,
  wrapper: HTMLElement,
  cy: cytoscape.Core,
  flat: OutlineNode[],
  sizeMap: Map<number, { w: number; h: number }>
): Promise<void> {
  wrapper.querySelectorAll('[data-mindmap-eome-overlay]').forEach((overlay) => overlay.remove());

  const css = getComputedStyle(document.documentElement);
  const txt = css.getPropertyValue('--text-normal').trim() || '#000';
  const font = css.getPropertyValue('--font-family').trim() || 'inherit';
  const bg = css.getPropertyValue('--background-primary').trim() || '#fff';
  const zoom = cy.zoom();

  renderHeadingFrames(wrapper, cy, parseHeadingSections(await plugin.app.vault.read(file)), sizeMap, {
    attributeName: 'mindmapEomeOverlay',
  });

  for (const node of flat) {
    const cyNode = cy.getElementById(`n${node.line}`);
    const dims = sizeMap.get(node.line);
    if (!cyNode || cyNode.empty() || !dims) continue;

    const position = cyNode.renderedPosition();
    const box = createDiv();
    box.className = 'mindmap-overlay mindmap-eome-overlay';
    box.dataset.mindmapEomeOverlay = '1';
    box.setCssProps({
      '--mindmap-left': `${position.x}px`,
      '--mindmap-top': `${position.y}px`,
      '--mindmap-box-width': `${dims.w}px`,
      '--mindmap-box-height': `${dims.h}px`,
      '--mindmap-zoom': String(zoom),
      '--mindmap-border': '#000000',
      '--mindmap-bg': bg,
      '--mindmap-color': txt,
      '--mindmap-font': font,
    });

    const content = createDiv();
    content.className = 'markdown-rendered';
    if (node.scaleFactor && node.scaleFactor !== 1) {
      content.setCssProps({ '--mindmap-scale': String(node.scaleFactor) });
    }

    if (node.text.trim() === '') {
      content.textContent = '\u00a0';
    } else {
      await MarkdownRenderer.render(plugin.app, node.text, content, file.path, component);
      await waitForAsyncContent(content);
    }

    box.appendChild(content);
    wrapper.appendChild(box);
  }
}

function renderError(el: HTMLElement, message: string): void {
  el.empty();
  el.createDiv({ cls: 'mindmap-eome-error', text: message });
}

export async function renderMindmapEomeEmbed(
  plugin: MindmapPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext
): Promise<void> {
  el.classList.add('mindmap-eome-host');
  el.parentElement?.classList.add('mindmap-eome-codeblock');

  const fileName = getEmbedFileName(source);

  if (!fileName) {
    renderError(el, 'mindmap-eome: put exactly one Markdown filename in the code block.');
    return;
  }

  const file = plugin.app.metadataCache.getFirstLinkpathDest(fileName, ctx.sourcePath);
  if (!(file instanceof TFile) || file.extension !== 'md') {
    renderError(el, `mindmap-eome: file not found: ${fileName}`);
    return;
  }

  const markdown = await plugin.app.vault.read(file);
  if (!isOutlineCompatible(markdown)) {
    renderError(el, `mindmap-eome: ${file.name} is not a compatible mindmap outline.`);
    return;
  }

  const roots = parseOutline(markdown);
  const flat = flattenOutline(roots);
  if (flat.length === 0) {
    renderError(el, `mindmap-eome: ${file.name} has no outline nodes.`);
    return;
  }

  el.empty();
  const wrapper = el.createDiv({ cls: 'mindmap-eome-wrapper' });
  // Registered before anything renders. Markdown rendered into this embed
  // must be owned by something that dies with the embed; the plugin instance
  // lives for the whole session and would retain every embed ever drawn.
  const child = new MarkdownRenderChild(wrapper);
  ctx.addChild(child);
  const canvas = wrapper.createDiv({ cls: 'mindmap-canvas mindmap-eome-canvas' });
  const openButton = wrapper.createEl('button', {
    cls: 'mindmap-eome-open-button',
    attr: { 'aria-label': 'Open mindmap' },
  });
  setIcon(openButton, 'external-link');
  openButton.addEventListener('click', (event) => {
    void (async () => {
      event.preventDefault();
      event.stopPropagation();
      await plugin.openMindmapReplacingLeaf(file);
  
    })();
  });

  const sizeMap = await measureNodes(plugin, child, file, flat);
  const elements = buildElements(flat, sizeMap);
  const layoutOptions = {
    name: 'dagre',
    fit: false,
    padding: 24,
    nodeDimensionsIncludeLabels: false,
    spacingFactor: 1,
    sort: sortByMarkdownOrder,
  } as unknown as LayoutOptions;

  const cy = cytoscape({
    container: canvas,
    elements,
    layout: layoutOptions,
    boxSelectionEnabled: false,
    autoungrabify: true,
    autounselectify: true,
    userPanningEnabled: false,
    userZoomingEnabled: false,
    style: [
      {
        selector: 'node',
        style: {
          'shape': 'rectangle',
          'background-opacity': 0.01,
          'background-color': '#ffffff',
          width: 'data(width)',
          height: 'data(height)',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1,
          'line-color': '#000000',
          'curve-style': 'straight',
        },
      },
    ],
  });

  cy.on('layoutstop', () => {
    arrangeTopLevelTrees(cy, roots, sizeMap, 'vertical', 160);
    cy.fit(cy.elements(), 28);
    cy.center(cy.elements());
    void renderOverlays(plugin, child, file, wrapper, cy, flat, sizeMap);
  });

  cy.layout(layoutOptions).run();

  child.onunload = () => cy.destroy();
}
