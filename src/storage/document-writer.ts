import { Notice, type App, type TFile, type MarkdownView } from 'obsidian';

export class DocumentConflictError extends Error {
  constructor() {
    super('The document changed externally. Your draft is retained. Reload the mindmap and retry.');
  }
}

function sameEditorText(first: string, second: string): boolean { return first.replace(/\r\n/g, '\n') === second.replace(/\r\n/g, '\n'); }

function updateCleanEditors(app: App, file: TFile, before: string, after: string): void {
  for (const view of editors(app, file)) {
    const editor = view.editor;
    const current = editor.getValue();
    // A user may have typed during the disk write. Never replace that draft.
    if (!sameEditorText(current, before) || sameEditorText(current, after)) continue;
    const next = after.replace(/\r\n/g, '\n');
    let start = 0;
    while (start < current.length && start < next.length && current[start] === next[start]) start++;
    let end = current.length;
    let nextEnd = next.length;
    while (end > start && nextEnd > start && current[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
    // One normal editor transaction retains native undo and mapped selections.
    editor.replaceRange(next.slice(start, nextEnd), editor.offsetToPos(start), editor.offsetToPos(end));
  }
}

const queues = new WeakMap<App, Map<string, Promise<unknown>>>();
function editors(app: App, file: TFile): MarkdownView[] {
  return app.workspace.getLeavesOfType('markdown')
    .map(leaf => leaf.view as MarkdownView).filter(view => view.file?.path === file.path);
}

export async function readDocument(app: App, file: TFile): Promise<string> {
  const disk = await app.vault.read(file);
  if (editors(app, file).some(view => !sameEditorText(view.editor.getValue(), disk))) {
    new Notice('The Markdown editor has unsaved changes. Save it before editing the mindmap.');
    throw new DocumentConflictError();
  }
  return disk;
}

/** Compare-and-swap against disk AND every open Markdown editor, serialized per file. */
export async function commitDocument(app: App, file: TFile, before: string, after: string): Promise<string> {
  let queue = queues.get(app);
  if (!queue) { queue = new Map(); queues.set(app, queue); }
  const prior = queue.get(file.path) ?? Promise.resolve();
  const operation = prior.catch(() => undefined).then(async () => {
    const verifyEditors = () => {
      if (editors(app, file).some(view => !sameEditorText(view.editor.getValue(), before))) throw new DocumentConflictError();
    };
    verifyEditors();
    await app.vault.process(file, current => {
      verifyEditors();
      if (current !== before) throw new DocumentConflictError();
      return after;
    });
    try { updateCleanEditors(app, file, before, after); }
    catch (error) {
      console.error('Document saved, but a Markdown view could not be refreshed:', error);
      new Notice('Document saved. Reopen the Markdown view to refresh it.');
    }
    return after;
  }).catch((error: unknown) => {
    new Notice(error instanceof Error ? error.message : 'Could not save the document.');
    throw error;
  });
  queue.set(file.path, operation);
  try { return await operation; }
  finally { if (queue.get(file.path) === operation) queue.delete(file.path); }
}
