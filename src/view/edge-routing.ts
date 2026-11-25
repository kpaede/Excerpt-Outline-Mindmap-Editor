import type { Core, Css, EdgeSingular } from 'cytoscape';
import type { LayoutOptions } from '../domain/layout-options';

/** Taxi routing keeps every segment on an axis and follows the tree direction. */
export function edgeRoutingStyle(options: LayoutOptions): Css.Edge {
  return {
    'curve-style': options.edgeStyle === 'orthogonal' ? 'taxi' : 'straight',
    'taxi-direction': options.rankDir === 'LR' || options.rankDir === 'RL' ? 'horizontal' : 'vertical',
    'taxi-turn': '50%',
    'taxi-turn-min-distance': 0,
  };
}

export function applyEdgeRouting(cy: Core, options: LayoutOptions): void {
  cy.edges().style(edgeRoutingStyle(options));
}

/** Use the renderer's public coordinates so exports match on-screen bends,
 * including Taxi's fallback routes when nodes are close together. */
export function renderedEdgePolyline(edge: EdgeSingular): string {
  const bends = edge.style('curve-style') === 'taxi' ? edge.renderedSegmentPoints() ?? [] : [];
  return [edge.renderedSourceEndpoint(), ...bends, edge.renderedTargetEndpoint()]
    .map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}
