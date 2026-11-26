import { describe, expect, it } from 'vitest';
import { renderEdgeLayer, updateEdgeLayerTransform } from '../src/view/edge-layer';

class SvgElement {
  children: SvgElement[] = [];
  attributes: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name) };
  constructor(readonly tag: string) {}
  createSvg(tag: string, options?: { cls?: string; attr?: Record<string, string> }): SvgElement {
    const element = new SvgElement(tag);
    if (options?.cls) element.classes.add(options.cls);
    element.attributes = { ...options?.attr };
    this.children.push(element);
    return element;
  }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  empty(): void { this.children = []; }
  querySelector(selector: string): SvgElement | null {
    const svg = this.children.find(child => child.classes.has('mindmap-edge-layer'));
    return selector.endsWith(' > g') ? svg?.children[0] ?? null : svg ?? null;
  }
}

function edge(id: string, end: { x: number; y: number }, taxi = false) {
  return {
    id: () => id,
    style: () => taxi ? 'taxi' : 'straight',
    sourceEndpoint: () => ({ x: 10, y: 20 }),
    targetEndpoint: () => end,
    segmentPoints: () => [{ x: 10, y: 50 }, { x: end.x, y: 50 }],
  };
}

describe('full-graph connection layer', () => {
  it('creates direct and right-angle paths even when both endpoints are far outside the viewport', () => {
    const wrapper = new SvgElement('div');
    const cy = { edges: () => [edge('direct', { x: 50000, y: 90000 }), edge('taxi', { x: -50000, y: -90000 }, true)],
      pan: () => ({ x: 100, y: 200 }), zoom: () => 0.5 };
    renderEdgeLayer(wrapper as never, cy as never);
    const group = wrapper.children[0].children[0];
    expect(group.children.map(line => line.attributes.points)).toEqual([
      '10,20 50000,90000', '10,20 10,50 -50000,50 -50000,-90000',
    ]);
    expect(group.attributes.transform).toBe('translate(100 200) scale(0.5)');
    expect(wrapper.classes.has('mindmap-has-edge-layer')).toBe(true);
  });

  it('pans and zooms existing paths without rebuilding or discarding offscreen connections', () => {
    const wrapper = new SvgElement('div');
    let pan = { x: 0, y: 0 }, zoom = 1;
    const cy = { edges: () => [edge('far', { x: 50000, y: 90000 })], pan: () => pan, zoom: () => zoom };
    renderEdgeLayer(wrapper as never, cy as never);
    const layer = wrapper.children[0], group = layer.children[0], line = group.children[0];
    pan = { x: -49900, y: -89900 }; zoom = 0.8;
    updateEdgeLayerTransform(wrapper as never, cy as never);
    expect(wrapper.children).toEqual([layer]);
    expect(group.children).toEqual([line]);
    expect(line.attributes.points).toBe('10,20 50000,90000');
    expect(group.attributes.transform).toBe('translate(-49900 -89900) scale(0.8)');
  });

  it('updates every connection after adding an offscreen child, retaining one layer', () => {
    const wrapper = new SvgElement('div');
    const edges = [edge('old', { x: 100, y: 200 })];
    const cy = { edges: () => edges, pan: () => ({ x: 0, y: 0 }), zoom: () => 1 };
    renderEdgeLayer(wrapper as never, cy as never);
    edges.push(edge('new', { x: 60000, y: 30000 }));
    renderEdgeLayer(wrapper as never, cy as never);
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.children[0].children[0].children.map(line => line.attributes['data-edge-id'])).toEqual(['old', 'new']);
  });
});
