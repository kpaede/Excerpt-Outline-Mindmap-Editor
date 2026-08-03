import { describe, expect, it } from 'vitest';
import { TFile } from './obsidian-mock';
import type { App } from 'obsidian';
import { AttachmentVersions, embeddedAttachments } from '../src/view/attachment-versions';

function file(path: string, mtime: number): TFile {
  const created = new TFile();
  created.path = path;
  created.name = path.split('/').pop() ?? path;
  created.extension = path.split('.').pop() ?? '';
  (created as TFile & { stat: { mtime: number } }).stat = { mtime };
  return created;
}

function buildApp(files: TFile[], links?: Record<string, Record<string, number>>): App {
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  return {
    vault: {
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
      getResourcePath: (target: TFile) => `app://vault/${target.path}?0`,
    },
    metadataCache: { resolvedLinks: links ?? {} },
  } as unknown as App;
}

function container(sources: string[]): HTMLElement {
  const images = sources.map((src) => ({ src }));
  return {
    querySelectorAll: () => images,
  } as unknown as HTMLElement;
}

describe('tracking the rendered version of an attachment', () => {
  it('reports the first sighting of a file as a change', () => {
    const versions = new AttachmentVersions();
    expect(versions.markCurrent(file('Drawing.svg', 100))).toBe(true);
  });

  it('does not report a redraw for a version already on screen', () => {
    const versions = new AttachmentVersions();
    const drawing = file('Drawing.svg', 100);
    versions.markCurrent(drawing);
    expect(versions.markCurrent(drawing)).toBe(false);
  });

  it('reports a newer version as a change', () => {
    const versions = new AttachmentVersions();
    versions.markCurrent(file('Drawing.svg', 100));
    expect(versions.markCurrent(file('Drawing.svg', 200))).toBe(true);
  });

  // The point of the mtime comparison: a write that landed while this view was
  // not listening is still caught the next time the view is looked at.
  it('detects a file that changed behind the view', () => {
    const versions = new AttachmentVersions();
    versions.markCurrent(file('Drawing.svg', 100));
    expect(versions.isStale(file('Drawing.svg', 400))).toBe(true);
  });

  it('does not consider an unchanged file stale', () => {
    const versions = new AttachmentVersions();
    versions.markCurrent(file('Drawing.svg', 100));
    expect(versions.isStale(file('Drawing.svg', 100))).toBe(false);
  });

  it('never reports an untracked file as stale', () => {
    expect(new AttachmentVersions().isStale(file('Drawing.svg', 100))).toBe(false);
  });

  it('adopts a baseline without claiming a change', () => {
    const versions = new AttachmentVersions();
    const drawing = file('Drawing.svg', 100);
    versions.adopt(drawing);
    expect(versions.isStale(drawing)).toBe(false);
    expect(versions.isStale(file('Drawing.svg', 300))).toBe(true);
  });

  it('keeps the newer version when adopting after a change', () => {
    const versions = new AttachmentVersions();
    versions.markCurrent(file('Drawing.svg', 500));
    versions.adopt(file('Drawing.svg', 100));
    expect(versions.isStale(file('Drawing.svg', 400))).toBe(false);
  });
});

describe('stamping the version onto rendered embeds', () => {
  const drawing = file('Attachments/Drawing.svg', 4242);

  it('rewrites the image for a tracked attachment', () => {
    const versions = new AttachmentVersions();
    versions.markCurrent(drawing);
    const target = container(['app://vault/Attachments/Drawing.svg?0']);

    versions.applyTo(target, buildApp([drawing]));

    expect(target.querySelectorAll('img')[0].src).toBe('app://vault/Attachments/Drawing.svg?v=4242');
  });

  it('leaves unrelated images alone', () => {
    const versions = new AttachmentVersions();
    versions.markCurrent(drawing);
    const target = container(['app://vault/Attachments/Photo.png?0']);

    versions.applyTo(target, buildApp([drawing]));

    expect(target.querySelectorAll('img')[0].src).toBe('app://vault/Attachments/Photo.png?0');
  });

  it('does nothing while no attachment is tracked', () => {
    const target = container(['app://vault/Attachments/Drawing.svg?0']);
    new AttachmentVersions().applyTo(target, buildApp([drawing]));
    expect(target.querySelectorAll('img')[0].src).toBe('app://vault/Attachments/Drawing.svg?0');
  });
});

describe('resolving the attachments a mindmap embeds', () => {
  it('returns the resolved link targets as files', () => {
    const drawing = file('Excalidraw/Idea.excalidraw.md', 1);
    const app = buildApp([drawing], { 'Map.md': { 'Excalidraw/Idea.excalidraw.md': 1 } });
    expect(embeddedAttachments(app, 'Map.md')).toEqual([drawing]);
  });

  it('returns nothing for a file with no resolved links', () => {
    expect(embeddedAttachments(buildApp([]), 'Map.md')).toEqual([]);
  });
});
