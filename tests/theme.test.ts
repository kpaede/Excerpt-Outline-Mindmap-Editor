import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { mindmapLineColor, refreshMindmapTheme } from '../src/view/theme';

describe('mindmap canvas theme', () => {
  it('reads the originating view instead of the document root and follows theme changes without resetting the graph', () => {
    let muted = '#555555';
    const wrapper = {
      ownerDocument: { defaultView: { getComputedStyle: (element: unknown) => {
        expect(element).toBe(wrapper);
        return { getPropertyValue: (name: string) => name === '--text-muted' ? muted : '' };
      } } },
    } as unknown as HTMLElement;
    const cy = cytoscape({
      headless: true, styleEnabled: true,
      elements: [{ data: { id: 'a' } }, { data: { id: 'b' } }, { data: { id: 'ab', source: 'a', target: 'b' } }],
      style: [{ selector: 'edge', style: { 'line-color': mindmapLineColor(wrapper) } }],
    });
    try {
      cy.zoom(1.5);
      cy.pan({ x: 12, y: 42 });
      cy.getElementById('a').select();
      expect(cy.edges().style('line-color')).toBe('rgb(85,85,85)');

      for (const [color, expected] of [['#bbbbbb', 'rgb(187,187,187)'], ['#555555', 'rgb(85,85,85)']]) {
        muted = color;
        refreshMindmapTheme(wrapper, cy);
        expect(cy.edges().style('line-color')).toBe(expected);
        expect(cy.nodes()).toHaveLength(2);
        expect(cy.zoom()).toBe(1.5);
        expect(cy.pan()).toEqual({ x: 12, y: 42 });
        expect(cy.getElementById('a').selected()).toBe(true);
      }
    } finally { cy.destroy(); }
  });

  it('honors host line colors and retains a visible fallback without a window', () => {
    const wrapper = { ownerDocument: { defaultView: { getComputedStyle: () => ({
      getPropertyValue: (name: string) => name === '--mindmap-line-color' ? '#abcdef' : '#555555',
    }) } } } as unknown as HTMLElement;
    expect(mindmapLineColor(wrapper)).toBe('#abcdef');
    expect(mindmapLineColor({ ownerDocument: { defaultView: null } } as unknown as HTMLElement)).toBe('#808080');
  });
});
