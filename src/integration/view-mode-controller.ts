import { TFile, type App, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_MINDMAP } from '../constants';

function showsFile(leaf: WorkspaceLeaf, file: TFile, type?: string): boolean {
  const state = leaf.getViewState();
  return (!type || state.type === type) && state.state?.file === file.path;
}

/** Prefer the pane whose menu was opened, including in another window. */
export function findFileLeaf(app: App, file: TFile, source?: WorkspaceLeaf): WorkspaceLeaf | null {
  const active = app.workspace.getMostRecentLeaf();
  for (const leaf of [source, active]) {
    if (leaf && (showsFile(leaf, file, 'markdown') || showsFile(leaf, file, VIEW_TYPE_MINDMAP))) return leaf;
  }
  return [...app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP), ...app.workspace.getLeavesOfType('markdown')]
    .find(leaf => showsFile(leaf, file)) ?? null;
}

interface EditorChoice { file: TFile; switching: boolean }
interface AutoOpenRequest { leaf: WorkspaceLeaf; file: TFile; timer: number | null }

/** A choice belongs to one open document in one pane, never to a timeout or
 * every view of the same file. Pending reads belong to their original pane. */
export class ViewModeController {
  private readonly editors = new Map<WorkspaceLeaf, EditorChoice>();
  private readonly pending = new Map<WorkspaceLeaf, AutoOpenRequest>();
  private ready = false;
  private disposed = false;
  private readonly app: App;

  constructor(plugin: Plugin) {
    this.app = plugin.app;
    plugin.registerEvent(this.app.workspace.on('file-open', file => this.onFileOpen(file)));
    plugin.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      this.prune();
      const path = leaf?.getViewState().state?.file;
      const file = typeof path === 'string' ? this.app.vault.getAbstractFileByPath(path) : null;
      if (leaf && file instanceof TFile) this.schedule(leaf, file);
    }));
    plugin.registerEvent(this.app.workspace.on('layout-change', () => this.prune()));
    plugin.register(() => this.dispose());
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      // Restored editor panes already represent the user's saved view choice.
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const path = leaf.getViewState().state?.file;
        const file = typeof path === 'string' ? this.app.vault.getAbstractFileByPath(path) : null;
        if (file instanceof TFile) this.editors.set(leaf, { file, switching: false });
      }
      this.ready = true;
    });
  }

  public async openMindmap(file: TFile, source?: WorkspaceLeaf): Promise<void> {
    const leaf = findFileLeaf(this.app, file, source) ?? this.app.workspace.getLeaf(true);
    this.cancel(leaf);
    this.editors.delete(leaf);
    if (!showsFile(leaf, file, VIEW_TYPE_MINDMAP)) {
      await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  public async openEditor(file: TFile, source?: WorkspaceLeaf): Promise<void> {
    const leaf = findFileLeaf(this.app, file, source) ?? this.app.workspace.getLeaf(false);
    this.cancel(leaf);
    const choice = { file, switching: true };
    this.editors.set(leaf, choice);
    try {
      if (!showsFile(leaf, file, 'markdown')) {
        await leaf.setViewState({ type: 'markdown', state: { file: file.path }, active: true });
      }
      choice.switching = false;
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      if (this.editors.get(leaf) === choice) this.editors.delete(leaf);
      throw error;
    }
  }

  private onFileOpen(file: TFile | null): void {
    this.prune();
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf && file instanceof TFile) this.schedule(leaf, file);
  }

  private schedule(leaf: WorkspaceLeaf, file: TFile): void {
    if (!this.ready || this.disposed || file.extension !== 'md') return;
    // file-open also fires for focus changes and embeds, not just new notes.
    // active-leaf-change covers another pane opened on the same active file.
    if (!showsFile(leaf, file, 'markdown') || this.editors.has(leaf)) return;
    this.cancel(leaf);
    const request: AutoOpenRequest = { leaf, file, timer: null };
    this.pending.set(leaf, request);
    request.timer = window.setTimeout(() => {
      request.timer = null;
      void this.autoOpen(request).catch(error => console.error('Could not open mindmap:', error));
    }, 80);
  }

  private async autoOpen(request: AutoOpenRequest): Promise<void> {
    try {
      if (!this.isCurrent(request)) return;
      if (!(await this.hasMarker(request.file)) || !this.isCurrent(request)) return;
      await request.leaf.setViewState({
        type: VIEW_TYPE_MINDMAP, state: { file: request.file.path }, active: false,
      });
    } finally {
      if (this.pending.get(request.leaf) === request) this.pending.delete(request.leaf);
    }
  }

  private isCurrent(request: AutoOpenRequest): boolean {
    return !this.disposed && this.pending.get(request.leaf) === request &&
      !this.editors.has(request.leaf) && showsFile(request.leaf, request.file, 'markdown') &&
      this.app.workspace.getMostRecentLeaf() === request.leaf &&
      this.app.workspace.getLeavesOfType('markdown').includes(request.leaf);
  }

  private async hasMarker(file: TFile): Promise<boolean> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, 'excerpt-outline-mindmap')) return true;
    const contents = await this.app.vault.cachedRead(file);
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return !!match && /^excerpt-outline-mindmap(?:\s*:|$)/m.test(match[1]);
  }

  private prune(): void {
    const leaves = new Set([
      ...this.app.workspace.getLeavesOfType('markdown'),
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP),
    ]);
    for (const [leaf, choice] of this.editors) {
      if (!choice.switching && (!leaves.has(leaf) || !showsFile(leaf, choice.file, 'markdown'))) {
        this.editors.delete(leaf);
      }
    }
    for (const [leaf, request] of this.pending) {
      if (!leaves.has(leaf) || !showsFile(leaf, request.file, 'markdown')) this.cancel(leaf);
    }
  }

  private cancel(leaf: WorkspaceLeaf): void {
    const request = this.pending.get(leaf);
    if (request?.timer !== null && request?.timer !== undefined) window.clearTimeout(request.timer);
    this.pending.delete(leaf);
  }

  private dispose(): void {
    this.disposed = true;
    for (const leaf of this.pending.keys()) this.cancel(leaf);
    this.editors.clear();
  }
}
