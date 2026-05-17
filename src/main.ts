import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  TFolder,
  MarkdownView,
  Menu,
  Notice,
  View,
} from 'obsidian';
import { VIEW_TYPE_MINDMAP } from './constants';
import { addToggleMindmapMenuItem } from './context-menu';
import { MindmapView } from './mindmapView';
import { openInternalLink } from './util';
import { renderMindmapEomeEmbed } from './embed';

export default class MindmapPlugin extends Plugin {
  private suppressAutoMindmapOpen = new Set<string>();

  async onload() {
    this.registerView(
      VIEW_TYPE_MINDMAP,  
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this)
    );

    this.registerMarkdownCodeBlockProcessor('mindmap-eome', async (source, el, ctx) => {
      await renderMindmapEomeEmbed(this, source, el, ctx);
    });

    this.registerEvent(
      this.app.workspace.on(
        'file-menu',
        (menu: Menu, abstractFile, _source, leaf) => {
          if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
            addToggleMindmapMenuItem(menu, this, abstractFile, leaf);
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
      this.app.vault.on('modify', (file: TFile) => {
        if (file.extension === 'md') {
          this.updateMindmapViews(file);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file instanceof TFile) {
          void this.openAsMindmapWhenMarked(file);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView && view.file) {
          void this.openAsMindmapWhenMarked(view.file);
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file?.path === file.path) {
          void this.openAsMindmapWhenMarked(file);
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
    this.suppressAutoMindmapOpen.add(file.path);
    window.setTimeout(() => this.suppressAutoMindmapOpen.delete(file.path), 1500);

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

  private async openAsMindmapWhenMarked(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    if (this.suppressAutoMindmapOpen.has(file.path)) return;

    const activeLeaf = this.app.workspace.activeLeaf;
    const activeView = activeLeaf?.view;
    if (!(activeView instanceof MarkdownView) || activeView.file?.path !== file.path) return;

    if (!(await this.hasMindmapFrontmatter(file))) return;

    await this.openMindmapReplacingLeaf(file);
  }

  private async hasMindmapFrontmatter(file: TFile): Promise<boolean> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, 'excerpt-outline-mindmap')) {
      return true;
    }

    const contents = await this.app.vault.cachedRead(file);
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return false;

    return /^excerpt-outline-mindmap(?:\s*:|$)/m.test(match[1]);
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
