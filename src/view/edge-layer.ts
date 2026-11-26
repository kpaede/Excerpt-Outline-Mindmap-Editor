import type { Core } from 'cytoscape';
import { modelEdgePolyline } from './edge-routing';

/** All connections live in the same DOM coordinate space as node overlays.
 * Panning changes one SVG transform; no viewport-dependent canvas cache is
 * needed to discover or paint a newly added offscreen connection. */
export function renderEdgeLayer(wrapper: HTMLElement, cy: Core): void {
  let layer = wrapper.querySelector<SVGSVGElement>(':scope > .mindmap-edge-layer');
  if (!layer) {
    layer = wrapper.createSvg('svg', { cls: 'mindmap-edge-layer', attr: { 'aria-hidden': 'true' } });
  }
  layer.empty();
  const group = layer.createSvg('g');
  cy.edges().forEach(edge => {
    group.createSvg('polyline', { attr: {
      'data-edge-id': edge.id(),
      points: modelEdgePolyline(edge),
    } });
  });
  wrapper.classList.add('mindmap-has-edge-layer');
  updateEdgeLayerTransform(wrapper, cy);
}

export function updateEdgeLayerTransform(wrapper: HTMLElement, cy: Core): void {
  const group = wrapper.querySelector<SVGGElement>(':scope > .mindmap-edge-layer > g');
  if (!group) return;
  const pan = cy.pan();
  group.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${cy.zoom()})`);
}
