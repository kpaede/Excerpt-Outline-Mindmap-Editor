import type { Core } from 'cytoscape';
import type { MindmapView } from './mindmap-view';

/** Resolve the entire graph after layout, including edges outside the viewport.
 * Repaint without fitting the map or changing the user's zoom and pan. */
export function refreshGraphGeometry(cy: Core): void {
  if (cy.destroyed()) return;
  const rect = cy.container()?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) cy.resize();
  cy.elements().boundingBox({ includeLabels: false, includeOverlays: false });
  cy.forceRender();
}

function revealShift(start: number, end: number, size: number): number {
  const padding = Math.min(32, size / 4);
  if (start < padding || end - start > size - padding * 2) return padding - start;
  return end > size - padding ? size - padding - end : 0;
}

/** Move the graph before focusing an offscreen editor. Native document scrolling
 * cannot reveal a canvas edge; the nodes and canvas must share Cytoscape's pan. */
export function revealNodeForEditing(view: MindmapView, nodeLine: number): void {
  const cy = view.cy;
  if (!cy || cy.destroyed()) return;
  const node = cy.getElementById(`n${nodeLine}`);
  const dims = view.sizeMap.get(nodeLine);
  if (node.empty() || !dims) return;
  cy.resize();
  const width = cy.width(), height = cy.height();
  if (width < 2 || height < 2) return;
  const zoom = cy.zoom(), position = node.renderedPosition();
  const left = position.x - dims.w * zoom / 2;
  const top = position.y - dims.h * zoom / 2;
  const x = revealShift(left, left + Math.max(dims.w, 280) * zoom, width);
  const y = revealShift(top, top + Math.max(dims.h, 70) * zoom, height);
  if (x === 0 && y === 0) return;
  cy.panBy({ x, y });
  // The editor is focused synchronously, before the deferred pan/zoom frame.
  view.updateOverlayGeometry();
}
