import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  MarkdownView,
  Menu,
} from 'obsidian';
import { registerMigrationCommands } from './ui/modals/outline-migration-modal';
import { OPEN_MINDMAP_LABEL, VIEW_TYPE_MINDMAP } from './constants';
import { ViewModeController } from './integration/view-mode-controller';
import { addToggleMindmapMenuItem } from './integration/context-menu';
import { MindmapView } from './view/mindmap-view';
import { renderMindmapEomeEmbed } from './embeds/eome-embed';
import { exportMindmapViewToCanvas } from './commands/export-canvas';
import { exportMindmapViewToPdf, exportMindmapViewToSvg } from './commands/export-vector';

export default class MindmapPlugin extends Plugin {
  private viewModes!: ViewModeController;

  async onload() {
    this.viewModes = new ViewModeController(this);
    registerMigrationCommands(this);
    this.registerView(
      VIEW_TYPE_MINDMAP,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this)
    );

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
      name: 'Canvas export of the current mindmap',
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
        (menu: Menu, abstractFile, _source, leaf) => {
          if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
            addToggleMindmapMenuItem(menu, this, abstractFile, leaf);
          }
        }
      )
    );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, _editor, info) => {
        const file = info instanceof MarkdownView ? info.file : null;
        if (!file || file.extension !== 'md') return;

        menu.addItem((item) => {
          item
            .setTitle(OPEN_MINDMAP_LABEL)
            .onClick(() => void this.openMindmapReplacingLeaf(file, info instanceof MarkdownView ? info.leaf : undefined));
        });
      })
    );

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          void this.updateMindmapViews(file);
        }
      })
    );

  }

  public async openMindmapReplacingLeaf(file: TFile, source?: WorkspaceLeaf): Promise<void> {
    await this.viewModes.openMindmap(file, source);
  }

  public async openMarkdownReplacingLeaf(file: TFile, source?: WorkspaceLeaf): Promise<void> {
    await this.viewModes.openEditor(file, source);
  }

  private getActiveMindmapView(): MindmapView | null {
    return this.app.workspace.getActiveViewOfType(MindmapView);
  }

  private async updateMindmapViews(file: TFile): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
    for (const leaf of leaves) {
      const view = leaf.view as MindmapView;
      if (view.file?.path === file.path) {
        // Enhanced check for active editing or drag operations
        const hasActiveTextarea = view.wrapper?.querySelector('.editing, textarea, .node-editor');
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
