import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import type MindmapPlugin from '../src/main';
import { MindmapView } from '../src/view/mindmap-view';
import { document, mockVault, thought } from './multiline-fixtures';
import { parseHeadingSections } from '../src/utils/heading-sections';

// Exercise the actual view commands with a vault, leaving Obsidian's DOM and
// graph rendering outside this command test.
vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('./obsidian-mock')>();
  return {
    ...original,
    Platform: { isMobile: false },
    TextFileView: class extends original.Component {
      app: unknown;
      data = '';
      constructor(leaf: { app: unknown }) { super(); this.app = leaf.app; }
    },
  };
});

function setup(text = '- Parent\n\t- Child\n- Other') {
  const vault = mockVault(text);
  const view = new MindmapView({ app: vault.app } as unknown as WorkspaceLeaf, {} as MindmapPlugin);
  view.file = vault.file;
  // Keep the real document update and history logic; skip only layout/DOM work.
  vi.spyOn(view, 'incrementalUpdate').mockResolvedValue();
  view.applyDocIncremental(text);
  return { view, vault };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('per-view structural heading capability', () => {
  it('defaults to true and inserts a heading before the selected tree root', async () => {
    const { view, vault } = setup();
    expect(view.supportsStructuralHeadings).toBe(true);
    await view.executeAddHeadingCommand(view.getFlatNodes()[1]);
    expect(vault.getText()).toBe('# Heading\n- Parent\n\t- Child\n- Other');
    expect(view.getViewData()).toBe(vault.getText());
    expect(view.commandHistory.canUndo()).toBe(true);
  });

  it('makes a direct command call a no-op for a host without changing another view', async () => {
    const host = setup();
    const standalone = setup();
    host.view.supportsStructuralHeadings = false;
    const before = host.vault.getText();
    const process = vi.spyOn(host.vault.app.vault, 'process');

    await host.view.executeAddHeadingCommand(host.view.getFlatNodes()[0]);

    expect(process).not.toHaveBeenCalled();
    expect(host.vault.getText()).toBe(before);
    expect(host.view.getViewData()).toBe(before);
    expect(host.view.commandHistory.canUndo()).toBe(false);
    expect(standalone.view.supportsStructuralHeadings).toBe(true);
    await standalone.view.executeAddHeadingCommand(standalone.view.getFlatNodes()[0]);
    expect(standalone.vault.getText()).toContain('# Heading\n');
  });

  it('still edits Markdown headings within multiline entries without persisting the capability', async () => {
    const { view, vault } = setup(document([thought('Before\n\n## Content heading', [thought('Child')])]));
    view.supportsStructuralHeadings = false;
    await view.executeEditNodeCommand(view.getFlatNodes()[0], 'After\n\n# Edited content heading');
    expect(view.getFlatNodes()[0].text).toBe('After\n\n# Edited content heading');
    expect(view.getFlatNodes()[1].text).toBe('Child');
    expect(parseHeadingSections(vault.getText())).toEqual([]);
    expect(vault.getText()).not.toContain('supportsStructuralHeadings');
    expect(view.commandHistory.canUndo()).toBe(true);
  });
});
