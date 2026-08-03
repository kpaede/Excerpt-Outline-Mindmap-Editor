import { describe, expect, it } from 'vitest';
import { lastMenu, TFile } from './obsidian-mock';
import { showNodeContextMenu } from '../src/view/context-menu';
import type { OutlineNode } from '../src/utils/outline';

function node(text: string): OutlineNode {
  return { text, indent: '', marker: '-', line: 4, endLine: 4, children: [], checkbox: 'none' };
}

function excalidrawApp(drawingPaths: string[] = []): unknown {
  const known = new Set(drawingPaths);
  return {
    plugins: {
      plugins: {
        'obsidian-excalidraw-plugin': {
          settings: {},
          isExcalidrawFile: (file: { path: string }) => known.has(file.path),
        },
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) => {
        const file = new TFile();
        file.path = `Excalidraw/${linkpath}.md`;
        return file;
      },
    },
  };
}

function menuTitlesFor(targetNode: OutlineNode, app?: unknown): string[] {
  const overlay = { dataset: { nodeLine: String(targetNode.line) } };
  const ownerDocument = {} as Document;
  const event = {
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    clientX: 120,
    clientY: 80,
    composedPath: () => [{ closest: (selector: string) => selector === '.mindmap-overlay' ? overlay : null }],
    target: { closest: (selector: string) => selector === '.mindmap-overlay' ? overlay : null },
  } as unknown as MouseEvent;
  const view = {
    app,
    file: app ? { path: 'Map.md' } : null,
    wrapper: { classList: { contains: () => false }, focus: () => undefined, ownerDocument },
    isDirectNodeDragActive: () => false,
    selectedNodeLines: new Set<number>(),
    getNodeByLine: (line: number) => line === targetNode.line ? targetNode : null,
    selectNode: (line: number) => view.selectedNodeLines.add(line),
    getFlatNodes: () => [targetNode],
    setActiveNodeContextMenu: () => undefined,
  } as never;
  showNodeContextMenu(view, event);
  return lastMenu?.items.map((item) => item.title) ?? [];
}

describe('node drawing context menu', () => {
  it('exposes both drawing insertion actions on a regular node', () => {
    const titles = menuTitlesFor(node('Idea'));
    expect(titles).toContain('Add drawing as child');
    expect(titles).toContain('Add drawing as sibling');
    expect(titles).not.toContain('Edit drawing');
    expect(titles.indexOf('Add drawing as child')).toBeGreaterThan(titles.indexOf('Add sibling'));
    expect(titles.indexOf('Add drawing as sibling')).toBeGreaterThan(titles.indexOf('Add drawing as child'));
  });

  // A drawing node gets the same single "Edit" entry as any other node; what
  // that entry opens is decided by the node's content, not by the menu.
  it('offers one Edit entry regardless of what the node holds', () => {
    for (const text of ['Idea', '![[Idea drawing.svg]]', '![[Idea.excalidraw]]']) {
      const titles = menuTitlesFor(node(text), excalidrawApp(['Excalidraw/Idea.excalidraw.md']));
      expect(titles.filter((title) => title === 'Edit')).toHaveLength(1);
      expect(titles).not.toContain('Edit drawing');
      expect(titles).not.toContain('Edit Excalidraw drawing');
      expect(titles).not.toContain('Edit node');
    }
  });

  it('hides the Excalidraw actions while the plugin is not installed', () => {
    const titles = menuTitlesFor(node('Idea'));
    expect(titles).not.toContain('Add Excalidraw drawing as child');
    expect(titles).not.toContain('Add Excalidraw drawing as sibling');
  });

  it('offers the Excalidraw actions alongside the built-in ones', () => {
    const titles = menuTitlesFor(node('Idea'), excalidrawApp());
    expect(titles).toContain('Add drawing as child');
    expect(titles).toContain('Add Excalidraw drawing as child');
    expect(titles).toContain('Add Excalidraw drawing as sibling');
  });

  it('uses the explicit node supplied by a Pencil long-press even when WebKit retargets the event', () => {
    const targetNode = node('Pencil target');
    const ownerDocument = {} as Document;
    const event = {
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      clientX: 42,
      clientY: 64,
      target: {},
      composedPath: () => [{}],
    } as unknown as MouseEvent;
    const view = {
      wrapper: { classList: { contains: () => false }, focus: () => undefined, ownerDocument },
      isDirectNodeDragActive: () => false,
      selectedNodeLines: new Set<number>(),
      getNodeByLine: (line: number) => line === targetNode.line ? targetNode : null,
      selectNode: (line: number) => view.selectedNodeLines.add(line),
      getFlatNodes: () => [targetNode],
      setActiveNodeContextMenu: () => undefined,
    } as never;

    showNodeContextMenu(view, event, targetNode.line);

    const titles = lastMenu?.items.map((item) => item.title) ?? [];
    expect(titles).toContain('Add drawing as child');
    expect(titles).toContain('Add drawing as sibling');
    expect(lastMenu?.position).toEqual({ x: 42, y: 64 });
    expect(lastMenu?.positionDocument).toBe(ownerDocument);
  });
});
