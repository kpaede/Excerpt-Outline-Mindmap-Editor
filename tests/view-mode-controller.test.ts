import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin, ViewState, WorkspaceLeaf } from 'obsidian';
import { Menu, TFile } from './obsidian-mock';
import { ViewModeController } from '../src/integration/view-mode-controller';
import { addToggleMindmapMenuItem } from '../src/integration/context-menu';
import { VIEW_TYPE_MINDMAP } from '../src/constants';

function setup() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const cleanup: (() => void)[] = [];
  const leaves: WorkspaceLeaf[] = [];
  const files = new Map<string, TFile>();
  const marked = new Set<TFile>();
  let active: WorkspaceLeaf | null = null;
  let ready!: () => void;
  const emit = (name: string, ...args: any[]) => listeners.get(name)?.forEach(fn => fn(...args));
  const workspace = {
    getMostRecentLeaf: () => active,
    getLeavesOfType: (type: string) => leaves.filter(leaf => leaf.getViewState().type === type),
    on: (name: string, callback: (...args: any[]) => void) => {
      const events = listeners.get(name) ?? new Set();
      events.add(callback); listeners.set(name, events);
      return { name, callback };
    },
    onLayoutReady: (callback: () => void) => { ready = callback; },
    revealLeaf: vi.fn(async () => undefined),
    getLeaf: vi.fn(),
  };
  const app = {
    workspace,
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: marked.has(file) ? { 'excerpt-outline-mindmap': '' } : {} }) },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      cachedRead: vi.fn(async () => '- Ordinary note'),
    },
  };
  const owner = {
    app,
    register: (fn: () => void) => cleanup.push(fn),
    registerEvent: (ref: { name: string; callback: (...args: any[]) => void }) => cleanup.push(() => listeners.get(ref.name)?.delete(ref.callback)),
  };
  const controller = new ViewModeController(owner as unknown as Plugin);
  function file(path = 'Map.md', isMarked = true): TFile {
    const file = new TFile(); file.path = path; file.name = path; files.set(path, file);
    if (isMarked) marked.add(file);
    return file;
  }
  function leaf(file: TFile, type = 'markdown'): WorkspaceLeaf {
    let state: ViewState = { type, state: { file: file.path } };
    const leaf = {
      getViewState: () => state,
      setViewState: vi.fn(async (next: ViewState) => {
        state = next;
        emit('layout-change');
        if (active === leaf) emit('file-open', files.get(String(next.state?.file)) ?? null);
      }),
    } as unknown as WorkspaceLeaf;
    leaves.push(leaf);
    return leaf;
  }
  function focus(leaf: WorkspaceLeaf, fileEvent = true) {
    active = leaf;
    emit('active-leaf-change', leaf);
    if (fileEvent) emit('file-open', files.get(String(leaf.getViewState().state?.file)) ?? null);
  }
  function navigate(leaf: WorkspaceLeaf, file: TFile, type = 'markdown') {
    return leaf.setViewState({ type, state: { file: file.path } });
  }
  return { controller, app, file, leaf, focus, navigate, ready: () => ready(), emit,
    remove: (leaf: WorkspaceLeaf) => { leaves.splice(leaves.indexOf(leaf), 1); emit('layout-change'); },
    unload: () => cleanup.forEach(fn => fn()), marked };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

// file-open is also emitted when activating an existing pane, including popouts.
describe('view choices across tabs and windows', () => {
  it('keeps a deliberately opened editor after the former timeout and repeated focus changes', async () => {
    const s = setup(); s.ready();
    const map = s.file(); const pane = s.leaf(map, VIEW_TYPE_MINDMAP);
    const other = s.leaf(s.file('Other.md', false));
    s.focus(pane); await s.controller.openEditor(map, pane);
    await vi.advanceTimersByTimeAsync(5000);
    for (let i = 0; i < 3; i++) {
      s.focus(other); s.focus(pane);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(pane.getViewState().type).toBe('markdown');
    expect(s.app.vault.cachedRead).not.toHaveBeenCalled();
  });

  it('still automatically opens marked files in newly opened panes', async () => {
    const s = setup(); s.ready();
    const pane = s.leaf(s.file()); s.focus(pane);
    await vi.advanceTimersByTimeAsync(100);
    expect(pane.getViewState().type).toBe(VIEW_TYPE_MINDMAP);
  });

  it('auto-opens another pane on the same file when Obsidian only emits active-leaf-change', async () => {
    const s = setup(); s.ready();
    const map = s.file(), editor = s.leaf(map, VIEW_TYPE_MINDMAP);
    s.focus(editor); await s.controller.openEditor(map, editor);
    const other = s.leaf(map); s.focus(other, false);
    await vi.advanceTimersByTimeAsync(100);
    expect(other.getViewState().type).toBe(VIEW_TYPE_MINDMAP);
    s.focus(editor, false); await vi.advanceTimersByTimeAsync(100);
    expect(editor.getViewState().type).toBe('markdown');
  });

  it('does not apply one pane’s editor choice to another pane showing the same file', async () => {
    const s = setup(); s.ready();
    const map = s.file(); const editor = s.leaf(map, VIEW_TYPE_MINDMAP);
    s.focus(editor); await s.controller.openEditor(map, editor);
    const second = s.leaf(map); s.focus(second);
    await vi.advanceTimersByTimeAsync(100);
    expect(second.getViewState().type).toBe(VIEW_TYPE_MINDMAP);
    expect(editor.getViewState().type).toBe('markdown');
    s.focus(editor); await vi.advanceTimersByTimeAsync(100);
    expect(editor.getViewState().type).toBe('markdown');
  });

  it('allows an explicit switch back to mindmap in the selected pane', async () => {
    const s = setup(); s.ready();
    const map = s.file(); const pane = s.leaf(map, VIEW_TYPE_MINDMAP);
    const duplicate = s.leaf(map, VIEW_TYPE_MINDMAP);
    s.focus(pane); await s.controller.openEditor(map, pane);
    await s.controller.openMindmap(map, pane);
    expect(pane.getViewState().type).toBe(VIEW_TYPE_MINDMAP);
    expect(duplicate.setViewState).not.toHaveBeenCalled();
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(pane);
  });

  it('auto-opens a map again after navigating away and reopening it in the same pane', async () => {
    const s = setup(); s.ready();
    const map = s.file(); const pane = s.leaf(map, VIEW_TYPE_MINDMAP);
    s.focus(pane); await s.controller.openEditor(map, pane);
    await s.navigate(pane, s.file('Ordinary.md', false));
    await s.navigate(pane, map);
    await vi.advanceTimersByTimeAsync(100);
    expect(pane.getViewState().type).toBe(VIEW_TYPE_MINDMAP);
  });

  it('preserves editor views restored with the workspace or a plugin reload', async () => {
    const s = setup(); const pane = s.leaf(s.file());
    s.focus(pane); s.ready();
    s.focus(pane); await vi.advanceTimersByTimeAsync(5000);
    expect(pane.getViewState().type).toBe('markdown');
  });

  it('leaves ordinary notes in the normal Obsidian view', async () => {
    const s = setup(); s.ready();
    const pane = s.leaf(s.file('Ordinary.md', false)); s.focus(pane);
    await vi.advanceTimersByTimeAsync(100);
    expect(pane.setViewState).not.toHaveBeenCalled();
  });
});

describe('auto-open requests keep their original pane and document', () => {
  it('does not steal focus back when loading a large mindmap finishes later', async () => {
    const s = setup(); s.ready();
    const pane = s.leaf(s.file()), other = s.leaf(s.file('Other.md', false));
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(pane.setViewState).mockImplementation(async state => {
      await loading;
      if (state.active) s.focus(pane);
    });
    s.focus(pane); await vi.advanceTimersByTimeAsync(100);
    s.focus(other); release();
    await Promise.resolve(); await Promise.resolve();
    expect(s.app.workspace.getMostRecentLeaf()).toBe(other);
  });

  function pendingRead() {
    const s = setup(); s.ready();
    const map = s.file('Map.md', false);
    const pane = s.leaf(map);
    let release!: (text: string) => void;
    s.app.vault.cachedRead.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    s.focus(pane);
    return { ...s, map, pane, release: () => release('---\nexcerpt-outline-mindmap:\n---\n- Map') };
  }

  for (const action of ['editor', 'navigate', 'focus', 'close', 'unload'] as const) {
    it(`does not override ${action} while reading a map marker`, async () => {
      const s = pendingRead();
      await vi.advanceTimersByTimeAsync(100);
      if (action === 'editor') await s.controller.openEditor(s.map, s.pane);
      if (action === 'navigate') await s.navigate(s.pane, s.file('Next.md', false));
      if (action === 'focus') s.focus(s.leaf(s.file('Other.md', false)));
      if (action === 'close') s.remove(s.pane);
      if (action === 'unload') s.unload();
      s.release(); await Promise.resolve(); await Promise.resolve();
      expect(s.pane.getViewState().type).toBe('markdown');
      if (action === 'navigate') expect(s.pane.getViewState().state?.file).toBe('Next.md');
    });
  }
});

it('labels the EOME action and targets the menu’s editor even if another pane shows the same map', async () => {
  const s = setup(); s.ready();
  const map = s.file(); const editor = s.leaf(map); const mindmap = s.leaf(map, VIEW_TYPE_MINDMAP);
  s.focus(mindmap);
  const openMindmapReplacingLeaf = vi.fn(async () => undefined);
  const openMarkdownReplacingLeaf = vi.fn(async () => undefined);
  const plugin = { app: s.app, openMindmapReplacingLeaf, openMarkdownReplacingLeaf };
  const menu = new Menu();
  addToggleMindmapMenuItem(menu, plugin as never, map, editor);
  expect(menu.items[0].title).toBe('Open as mindmap (EOME)');
  await menu.items[0].click?.();
  expect(openMindmapReplacingLeaf).toHaveBeenCalledWith(map, editor);
  const otherMenu = new Menu();
  addToggleMindmapMenuItem(otherMenu, plugin as never, map, mindmap);
  expect(otherMenu.items[0].title).toBe('Open in editor');
  await otherMenu.items[0].click?.();
  expect(openMarkdownReplacingLeaf).toHaveBeenCalledWith(map, mindmap);
});
