import cytoscape, { Core, ElementDefinition, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

import { parseOutline, OutlineNode } from '../utils/outline';
import { VerticalToolbar } from '../ui/toolbar/vertical-toolbar';
import { MindmapView } from './mindmap-view';
import { sortByMarkdownOrder } from '../utils/cytoscape';
import { arrangeTopLevelTrees } from './tree-layout';
import { measureNodesForLayout } from './node-measurement';

cytoscape.use(dagre);

export interface DrawRequest {
  generation: number;
  data: string;
  isCurrent(): boolean;
}

export async function draw(view: MindmapView, request: DrawRequest): Promise<void> {
  if (!view.file || !request.isCurrent()) return;

  const roots = parseOutline(request.data);
  const flat: OutlineNode[] = [];
  (function walk(arr: OutlineNode[]) {
    arr.forEach((node) => {
      flat.push(node);
      walk(node.children);
    });
  })(roots);

  // Measurements belong exclusively to this document snapshot. They become
  // visible to Cytoscape and overlays together only after the whole pass has
  // completed and this generation is still the newest one.
  const nextSizeMap = await measureNodesForLayout(view, flat);
  if (!request.isCurrent()) return;

  const isInitialDraw = !view.cy;
  if (isInitialDraw) {
    view.ensureMindmapWrapper();
    view.wrapper.empty();
    view.toolbar = new VerticalToolbar(view);
    view.refreshMobileToolbarPlacement();
  }

  view.sizeMap = nextSizeMap;

  const elements = buildElements(flat, nextSizeMap);
  const layoutOptions = createLayoutOptions(view);
  let cy = view.cy;

  if (!cy) {
    const canvas = view.wrapper.createDiv({ cls: 'mindmap-canvas' });
    cy = cytoscape({
      container: canvas,
      elements,
      // The generation-aware layout below is the single authoritative pass.
      layout: { name: 'preset' },
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
      wheelSensitivity: 0.2,
    });
    view.cy = cy;

    cy.on('pan zoom', () => {
      view.requestOverlayGeometryFrame(() => {
        if (!view.updateOverlayGeometry()) {
          view.updateOverlays();
        }
      });
    });
    cy.on('layoutstop', () => applyCompletedLayout(view, cy!));
  } else {
    cy.json({ elements });
  }

  if (!request.isCurrent() || view.cy !== cy || cy.destroyed()) return;

  cy.userPanningEnabled(false);
  cy.userZoomingEnabled(false);
  cy.scratch('_mindmapRoots', roots);
  cy.scratch('_mindmapRenderGeneration', request.generation);

  await runLayout(cy, layoutOptions);
}

function buildElements(
  flat: OutlineNode[],
  sizeMap: Map<number, { w: number; h: number }>
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const orderByLine = new Map<number, number>();
  flat.forEach((node, index) => orderByLine.set(node.line, index));

  for (const node of flat) {
    const dimensions = sizeMap.get(node.line);
    if (!dimensions) continue;
    elements.push({
      data: {
        id: `n${node.line}`,
        node,
        width: dimensions.w,
        height: dimensions.h,
        order: orderByLine.get(node.line) ?? node.line,
      },
    });
  }
  for (const parent of flat) {
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
  }

  return elements;
}

function createLayoutOptions(view: MindmapView): LayoutOptions {
  const options = view.layoutOptions;
  return {
    name: 'dagre',
    rankDir: options.rankDir,
    align: options.align,
    nodeSep: options.nodeSep,
    edgeSep: options.edgeSep,
    rankSep: options.rankSep,
    marginx: options.marginx,
    marginy: options.marginy,
    acyclicer: options.acyclicer,
    ranker: options.ranker,
    fit: false,
    padding: 20,
    nodeDimensionsIncludeLabels: false,
    spacingFactor: options.spacingFactor,
    sort: sortByMarkdownOrder,
  } as unknown as LayoutOptions;
}

function applyCompletedLayout(view: MindmapView, cy: Core): void {
  const generation = cy.scratch('_mindmapRenderGeneration') as number | undefined;
  if (typeof generation !== 'number' || !view.isRenderContextCurrent(generation, cy)) return;

  const roots = cy.scratch('_mindmapRoots') as OutlineNode[] | undefined;
  if (!roots) return;

  arrangeTopLevelTrees(
    cy,
    roots,
    view.sizeMap,
    view.layoutOptions.headingTreeLayout ?? 'vertical',
    Math.max(160, (view.layoutOptions.rankSep ?? 50) * 3)
  );
  if (!view.firstFitDone) {
    cy.center(cy.elements());
    if (typeof view.layoutOptions.zoomFactor === 'number') {
      view.setZoomFactor(view.layoutOptions.zoomFactor, false);
    } else {
      cy.fit(cy.elements(), 50);
      cy.center(cy.elements());
      view.rememberCurrentZoom(false);
    }
    view.firstFitDone = true;
  }
  view.rememberCurrentZoom(false);
  view.updateOverlays();
}

async function runLayout(
  cy: Core,
  options: LayoutOptions
): Promise<void> {
  const layout = cy.layout(options);

  await new Promise<void>((resolve, reject) => {
    const onLayoutStop = () => resolve();

    layout.one('layoutstop', onLayoutStop);
    try {
      layout.run();
    } catch (error) {
      layout.off('layoutstop', onLayoutStop);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
