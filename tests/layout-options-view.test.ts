import { expect, it, vi } from 'vitest';
import { MindmapView } from '../src/view/mindmap-view';
import { createDefaultLayoutOptions } from '../src/domain/layout-options';

vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('./obsidian-mock')>();
  return { ...original, TextFileView: original.Component };
});

it('keeps open layout menu controls connected after changing the line style', async () => {
  const view = { layoutOptions: createDefaultLayoutOptions(), file: null, relayout: vi.fn() };
  const menuOptions = view.layoutOptions;
  await MindmapView.prototype.updateLayoutOptions.call(view as unknown as MindmapView, { edgeStyle: 'orthogonal' });
  // The sliders hold the same reference until this menu is closed.
  menuOptions.rankSep = 120;
  expect(view.layoutOptions.rankSep).toBe(120);
  expect(view.layoutOptions.edgeStyle).toBe('orthogonal');
  expect(view.relayout).toHaveBeenCalledOnce();
});
