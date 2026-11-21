import { describe, expect, it, vi } from 'vitest';
import { updateTaskOverlays } from '../src/view/task-overlay-update';
import { parseOutline, flattenOutline } from '../src/utils/outline';
import { document, richText, thought } from './multiline-fixtures';
import { setNodeCheckboxInText } from '../src/domain/mindmap-file';
import type { MindmapView } from '../src/view/mindmap-view';
const append = vi.hoisted(() => vi.fn());
vi.mock('../src/view/node-overlay-controls', () => ({ appendCheckboxToggle: append, updateCheckboxPresentation: vi.fn() }));

function setup() {
  const before = document([thought(richText, [thought('Child')], 'unchecked')]);
  const rendered = flattenOutline(parseOutline(before));
  let current = rendered;
  const removed = vi.fn();
  const boxes = rendered.map(node => ({ dataset: { nodeLine: String(node.line) }, querySelector: () => ({ remove: removed }) }));
  const view = {
    cy: { destroyed: () => false, nodes: () => rendered,
      getElementById: (id: string) => ({ data: () => rendered.find(node => `n${node.line}` === id) }) },
    wrapper: { querySelector: () => null, querySelectorAll: () => boxes },
    getFlatNodes: () => current,
    updateSelectionStyling: vi.fn(),
  } as unknown as MindmapView;
  return { before, view, rendered, setCurrent: (text: string) => { current = flattenOutline(parseOutline(text)); }, removed };
}

describe('task changes avoid rebuilding Markdown and layout', () => {
  it('updates the existing controls and all callback snapshots for repeated task toggles', () => {
    const setupResult = setup();
    const { view, rendered, setCurrent, removed } = setupResult;
    let text = setupResult.before;
    for (const state of ['checked', 'unchecked', 'none', 'checked'] as const) {
      text = setNodeCheckboxInText(text, rendered[0], state);
      setCurrent(text);
      expect(updateTaskOverlays(view)).toBe(true);
      expect(rendered[0].checkbox).toBe(state);
      expect(rendered[0].text).toBe(richText);
      expect(rendered.every(node => node.sourceDoc === text)).toBe(true);
    }
    expect(removed).toHaveBeenCalledTimes(4);
  });
  it('requires full rendering when content or structure changes', () => {
    const { view, setCurrent } = setup();
    setCurrent(document([thought('Changed content', [thought('Child')], 'unchecked')]));
    expect(updateTaskOverlays(view)).toBe(false);
    setCurrent(document([thought(richText, [thought('Child'), thought('New child')], 'unchecked')]));
    expect(updateTaskOverlays(view)).toBe(false);
  });
});

it('does not skip heading or frontmatter updates merely because node contents match', () => {
  const { view, setCurrent, before } = setup();
  setCurrent(before + '\n# Newly added section');
  expect(updateTaskOverlays(view)).toBe(false);
  setCurrent(before.replace('custom: keep me', 'custom: externally changed'));
  expect(updateTaskOverlays(view)).toBe(false);
});

it('refreshes source snapshots without rebuilding Markdown when only the saved zoom changes',()=>{
  const {view,setCurrent,before,rendered}=setup();
  const withZoom=before.replace('custom: keep me','excerpt-outline-mindmap: nodeWidth:300;zoomFactor:0.65');setCurrent(withZoom);Object.assign(rendered[0],flattenOutline(parseOutline(withZoom))[0]);Object.assign(rendered[1],flattenOutline(parseOutline(withZoom))[1]);
  const after=withZoom.replace('zoomFactor:0.65','zoomFactor:0.7');setCurrent(after);expect(updateTaskOverlays(view)).toBe(true);expect(rendered.every(n=>n.sourceDoc===after)).toBe(true);
  setCurrent(after.replace('nodeWidth:300','nodeWidth:340'));expect(updateTaskOverlays(view)).toBe(false);
});
