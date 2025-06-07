import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  TFolder,
  MarkdownView,
  Menu,
} from 'obsidian';
import { VIEW_TYPE_MINDMAP } from './constants';
import { addToggleMindmapMenuItem } from './context-menu';
import { MindmapView } from './mindmapView';

export default class MindmapPlugin extends Plugin {
  async onload() {
    this.registerView(
      VIEW_TYPE_MINDMAP,  
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this)
    );

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
      this.app.workspace.on(
        'editor-menu',
        (menu: Menu, _editor, view: any) => {
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
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDMAP);
  }

  public async openMindmapReplacingLeaf(file: TFile): Promise<void> {
    const existingLeaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .find((leaf) => {
        const v = leaf.view as MindmapView;
        return v.file?.path === file.path;
      });
    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
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
      targetLeaf = this.app.workspace.getLeaf(true);
    }

    await targetLeaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      state: {
        file: file.path,
      },
      active: true,
    });

    this.app.workspace.revealLeaf(targetLeaf);
  }

  public async openMarkdownReplacingLeaf(file: TFile): Promise<void> {
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
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const matchingMdLeaf = markdownLeaves.find((leaf) => {
      const mv = leaf.view as MarkdownView;
      return mv.file?.path === file.path;
    });
    if (matchingMdLeaf) {
      this.app.workspace.revealLeaf(matchingMdLeaf);
    } else {
      await this.app.workspace.openLinkText(file.path, '', false);
    }
  }

  private async updateMindmapViews(file: TFile): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
    for (const leaf of leaves) {
      const view = leaf.view as MindmapView;
      if (view.file?.path === file.path) {
        // Check if user is actively editing - if so, skip external updates
        const hasActiveTextarea = view.wrapper?.querySelector('textarea');
        if (hasActiveTextarea) {
          continue; // Skip update while user is editing
        }
        
        // Use incremental update for external changes too
        await view.reloadDataIncremental();
      }
    }
  }
}
