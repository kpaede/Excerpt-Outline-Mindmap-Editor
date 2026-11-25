import cytoscape, { type EdgeSingular } from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';
import { applyEdgeRouting, edgeRoutingStyle, renderedEdgePolyline } from '../src/view/edge-routing';
import { createDefaultLayoutOptions, normalizeEdgeStyle } from '../src/domain/layout-options';

describe('connection line options', () => {
  it('keeps direct lines for existing maps and invalid saved values', () => {
    expect(createDefaultLayoutOptions().edgeStyle).toBe('straight');
    for (const value of [undefined, null, '', 'curved', 1]) expect(normalizeEdgeStyle(value)).toBe('straight');
    expect(normalizeEdgeStyle('orthogonal')).toBe('orthogonal');
  });

  it('switches an existing graph in every tree direction without changing viewport or theme', () => {
    const cy = cytoscape({
      headless: true, styleEnabled: true,
      elements: [{ data: { id: 'a' } }, { data: { id: 'b' } }, { data: { id: 'ab', source: 'a', target: 'b' } }],
      style: [{ selector: 'edge', style: { 'line-color': '#bbbbbb' } }],
    });
    try {
      cy.zoom(0.7);
      cy.pan({ x: 12, y: 40 });
      for (const rankDir of ['TB', 'BT', 'LR', 'RL'] as const) {
        applyEdgeRouting(cy, { edgeStyle: 'orthogonal', rankDir });
        expect(cy.edges().style('curve-style')).toBe('taxi');
        expect(cy.edges().style('taxi-direction')).toBe(rankDir === 'LR' || rankDir === 'RL' ? 'horizontal' : 'vertical');
        expect(cy.edges().style('line-color')).toBe('rgb(187,187,187)');
        expect(cy.zoom()).toBe(0.7);
        expect(cy.pan()).toEqual({ x: 12, y: 40 });
      }
      applyEdgeRouting(cy, { edgeStyle: 'straight' });
      expect(cy.edges().style('curve-style')).toBe('straight');
    } finally { cy.destroy(); }
  });
});

describe('SVG/PDF edge geometry', () => {
  it('uses the rendered bends and endpoints, retaining zoom and pan coordinates', () => {
    const edge = {
      style: () => 'taxi',
      renderedSourceEndpoint: () => ({ x: 100, y: 50 }),
      renderedSegmentPoints: () => [{ x: 100, y: 90 }, { x: 240, y: 90 }],
      renderedTargetEndpoint: () => ({ x: 240, y: 140 }),
    } as unknown as EdgeSingular;
    expect(renderedEdgePolyline(edge)).toBe('100.00,50.00 100.00,90.00 240.00,90.00 240.00,140.00');
  });

  it('does not reuse cached bends after switching back to direct lines', () => {
    const bends = vi.fn(() => [{ x: 100, y: 90 }]);
    const edge = {
      style: () => 'straight',
      renderedSourceEndpoint: () => ({ x: 100, y: 50 }),
      renderedSegmentPoints: bends,
      renderedTargetEndpoint: () => ({ x: 240, y: 140 }),
    } as unknown as EdgeSingular;
    expect(renderedEdgePolyline(edge)).toBe('100.00,50.00 240.00,140.00');
    expect(bends).not.toHaveBeenCalled();
  });
});
