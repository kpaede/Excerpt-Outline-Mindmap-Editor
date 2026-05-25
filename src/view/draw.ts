import cytoscape, { ElementDefinition, type LayoutOptions } from 'cytoscape';
// @ts-ignore - no types available for cytoscape-dagre
import dagre from 'cytoscape-dagre';

import { parseOutline, OutlineNode } from '../utils/outline';
import { VerticalToolbar } from '../ui/toolbar/vertical-toolbar';
import { MindmapView } from './mindmap-view';
import { sortByMarkdownOrder } from '../utils/cytoscape';
import { arrangeTopLevelTrees } from './tree-layout';
import { measureNodesForLayout } from './node-measurement';

cytoscape.use(dagre);

export async function draw(view: MindmapView): Promise<void> {
  if (!view.file) return;

  const isInitialDraw = !view.cy;

  if (isInitialDraw) {
    view.ensureMindmapWrapper();
    view.wrapper.empty();
    view.toolbar = new VerticalToolbar(view);
    view.refreshMobileToolbarPlacement();
  }

  // Only clear overlays on true initial draw
  if (isInitialDraw) {
    view.wrapper.querySelectorAll('[data-overlay]').forEach((e) => e.remove());
  }

  const roots = parseOutline(view.data);
  const flat: OutlineNode[] = [];
  (function walk(arr: OutlineNode[]) {
    arr.forEach((n) => {
      flat.push(n);
      walk(n.children);
    });
  })(roots);

  await measureNodesForLayout(view, flat);

  const els: ElementDefinition[] = [];
  const orderByLine = new Map<number, number>();
  flat.forEach((node, index) => orderByLine.set(node.line, index));

  for (const n of flat) {
    const dims = view.sizeMap.get(n.line)!;
    els.push({
      data: {
        id: `n${n.line}`,
        node: n,
        width: dims.w,
        height: dims.h,
        order: orderByLine.get(n.line) ?? n.line,
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
          order: orderByLine.get(c.line) ?? c.line,
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
    acyclicer: L.acyclicer,
    ranker: L.ranker,
    fit: false,
    padding: 20,
    nodeDimensionsIncludeLabels: false,
    spacingFactor: L.spacingFactor,
    sort: sortByMarkdownOrder,
  } as unknown as LayoutOptions;

  if (!view.cy) {
    const canvas = view.wrapper.createDiv({ cls: 'mindmap-canvas' });

    view.cy = cytoscape({
      container: canvas,
      elements: els,
      layout: layoutOpts,
      boxSelectionEnabled: false,
      selectionType: 'single',
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
      wheelSensitivity: 0.2, // This controls zoom sensitivity
    });

    let geometryUpdateFrame: number | null = null;
    view.cy.on('pan zoom', () => {
      if (geometryUpdateFrame !== null) return;

      geometryUpdateFrame = requestAnimationFrame(() => {
        geometryUpdateFrame = null;
        if (!view.updateOverlayGeometry()) {
          view.updateOverlays();
        }
      });
    });

    view.cy.on('layoutstop', () => {
      const layoutRoots = view.cy!.scratch('_mindmapRoots') as OutlineNode[] | undefined;
      arrangeTopLevelTrees(
        view.cy!,
        layoutRoots ?? roots,
        view.sizeMap,
        view.layoutOptions.headingTreeLayout ?? 'vertical',
        Math.max(160, (view.layoutOptions.rankSep ?? 50) * 3)
      );
      if (!view.firstFitDone) {
        view.cy!.center(view.cy!.elements());
        if (typeof view.layoutOptions.zoomFactor === 'number') {
          view.setZoomFactor(view.layoutOptions.zoomFactor, false);
        } else {
          view.cy!.fit(view.cy!.elements(), 50);
          view.cy!.center(view.cy!.elements());
          view.rememberCurrentZoom(false);
        }
        view.firstFitDone = true;
      }
      view.rememberCurrentZoom(false);
      view.updateOverlays();
    });

    view.cy.scratch('_mindmapRoots', roots);
    view.cy.layout(layoutOpts).run();
  } else {
    view.cy.json({ elements: els });
    view.cy.scratch('_mindmapRoots', roots);
    view.cy.layout(layoutOpts).run();
  }

  view.cy.userPanningEnabled(false);
  view.cy.userZoomingEnabled(false);
}
