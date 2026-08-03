import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  MarkdownView,
  Menu,
  View,
} from 'obsidian';
import { VIEW_TYPE_MINDMAP } from './constants';
import { addToggleMindmapMenuItem } from './integration/context-menu';
import { MindmapView } from './view/mindmap-view';
import { openInternalLink } from './utils/outline';
import { renderMindmapEomeEmbed } from './embeds/eome-embed';
import { exportMindmapViewToCanvas } from './commands/export-canvas';
import { exportMindmapViewToPdf, exportMindmapViewToSvg } from './commands/export-vector';
import { registerDrawingDiagnostics } from './commands/drawing-diagnostics';

declare const __EOME_BUILD__: string;

export default class MindmapPlugin extends Plugin {
  private suppressNextAutoOpen = new Set<string>();
  private autoOpenTimer: number | null = null;
  private autoOpenRunning = false;
  private autoOpenQueued = false;

  async onload() {
    // Readable as `EOME_BUILD` in the developer console. Silent by design:
    // its only job is to answer whether a device is running the bundle that
    // was just built, which matters here because this plugin folder is synced
    // rather than installed.
    (globalThis as { EOME_BUILD?: string }).EOME_BUILD =
      typeof __EOME_BUILD__ === 'string' ? __EOME_BUILD__ : 'dev';

    this.registerView(
      VIEW_TYPE_MINDMAP,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this)
    );

    registerDrawingDiagnostics(this);

    this.registerMarkdownCodeBlockProcessor('mindmap-eome', async (source, el, ctx) => {
      await renderMindmapEomeEmbed(this, source, el, ctx);
    });

    this.addCommand({
      id: 'copy-selection-as-markdown',
      name: 'Copy selection as Markdown',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view && view.selectedNodeLines.size > 0;
        if (checking) return canRun;
        if (view) void view.copySelectionAsMarkdown();
        return canRun;
      },
    });

    this.addCommand({
      id: 'export-current-mindmap-to-canvas',
      name: 'Export current mindmap to Canvas',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view?.file;
        if (checking) return canRun;
        if (view) void exportMindmapViewToCanvas(this, view);
        return canRun;
      },
    });

    this.addCommand({
      id: 'export-current-mindmap-to-svg',
      name: 'Export current mindmap to SVG',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view?.file;
        if (checking) return canRun;
        if (view) void exportMindmapViewToSvg(this, view);
        return canRun;
      },
    });

    this.addCommand({
      id: 'export-current-mindmap-to-pdf',
      name: 'Export current mindmap to PDF',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view?.file;
        if (checking) return canRun;
        if (view) void exportMindmapViewToPdf(this, view);
        return canRun;
      },
    });

    this.registerEvent(
      this.app.workspace.on(
        'file-menu',
        (menu: Menu, abstractFile) => {
          if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
            addToggleMindmapMenuItem(menu, this, abstractFile);
          }
        }
      )
    );

    this.registerEvent(
      (this.app.workspace.on as any)(
        'editor-menu',
        (menu: Menu, _editor: unknown, view: View) => {
          if (view.getViewType() === 'markdown') {
            const mdView = view as MarkdownView;
            const file = mdView.file;
            if (file && file.extension === 'md') {
              menu.addItem((item) => {
                item
                  .setTitle('Open as Mindmap')
                  .onClick(async () => {
                    await this.openMindmapReplacingLeaf(file);
                  });
              });
            }
          }
        }
      )
    );

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.updateMindmapViews(file);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file instanceof TFile) {
          this.scheduleOpenedFileMindmapAutoOpen(file);
        }
      })
    );
  }

  onunload() {
    // Do not detach leaves on unload; preserve user layout and leaf locations.
  }

  public async openMindmapReplacingLeaf(file: TFile): Promise<void> {
    const existingLeaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .find((leaf) => {
        const v = leaf.view as MindmapView;
        return v.file?.path === file.path;
      });
    if (existingLeaf) {
      this.revealLeaf(existingLeaf);
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const matchingLeaf = markdownLeaves.find((leaf) => {
      const mv = leaf.view as MarkdownView;
      return mv.file?.path === file.path;
    });

    let targetLeaf: WorkspaceLeaf;

    if (matchingLeaf) {
      targetLeaf = matchingLeaf;
    } else {
      targetLeaf = this.getWorkspaceLeaf(true);
    }

    await targetLeaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      state: {
        file: file.path,
      },
      active: true,
    });

    this.revealLeaf(targetLeaf);
  }

  public async openMarkdownReplacingLeaf(file: TFile): Promise<void> {
    this.suppressNextAutoOpen.add(file.path);
    window.setTimeout(() => this.suppressNextAutoOpen.delete(file.path), 1500);

    const existingLeaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .find((leaf) => {
        const v = leaf.view as MindmapView;
        return v.file?.path === file.path;
      });

    if (existingLeaf) {
      await existingLeaf.setViewState({
        type: 'markdown',
        state: {
          file: file.path,
        },
        active: true,
      });
      this.revealLeaf(existingLeaf);
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const matchingMdLeaf = markdownLeaves.find((leaf) => {
      const mv = leaf.view as MarkdownView;
      return mv.file?.path === file.path;
    });
    if (matchingMdLeaf) {
      this.revealLeaf(matchingMdLeaf);
    } else {
      await openInternalLink(this.app, file.path, '');
    }
  }

  private scheduleOpenedFileMindmapAutoOpen(file: TFile): void {
    if (file.extension !== 'md') return;

    if (this.autoOpenTimer !== null) {
      window.clearTimeout(this.autoOpenTimer);
      this.autoOpenTimer = null;
    }

    this.autoOpenTimer = window.setTimeout(() => {
      this.autoOpenTimer = null;
      void this.openMarkedOpenedFileAsMindmap(file);
    }, 80);
  }

  private async openMarkedOpenedFileAsMindmap(file: TFile, attempt: number = 0): Promise<void> {
    if (this.autoOpenRunning) {
      this.autoOpenQueued = true;
      return;
    }

    this.autoOpenRunning = true;
    try {
      const activeLeaf = this.app.workspace.activeLeaf;
      if (!activeLeaf || !this.leafHasMarkdownFileState(activeLeaf, file)) {
        if (attempt < 5) {
          window.setTimeout(() => {
            void this.openMarkedOpenedFileAsMindmap(file, attempt + 1);
          }, 80);
        }
        return;
      }
      if (this.suppressNextAutoOpen.has(file.path)) return;
      if (!(await this.hasMindmapFrontmatterMarker(file))) return;

      await activeLeaf.setViewState({
        type: VIEW_TYPE_MINDMAP,
        state: {
          file: file.path,
        },
        active: true,
      });
    } finally {
      this.autoOpenRunning = false;
      if (this.autoOpenQueued) {
        this.autoOpenQueued = false;
        window.setTimeout(() => {
          void this.openMarkedOpenedFileAsMindmap(file, attempt + 1);
        }, 100);
      }
    }
  }

  private leafHasMarkdownFileState(leaf: WorkspaceLeaf, file: TFile): boolean {
    const viewState = leaf.getViewState();
    if (viewState.type === 'markdown' && viewState.state?.file === file.path) {
      return true;
    }

    const view = leaf.view;
    return view instanceof MarkdownView && view.file?.path === file.path;
  }

  private async hasMindmapFrontmatterMarker(file: TFile): Promise<boolean> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, 'excerpt-outline-mindmap')) {
      return true;
    }

    const contents = await this.app.vault.cachedRead(file);
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return false;

    return /^excerpt-outline-mindmap(?:\s*:|$)/m.test(match[1]);
  }

  private getWorkspaceLeaf(split: boolean): WorkspaceLeaf {
    const ws: any = this.app.workspace;
    if (typeof ws.getLeaf === 'function') {
      return ws.getLeaf(split);
    }

    if (split && typeof ws.splitActiveLeaf === 'function') {
      return ws.splitActiveLeaf();
    }

    return ws.activeLeaf;
  }

  private revealLeaf(leaf: WorkspaceLeaf): void {
    const ws: any = this.app.workspace;
    if (typeof ws.revealLeaf === 'function') {
      ws.revealLeaf(leaf);
      return;
    }
    if (typeof ws.setActiveLeaf === 'function') {
      ws.setActiveLeaf(leaf);
    }
  }

  private getActiveMindmapView(): MindmapView | null {
    const activeView = this.app.workspace.activeLeaf?.view;
    if (activeView instanceof MindmapView) {
      return activeView;
    }
    return null;
  }

  private async updateMindmapViews(file: TFile): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
    for (const leaf of leaves) {
      const view = leaf.view as MindmapView;
      if (view.file?.path === file.path) {
        // Enhanced check for active editing or drag operations
        const hasActiveTextarea = view.wrapper?.querySelector('textarea');
        const hasActiveDrag = view.wrapper?.querySelector('.mm-src, .mm-tgt');
        
        if (hasActiveTextarea || hasActiveDrag) {
          continue; // Skip update during user interactions
        }
        
        // Use incremental update for external changes
        await view.reloadDataIncremental();
      }
    }
  }
}
