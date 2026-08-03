import { App, TFile } from 'obsidian';

/**
 * Tracks which on-disk version of each embedded attachment the mindmap is
 * currently showing.
 *
 * Two separate problems need this, and both produced the same symptom: an
 * edited drawing kept showing its previous state until the whole app was
 * reloaded.
 *
 * The first is caching. Obsidian's resource URL for an attachment is not
 * reliably distinct after the file changes, so re-rendering a node's Markdown
 * can produce an <img> that resolves to the bitmap the webview already holds.
 * Patching the src once after a redraw does not survive, because the overlay
 * rebuild that follows discards those elements and renders the embed again;
 * the version has to be reapplied on every render instead.
 *
 * The second is timing. A drawing edited in another tab is written by whoever
 * owns that editor - Excalidraw saves on blur and on its own autosave
 * interval - so the write can land long after the user considers the drawing
 * saved, or before this view was listening. Comparing the mtime that was
 * rendered against the mtime on disk answers "is what I am showing current?"
 * without depending on catching an event at the right moment.
 */
export class AttachmentVersions {
  private readonly renderedMtimes = new Map<string, number>();

  /**
   * Records that this file's current on-disk version is the one to render.
   * Returns false when that version was already the one being shown, which
   * lets callers skip a redraw that would change nothing.
   */
  markCurrent(file: TFile): boolean {
    const rendered = this.renderedMtimes.get(file.path);
    const mtime = file.stat?.mtime ?? Date.now();
    if (rendered !== undefined && rendered >= mtime) return false;
    this.renderedMtimes.set(file.path, mtime);
    return true;
  }

  /**
   * Adopts the current version as the rendered one without reporting a
   * change, establishing the baseline for later staleness checks.
   */
  adopt(file: TFile): void {
    if (this.renderedMtimes.has(file.path)) return;
    this.renderedMtimes.set(file.path, file.stat?.mtime ?? 0);
  }

  isStale(file: TFile): boolean {
    const rendered = this.renderedMtimes.get(file.path);
    return rendered !== undefined && rendered < (file.stat?.mtime ?? 0);
  }

  forget(path: string): void {
    this.renderedMtimes.delete(path);
  }

  clear(): void {
    this.renderedMtimes.clear();
  }

  /**
   * Stamps the tracked version onto every embedded image in a freshly
   * rendered container. Called after each render - including the measurement
   * pass - so the size the node is laid out for matches the image it shows.
   */
  applyTo(container: HTMLElement, app: App): void {
    if (this.renderedMtimes.size === 0) return;

    const versionByResource = new Map<string, number>();
    for (const [path, mtime] of this.renderedMtimes) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      versionByResource.set(app.vault.getResourcePath(file).split('?')[0], mtime);
    }
    if (versionByResource.size === 0) return;

    container.querySelectorAll('img').forEach((image) => {
      const base = image.src.split('?')[0];
      const version = versionByResource.get(base);
      if (version === undefined) return;
      const stamped = `${base}?v=${version}`;
      if (image.src !== stamped) image.src = stamped;
    });
  }
}

/**
 * Resolves the attachments a mindmap embeds, using the metadata cache's
 * resolved-link index rather than re-parsing the outline.
 */
export function embeddedAttachments(app: App, sourcePath: string): TFile[] {
  const links = app.metadataCache.resolvedLinks?.[sourcePath];
  if (!links) return [];

  const files: TFile[] = [];
  for (const path of Object.keys(links)) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) files.push(file);
  }
  return files;
}
