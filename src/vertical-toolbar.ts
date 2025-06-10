// src/vertical-toolbar.ts

import { ButtonComponent, setIcon, type IconName } from 'obsidian';
import type { MindmapView } from './mindmapView';
import { LayoutOptionsMenu } from './layout-options-menu';
import { NodeOptionsMenu, NodeOptions } from './node-options-menu';

export class VerticalToolbar {
  private container: HTMLDivElement;
  private view: MindmapView;
  private currentNodeMenu: NodeOptionsMenu | null = null;
  private currentLayoutMenu: LayoutOptionsMenu | null = null;

  private nodeOptions: NodeOptions = {
    nodeWidth: 300
  };

  constructor(view: MindmapView) {
    this.view = view;
    this.container = this.view.wrapper.createDiv({ cls: 'vertical-toolbar' });
    this.applyContainerStyles();
    this.buildButtons();
  }

  private applyContainerStyles() {
    const style = this.container.style;
    style.position = 'absolute';
    style.top = '10px';
    style.right = '10px';
    style.display = 'flex';
    style.flexDirection = 'column';
    style.gap = '4px';
    style.background = 'var(--background-secondary)';
    style.padding = '6px';
    style.borderRadius = '4px';
    style.zIndex = '999';
  }

  private buildButtons() {
    // Undo Button
    const undoBtn = this.container.createEl('button');
    undoBtn.addClass('clickable-icon');
    setIcon(undoBtn, 'undo');
    undoBtn.setAttribute('aria-label', 'Undo');
    undoBtn.onclick = () => {
      this.view.executeUndo();
    };

    // Redo Button  
    const redoBtn = this.container.createEl('button');
    redoBtn.addClass('clickable-icon');
    setIcon(redoBtn, 'redo');
    redoBtn.setAttribute('aria-label', 'Redo');
    redoBtn.onclick = () => {
      this.view.executeRedo();
    };

    // Store references for updating button states
    this.undoButton = undoBtn;
    this.redoButton = redoBtn;

    // Fit to View Button (styled wie Undo/Redo)
    const fitBtn = this.container.createEl('button');
    fitBtn.addClass('clickable-icon');
    setIcon(fitBtn, 'maximize-2');
    fitBtn.setAttribute('aria-label', 'Fit to View');
    fitBtn.onclick = () => {
      this.view.fitToView();
    };

    // Separator
    const separator = this.container.createDiv({ cls: 'toolbar-separator' });
    
    // Layout Options Button
    const layoutBtnComp = new ButtonComponent(this.container);
    layoutBtnComp.setIcon('layout-dashboard' as IconName);
    layoutBtnComp.setTooltip('Layout Options');
    const layoutButtonEl = this.container.querySelector('button:last-child') as HTMLElement;
    layoutBtnComp.onClick(() => {
      this.openLayoutOptions(layoutButtonEl);
    });

    // Node Options Button (now opens menu instead of modal)
    const nodeBtnComp = new ButtonComponent(this.container);
    nodeBtnComp.setIcon('square' as IconName);
    nodeBtnComp.setTooltip('Node Options');
    const nodeButtonEl = this.container.querySelector('button:last-child') as HTMLElement;
    nodeBtnComp.onClick(() => {
      this.openNodeOptions(nodeButtonEl);
    });
  }

  private openLayoutOptions(buttonEl: HTMLElement) {
    // Close existing menu if open
    if (this.currentLayoutMenu) {
      this.currentLayoutMenu.close();
      this.currentLayoutMenu = null;
    }

    // Create new menu
    this.currentLayoutMenu = new LayoutOptionsMenu(
      buttonEl,
      this.view
    );
  }

  private openNodeOptions(buttonEl: HTMLElement) {
    // Close existing menu if open
    if (this.currentNodeMenu) {
      this.currentNodeMenu.close();
      this.currentNodeMenu = null;
    }

    // Create new menu with view reference for frontmatter access
    this.currentNodeMenu = new NodeOptionsMenu(
      buttonEl,
      this.nodeOptions,
      (newOptions) => {
        this.nodeOptions = { ...newOptions };
        this.view.updateRenderingOptions(this.nodeOptions);
      },
      this.view // Pass view reference
    );
  }

  private undoButton?: HTMLElement;
  private redoButton?: HTMLElement;

  public updateUndoRedoButtons(): void {
    if (this.undoButton) {
      const canUndo = this.view.commandHistory.canUndo();
      (this.undoButton as HTMLButtonElement).disabled = !canUndo;
      this.undoButton.style.opacity = canUndo ? '1' : '0.5';
      this.undoButton.style.cursor = canUndo ? 'pointer' : 'not-allowed';
    }
    
    if (this.redoButton) {
      const canRedo = this.view.commandHistory.canRedo();
      (this.redoButton as HTMLButtonElement).disabled = !canRedo;
      this.redoButton.style.opacity = canRedo ? '1' : '0.5';
      this.redoButton.style.cursor = canRedo ? 'pointer' : 'not-allowed';
    }
  }

  private tryEditorUndo(): boolean {
    if (!this.view.file) return false;
    
    // Find corresponding markdown editor
    const markdownLeaves = this.view.app.workspace.getLeavesOfType('markdown');
    const matchingLeaf = markdownLeaves.find(leaf => {
      const view = leaf.view as any;
      return view.file?.path === this.view.file?.path;
    });
    
    if (matchingLeaf) {
      const editor = (matchingLeaf.view as any).editor;
      if (editor && typeof editor.undo === 'function') {
        editor.undo();
        return true;
      }
    }
    return false;
  }

  private tryEditorRedo(): boolean {
    if (!this.view.file) return false;
    
    // Find corresponding markdown editor
    const markdownLeaves = this.view.app.workspace.getLeavesOfType('markdown');
    const matchingLeaf = markdownLeaves.find(leaf => {
      const view = leaf.view as any;
      return view.file?.path === this.view.file?.path;
    });
    
    if (matchingLeaf) {
      const editor = (matchingLeaf.view as any).editor;
      if (editor && typeof editor.redo === 'function') {
        editor.redo();
        return true;
      }
    }
    return false;
  }

  public getNodeOptions(): NodeOptions {
    return { ...this.nodeOptions };
  }

  public setNodeOptions(options: NodeOptions) {
    this.nodeOptions = { ...options };
  }
}
