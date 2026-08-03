import { afterEach, describe, expect, it } from 'vitest';
import { TFile } from './obsidian-mock';
import type { App } from 'obsidian';
import {
  createExcalidrawDrawing,
  hasUnrenderedExcalidrawEmbed,
  isExcalidrawAvailable,
  resolveExcalidrawEmbed,
} from '../src/drawing/excalidraw-integration';

const PLUGIN_ID = 'obsidian-excalidraw-plugin';

interface CreateCall {
  filename?: string;
  foldername?: string;
  silent?: boolean;
}

function file(path: string): TFile {
  const created = new TFile();
  created.path = path;
  created.name = path.split('/').pop() ?? path;
  created.extension = path.split('.').pop() ?? '';
  return created;
}

function buildApp(options: {
  settings?: Record<string, unknown>;
  excalidrawPaths?: string[];
  files?: Record<string, TFile>;
  links?: Record<string, TFile>;
  createdPath?: string;
  calls?: CreateCall[];
  sharedEaCalls?: CreateCall[];
  omitPlugin?: boolean;
  brokenPlugin?: boolean;
} = {}): App {
  const excalidrawPaths = new Set(options.excalidrawPaths ?? []);
  const plugin = options.brokenPlugin
    ? {}
    : {
        settings: options.settings ?? {},
        isExcalidrawFile: (candidate: TFile) => excalidrawPaths.has(candidate.path),
        ea: {
          create: async (params: CreateCall) => {
            options.sharedEaCalls?.push(params);
            return options.createdPath ?? 'Excalidraw/Untitled.excalidraw.md';
          },
        },
      };

  return {
    plugins: { plugins: options.omitPlugin ? {} : { [PLUGIN_ID]: plugin } },
    vault: {
      getAbstractFileByPath: (path: string) => options.files?.[path] ?? null,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) => options.links?.[linkpath] ?? null,
    },
    workspace: {},
  } as unknown as App;
}

function installAutomate(calls: CreateCall[], createdPath: string): void {
  (globalThis as { ExcalidrawAutomate?: unknown }).ExcalidrawAutomate = {
    getAPI: () => ({
      create: async (params: CreateCall) => {
        calls.push(params);
        return createdPath;
      },
    }),
  };
}

afterEach(() => {
  delete (globalThis as { ExcalidrawAutomate?: unknown }).ExcalidrawAutomate;
});

describe('Excalidraw availability', () => {
  it('reports the plugin as unavailable when it is not installed', () => {
    expect(isExcalidrawAvailable(buildApp({ omitPlugin: true }))).toBe(false);
  });

  it('reports the plugin as unavailable when it does not expose isExcalidrawFile', () => {
    expect(isExcalidrawAvailable(buildApp({ brokenPlugin: true }))).toBe(false);
  });

  it('reports the plugin as available once it is installed', () => {
    expect(isExcalidrawAvailable(buildApp())).toBe(true);
  });
});

describe('creating an Excalidraw drawing', () => {
  it("follows Excalidraw's own extension and folder settings", async () => {
    const calls: CreateCall[] = [];
    const created = file('Excalidraw/Idea drawing.excalidraw.md');
    installAutomate(calls, created.path);
    const app = buildApp({
      settings: { folder: 'Excalidraw', useExcalidrawExtension: true },
      files: { [created.path]: created },
    });

    await expect(createExcalidrawDrawing(app, 'Idea drawing')).resolves.toBe(created);
    expect(calls).toEqual([
      { filename: 'Idea drawing.excalidraw.md', foldername: 'Excalidraw', silent: true },
    ]);
  });

  it('creates a legacy standalone file in compatibility mode', async () => {
    const calls: CreateCall[] = [];
    const created = file('Sketches/Idea drawing.excalidraw');
    installAutomate(calls, created.path);
    const app = buildApp({
      settings: { folder: 'Sketches', compatibilityMode: true },
      files: { [created.path]: created },
    });

    await createExcalidrawDrawing(app, 'Idea drawing');
    expect(calls[0].filename).toBe('Idea drawing.excalidraw');
  });

  it('creates a plain Markdown file when the .excalidraw marker is disabled', async () => {
    const calls: CreateCall[] = [];
    const created = file('Excalidraw/Idea drawing.md');
    installAutomate(calls, created.path);
    const app = buildApp({
      settings: { folder: 'Excalidraw', useExcalidrawExtension: false },
      files: { [created.path]: created },
    });

    await createExcalidrawDrawing(app, 'Idea drawing');
    expect(calls[0].filename).toBe('Idea drawing.md');
  });

  it('prefers a fresh automate instance over the shared one', async () => {
    const freshCalls: CreateCall[] = [];
    const sharedEaCalls: CreateCall[] = [];
    const created = file('Excalidraw/Idea.excalidraw.md');
    installAutomate(freshCalls, created.path);
    const app = buildApp({ files: { [created.path]: created }, sharedEaCalls });

    await createExcalidrawDrawing(app, 'Idea');
    expect(freshCalls).toHaveLength(1);
    expect(sharedEaCalls).toHaveLength(0);
  });

  it('falls back to the shared instance when no factory is exposed', async () => {
    const sharedEaCalls: CreateCall[] = [];
    const created = file('Excalidraw/Idea.excalidraw.md');
    const app = buildApp({
      files: { [created.path]: created },
      sharedEaCalls,
      createdPath: created.path,
    });

    await createExcalidrawDrawing(app, 'Idea');
    expect(sharedEaCalls).toHaveLength(1);
  });

  it('fails loudly when the reported path does not exist', async () => {
    installAutomate([], 'Excalidraw/Missing.excalidraw.md');
    await expect(createExcalidrawDrawing(buildApp(), 'Missing')).rejects.toThrow(/no such file/);
  });

  it('refuses to create anything without the plugin', async () => {
    await expect(createExcalidrawDrawing(buildApp({ omitPlugin: true }), 'Idea'))
      .rejects.toThrow(/not available/);
  });
});

describe('resolving an embedded Excalidraw drawing', () => {
  const drawing = file('Excalidraw/Idea.excalidraw.md');
  const image = file('Attachments/Idea drawing.svg');

  it('resolves an embed that points at a drawing', () => {
    const app = buildApp({
      excalidrawPaths: [drawing.path],
      links: { 'Idea.excalidraw': drawing },
    });
    expect(resolveExcalidrawEmbed(app, 'Note ![[Idea.excalidraw]]', 'Map.md')).toBe(drawing);
  });

  it('resolves a drawing that is an ordinary Markdown file', () => {
    const plainDrawing = file('Excalidraw/Idea.md');
    const app = buildApp({
      excalidrawPaths: [plainDrawing.path],
      links: { Idea: plainDrawing },
    });
    expect(resolveExcalidrawEmbed(app, '![[Idea]]', 'Map.md')).toBe(plainDrawing);
  });

  it('ignores an embed whose target is not a drawing', () => {
    const app = buildApp({ links: { 'Idea drawing.svg': image } });
    expect(resolveExcalidrawEmbed(app, '![[Idea drawing.svg]]', 'Map.md')).toBeNull();
  });

  it('ignores a node without an embed', () => {
    expect(resolveExcalidrawEmbed(buildApp(), 'Just text', 'Map.md')).toBeNull();
  });

  it('strips a subpath before resolving', () => {
    const app = buildApp({
      excalidrawPaths: [drawing.path],
      links: { 'Idea.excalidraw': drawing },
    });
    expect(resolveExcalidrawEmbed(app, '![[Idea.excalidraw#^group=abc]]', 'Map.md')).toBe(drawing);
  });
});

describe('detecting embeds Excalidraw has not rendered yet', () => {
  const drawing = file('Excalidraw/Idea.excalidraw.md');

  function container(embeds: Array<string | null>): HTMLElement {
    return {
      querySelectorAll: () => embeds.map((src) => ({ getAttribute: () => src })),
    } as unknown as HTMLElement;
  }

  const app = buildApp({
    excalidrawPaths: [drawing.path],
    links: { 'Idea.excalidraw': drawing },
  });

  it('treats a surviving placeholder as unrendered', () => {
    expect(hasUnrenderedExcalidrawEmbed(app, container(['Idea.excalidraw']), 'Map.md')).toBe(true);
  });

  it('reports nothing pending once the placeholder is replaced', () => {
    expect(hasUnrenderedExcalidrawEmbed(app, container([]), 'Map.md')).toBe(false);
  });

  it('ignores embeds pointing at other files', () => {
    expect(hasUnrenderedExcalidrawEmbed(app, container(['Other note']), 'Map.md')).toBe(false);
  });

  // Excalidraw deliberately renders some subpath embeds as text, so waiting
  // for them to disappear would stall every measurement until the timeout.
  it('ignores subpath embeds', () => {
    expect(hasUnrenderedExcalidrawEmbed(app, container(['Idea.excalidraw#^abc']), 'Map.md')).toBe(false);
  });

  it('reports nothing pending without the plugin', () => {
    const withoutPlugin = buildApp({ omitPlugin: true });
    expect(hasUnrenderedExcalidrawEmbed(withoutPlugin, container(['Idea.excalidraw']), 'Map.md')).toBe(false);
  });
});
