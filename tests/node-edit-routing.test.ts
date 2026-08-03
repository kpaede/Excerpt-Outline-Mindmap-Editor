import { describe, expect, it } from 'vitest';
import { TFile } from './obsidian-mock';
import { editNodeContent } from '../src/drawing/drawing-actions';
import type { OutlineNode } from '../src/utils/outline';
import type { MindmapView } from '../src/view/mindmap-view';

function node(text: string): OutlineNode {
  return { text, indent: '', marker: '-', line: 7, endLine: 7, children: [], checkbox: 'none' };
}

function file(path: string): TFile {
  const created = new TFile();
  created.path = path;
  created.name = path.split('/').pop() ?? path;
  created.extension = path.split('.').pop() ?? '';
  return created;
}

interface Trace {
  editedLines: number[];
  openedPaths: string[];
  readPaths: string[];
}

function buildView(options: { excalidrawPaths?: string[]; links?: Record<string, TFile> } = {}): {
  view: MindmapView;
  trace: Trace;
} {
  const trace: Trace = { editedLines: [], openedPaths: [], readPaths: [] };
  const known = new Set(options.excalidrawPaths ?? []);

  const view = {
    file: file('Map.md'),
    enterEditModeForNodeByLine: async (line: number) => {
      trace.editedLines.push(line);
    },
    app: {
      plugins: {
        plugins: {
          'obsidian-excalidraw-plugin': {
            settings: {},
            isExcalidrawFile: (candidate: TFile) => known.has(candidate.path),
          },
        },
      },
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) => options.links?.[linkpath] ?? null,
      },
      vault: {
        read: async (target: TFile) => {
          trace.readPaths.push(target.path);
          return '<svg></svg>';
        },
      },
      workspace: {
        getLeaf: () => ({
          openFile: async (target: TFile) => {
            trace.openedPaths.push(target.path);
          },
        }),
        setActiveLeaf: () => undefined,
      },
    },
  } as unknown as MindmapView;

  return { view, trace };
}

describe('routing the Edit action by node content', () => {
  it('edits a plain node as text', async () => {
    const { view, trace } = buildView();
    await editNodeContent(view, node('Just an idea'));
    expect(trace.editedLines).toEqual([7]);
    expect(trace.openedPaths).toEqual([]);
  });

  it('opens the built-in editor for an SVG drawing node', async () => {
    const drawing = file('Attachments/Idea drawing.svg');
    const { view, trace } = buildView({ links: { 'Idea drawing.svg': drawing } });

    await editNodeContent(view, node('![[Idea drawing.svg]]'));

    expect(trace.readPaths).toEqual([drawing.path]);
    expect(trace.editedLines).toEqual([]);
  });

  it("opens Excalidraw's editor for an Excalidraw node", async () => {
    const drawing = file('Excalidraw/Idea.excalidraw.md');
    const { view, trace } = buildView({
      excalidrawPaths: [drawing.path],
      links: { 'Idea.excalidraw': drawing },
    });

    await editNodeContent(view, node('![[Idea.excalidraw]]'));

    expect(trace.openedPaths).toEqual([drawing.path]);
    expect(trace.editedLines).toEqual([]);
  });

  it('falls back to text editing for an embed that is not a drawing', async () => {
    const other = file('Notes/Some note.md');
    const { view, trace } = buildView({ links: { 'Some note': other } });

    await editNodeContent(view, node('![[Some note]]'));

    expect(trace.editedLines).toEqual([7]);
    expect(trace.openedPaths).toEqual([]);
  });
});
