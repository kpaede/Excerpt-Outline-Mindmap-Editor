import { describe, expect, it } from 'vitest';
import { initializeViewport } from '../src/view/initial-viewport';
import type { MindmapView } from '../src/view/mindmap-view';

function fixture(fitted: number, visible = true, saved?: number) {
  let zoom = 1;
  let centered = '';
  let resized = 0;
  const view = {
    firstFitDone: false,
    layoutOptions: { zoomFactor: saved },
    rememberCurrentZoom: () => {},
    cy: {
      container: () => ({ getBoundingClientRect: () => ({ width: visible ? 900 : 0, height: visible ? 600 : 0 }) }),
      resize: () => { resized++; },
      fit: () => { zoom = fitted; },
      zoom: (value?: number) => { if (value !== undefined) zoom = value; return zoom; },
      elements: () => 'all',
      nodes: () => ({ first: () => 'first' }),
      center: (value: string) => { centered = value; },
    },
  } as unknown as MindmapView;
  return { view, zoom: () => zoom, centered: () => centered, resized: () => resized };
}

describe('opening long documents at a usable zoom', () => {
  it('does not fit hidden tabs against a zero-sized viewport', () => {
    const state = fixture(1e-8, false);
    initializeViewport(state.view);
    expect(state.view.firstFitDone).toBe(false);
    expect(state.resized()).toBe(0);
  });
  it('starts at a readable first thought when an entire deep tree would be tiny', () => {
    const state = fixture(0.013);
    initializeViewport(state.view);
    expect(state.zoom()).toBe(0.65);
    expect(state.centered()).toBe('first');
    expect(state.view.firstFitDone).toBe(true);
  });
  it('retains an explicitly saved overview zoom', () => {
    const state = fixture(0.013, true, 0.02);
    initializeViewport(state.view);
    expect(state.zoom()).toBe(0.02);
    expect(state.centered()).toBe('all');
  });
  it('fits smaller maps and does not reset their viewport on later edits', () => {
    const state = fixture(0.9);
    initializeViewport(state.view);
    initializeViewport(state.view);
    expect(state.zoom()).toBe(0.9);
    expect(state.resized()).toBe(1);
  });
});
