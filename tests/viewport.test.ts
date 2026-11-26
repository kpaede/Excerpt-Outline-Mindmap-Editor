import cytoscape from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';
import { refreshGraphGeometry, revealNodeForEditing } from '../src/view/viewport';
import type { MindmapView } from '../src/view/mindmap-view';

function fixture(position: { x: number; y: number }, dims = { w: 300, h: 60 }) {
  const cy = cytoscape({
    headless: true, styleEnabled: true, layout: { name: 'preset' },
    elements: [
      { data: { id: 'n1' }, position: { x: 100, y: 100 } },
      { data: { id: 'n2' }, position },
      { data: { id: 'edge', source: 'n1', target: 'n2' } },
    ],
  });
  vi.spyOn(cy, 'width').mockReturnValue(900);
  vi.spyOn(cy, 'height').mockReturnValue(600);
  cy.zoom(0.8); cy.pan({ x: 15, y: 25 });
  const updateOverlayGeometry = vi.fn();
  const view = { cy, sizeMap: new Map([[2, dims]]), updateOverlayGeometry } as unknown as MindmapView;
  return { view, cy, node: cy.getElementById('n2'), updateOverlayGeometry };
}

describe('offscreen node editors', () => {
  for (const position of [{ x: 8000, y: 3000 }, { x: -4000, y: -1000 }, { x: -2000, y: 3000 }]) {
    it(`reveals the complete editor near (${position.x}, ${position.y}) without zooming or losing edges`, () => {
      const { view, cy, node, updateOverlayGeometry } = fixture(position);
      try {
        revealNodeForEditing(view, 2);
        const p = node.renderedPosition();
        expect(p.x - 300 * cy.zoom() / 2).toBeGreaterThanOrEqual(31.99);
        expect(p.x + 300 * cy.zoom() / 2).toBeLessThanOrEqual(868.01);
        expect(p.y - 60 * cy.zoom() / 2).toBeGreaterThanOrEqual(31.99);
        expect(p.y + 60 * cy.zoom() / 2).toBeLessThanOrEqual(568.01);
        expect(cy.zoom()).toBe(0.8);
        expect(cy.edges()).toHaveLength(1);
        expect(updateOverlayGeometry).toHaveBeenCalledOnce();
      } finally { cy.destroy(); }
    });
  }

  it('keeps an already visible editor and the viewport stationary', () => {
    const { view, cy, updateOverlayGeometry } = fixture({ x: 400, y: 300 });
    const pan = { ...cy.pan() };
    try {
      revealNodeForEditing(view, 2);
      expect(cy.pan()).toEqual(pan);
      expect(updateOverlayGeometry).not.toHaveBeenCalled();
    } finally { cy.destroy(); }
  });

  it('shows the start of oversized content without making the map unreadably small', () => {
    const { view, cy, node } = fixture({ x: 8000, y: 3000 }, { w: 1800, h: 4000 });
    try {
      revealNodeForEditing(view, 2);
      const p = node.renderedPosition();
      expect(p.x - 1800 * cy.zoom() / 2).toBeCloseTo(32);
      expect(p.y - 4000 * cy.zoom() / 2).toBeCloseTo(32);
      expect(cy.zoom()).toBe(0.8);
    } finally { cy.destroy(); }
  });
});

it('refreshes the whole graph after an offscreen edit without changing the saved viewport', () => {
  const { cy, node } = fixture({ x: 8000, y: 3000 });
  const paint = vi.spyOn(cy, 'forceRender');
  const pan = { ...cy.pan() };
  try {
    cy.elements().boundingBox();
    node.position({ x: 16000, y: 7000 });
    refreshGraphGeometry(cy);
    const bounds = cy.elements().boundingBox();
    expect(bounds.x2).toBeGreaterThan(16000);
    expect(bounds.y2).toBeGreaterThan(7000);
    expect(cy.edges()).toHaveLength(1);
    expect(cy.pan()).toEqual(pan);
    expect(cy.zoom()).toBe(0.8);
    expect(paint).toHaveBeenCalledOnce();
  } finally { cy.destroy(); }
});
