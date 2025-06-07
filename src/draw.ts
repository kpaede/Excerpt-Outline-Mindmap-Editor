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
  addChildText,
  DocString,
} from './mindmap-file';
import { VerticalToolbar } from './vertical-toolbar';
import { MindmapView } from './mindmapView';

cytoscape.use(dagre);

export async function draw(view: MindmapView): Promise<void> {
  if (!view.file) return;

  const isInitialDraw = !view.cy;

  if (isInitialDraw) {
    view.contentEl.empty();
    view.wrapper = view.contentEl.createDiv({ cls: 'mindmap-wrapper' });
    Object.assign(view.wrapper.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
    });
    if (!view.toolbar) {
      view.toolbar = new VerticalToolbar(view);
    }
  }

  // Only clear overlays on initial draw or complete rebuild
  if (isInitialDraw || !view.cy) {
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
  Object.assign(measureContainer.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '0',
    pointerEvents: 'none',
    zIndex: '-1',
  } as CSSStyleDeclaration);
  document.body.appendChild(measureContainer);

  view.sizeMap.clear();

  for (const n of flat) {
    const tmpBox = document.createElement('div');
    Object.assign(tmpBox.style, {
      position: 'relative',
      padding: '6px 10px 22px',
      border: '1px solid transparent',
      borderRadius: '4px',
      background: 'transparent',
      color: 'inherit',
      fontFamily: 'inherit',
      fontSize: '16px',
      whiteSpace: 'normal',
      wordWrap: 'break-word',
      maxWidth: '260px',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    if (n.text.trim() === '') {
      tmpBox.innerHTML = '&nbsp;';
    } else {
      await MarkdownRenderer.renderMarkdown(
        n.text,
        tmpBox,
        view.file.path,
        (view as unknown) as Component
      );
    }

    measureContainer.appendChild(tmpBox);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const rect = tmpBox.getBoundingClientRect();
    let measuredW = rect.width;
    const measuredH = rect.height;

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
    const canvas = view.wrapper.createDiv();
    Object.assign(canvas.style, { position: 'absolute', inset: '0' });

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
