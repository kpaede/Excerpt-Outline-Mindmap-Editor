import {
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  TFile,
  setIcon,
} from 'obsidian';
import cytoscape, { ElementDefinition, type LayoutOptions } from 'cytoscape';
// @ts-ignore - no types available for cytoscape-dagre
import dagre from 'cytoscape-dagre';

import type MindmapPlugin from './main';
import { isOutlineCompatible, OutlineNode, parseOutline } from './util';

cytoscape.use(dagre);

function sortByMarkdownOrder(a: any, b: any): number {
  return (a.data('order') ?? 0) - (b.data('order') ?? 0);
}

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

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function measureNodes(
  plugin: MindmapPlugin,
  file: TFile,
  flat: OutlineNode[]
): Promise<Map<number, { w: number; h: number }>> {
  const sizeMap = new Map<number, { w: number; h: number }>();
  const targetWidth = 300;
  const measureContainer = document.createElement('div');
  measureContainer.className = 'mindmap-eome-measurement-container';
  document.body.appendChild(measureContainer);

  for (const node of flat) {
    const box = document.createElement('div');
    box.className = 'mindmap-measure-box';
    box.style.setProperty('--mindmap-target-width', `${targetWidth}px`);

    if (node.text.trim() === '') {
      box.innerHTML = '&nbsp;';
    } else {
      await MarkdownRenderer.render(plugin.app, node.text, box, file.path, plugin);
      await waitForAsyncContent(box);
    }

    measureContainer.appendChild(box);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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

  for (const node of flat) {
    const cyNode = cy.getElementById(`n${node.line}`);
    const dims = sizeMap.get(node.line);
    if (!cyNode || cyNode.empty() || !dims) continue;

    const position = cyNode.renderedPosition();
    const box = document.createElement('div');
    box.className = 'mindmap-overlay mindmap-eome-overlay';
    box.dataset.mindmapEomeOverlay = '1';
    box.style.setProperty('--mindmap-left', `${position.x}px`);
    box.style.setProperty('--mindmap-top', `${position.y}px`);
    box.style.setProperty('--mindmap-box-width', `${dims.w}px`);
    box.style.setProperty('--mindmap-box-height', `${dims.h}px`);
    box.style.setProperty('--mindmap-zoom', String(zoom));
    box.style.setProperty('--mindmap-border', '#000000');
    box.style.setProperty('--mindmap-bg', bg);
    box.style.setProperty('--mindmap-color', txt);
    box.style.setProperty('--mindmap-font', font);

    const content = document.createElement('div');
    content.className = 'markdown-rendered';
    if (node.scaleFactor && node.scaleFactor !== 1) {
      content.style.setProperty('--mindmap-scale', String(node.scaleFactor));
    }

    if (node.text.trim() === '') {
      content.innerHTML = '&nbsp;';
    } else {
      await MarkdownRenderer.render(plugin.app, node.text, content, file.path, plugin);
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

  const flat = flattenOutline(parseOutline(markdown));
  if (flat.length === 0) {
    renderError(el, `mindmap-eome: ${file.name} has no outline nodes.`);
    return;
  }

  el.empty();
  const wrapper = el.createDiv({ cls: 'mindmap-eome-wrapper' });
  const canvas = wrapper.createDiv({ cls: 'mindmap-canvas mindmap-eome-canvas' });
  const openButton = wrapper.createEl('button', {
    cls: 'mindmap-eome-open-button',
    attr: { 'aria-label': 'Open mindmap' },
  });
  setIcon(openButton, 'external-link');
  openButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await plugin.openMindmapReplacingLeaf(file);
  });

  const sizeMap = await measureNodes(plugin, file, flat);
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
    cy.fit(cy.elements(), 28);
    cy.center(cy.elements());
    void renderOverlays(plugin, file, wrapper, cy, flat, sizeMap);
  });

  cy.layout(layoutOptions).run();

  const child = new MarkdownRenderChild(wrapper);
  child.onunload = () => cy.destroy();
  ctx.addChild(child);
}
