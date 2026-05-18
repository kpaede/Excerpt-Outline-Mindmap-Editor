// src/vertical-toolbar.ts

import { setIcon } from 'obsidian';
import type { MindmapView } from './mindmapView';
import { LayoutOptionsMenu } from './layout-options-menu';
import { NodeOptionsMenu, NodeOptions } from './node-options-menu';
import { GeneralSettingsMenu } from './general-settings-menu';
import { ZoomOptionsMenu } from './zoom-options-menu';

export class VerticalToolbar {
  private container: HTMLDivElement;
  private view: MindmapView;
  private currentNodeMenu: NodeOptionsMenu | null = null;
  private currentLayoutMenu: LayoutOptionsMenu | null = null;
  private currentGeneralMenu: GeneralSettingsMenu | null = null;
  private currentZoomMenu: ZoomOptionsMenu | null = null;
  private zoomIndicator?: HTMLButtonElement;

  private nodeOptions: NodeOptions = {
    nodeWidth: 300
  };

  constructor(view: MindmapView) {
    this.view = view;
    this.container = this.view.wrapper.createDiv({ cls: 'vertical-toolbar' });
    // Styles are provided via CSS in styles.css
    this.buildButtons();
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

    this.zoomIndicator = this.container.createEl('button', { cls: 'mindmap-zoom-indicator' });
    this.zoomIndicator.setAttribute('type', 'button');
    this.zoomIndicator.addEventListener('click', () => this.openZoomOptions(this.zoomIndicator!));
    this.setZoomFactor(this.view.layoutOptions.zoomFactor ?? 1);

    // Separator
    this.container.createDiv({ cls: 'toolbar-separator' });
    
    // Layout Options Button
    const layoutBtn = this.container.createEl('button');
    layoutBtn.addClass('clickable-icon');
    setIcon(layoutBtn, 'layout-dashboard');
    layoutBtn.setAttribute('aria-label', 'Layout Options');
    layoutBtn.onclick = () => {
      this.openLayoutOptions(layoutBtn);
    };

    // Node Options Button
    const nodeBtn = this.container.createEl('button');
    nodeBtn.addClass('clickable-icon');
    setIcon(nodeBtn, 'square');
    nodeBtn.setAttribute('aria-label', 'Node Options');
    nodeBtn.onclick = () => {
      this.openNodeOptions(nodeBtn);
    };

    // General Settings Button
    const generalBtn = this.container.createEl('button');
    generalBtn.addClass('clickable-icon');
    setIcon(generalBtn, 'settings');
    generalBtn.setAttribute('aria-label', 'General Settings');
    generalBtn.onclick = () => {
      this.openGeneralSettings(generalBtn);
    };
  }

  private openGeneralSettings(buttonEl: HTMLElement) {
    this.closeZoomOptions();

    if (this.currentGeneralMenu) {
      this.currentGeneralMenu.close();
      this.currentGeneralMenu = null;
    }

    this.currentGeneralMenu = new GeneralSettingsMenu(
      buttonEl,
      this.view.generalSettings,
      (newSettings) => {
        this.view.generalSettings = { ...newSettings };
        // Apply setting changes immediately if necessary
      },
      this.view
    );
  }

  private openLayoutOptions(buttonEl: HTMLElement) {
    this.closeZoomOptions();

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
    this.closeZoomOptions();

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

  private openZoomOptions(buttonEl: HTMLElement) {
    if (this.currentZoomMenu) {
      if (this.currentZoomMenu.isOpen()) {
        this.currentZoomMenu.close();
        this.currentZoomMenu = null;
        return;
      }
      this.currentZoomMenu = null;
    }

    if (this.currentLayoutMenu) {
      this.currentLayoutMenu.close();
      this.currentLayoutMenu = null;
    }
    if (this.currentNodeMenu) {
      this.currentNodeMenu.close();
      this.currentNodeMenu = null;
    }
    if (this.currentGeneralMenu) {
      this.currentGeneralMenu.close();
      this.currentGeneralMenu = null;
    }

    this.currentZoomMenu = new ZoomOptionsMenu(buttonEl, this.view);
  }

  private closeZoomOptions(): void {
    if (!this.currentZoomMenu) return;

    this.currentZoomMenu.close();
    this.currentZoomMenu = null;
  }

  private undoButton?: HTMLElement;
  private redoButton?: HTMLElement;

  public setZoomFactor(zoomFactor: number): void {
    if (!this.zoomIndicator) return;

    this.zoomIndicator.textContent = `${Math.round(zoomFactor * 100)}%`;
    this.zoomIndicator.setAttribute('aria-label', `Zoom ${Math.round(zoomFactor * 100)}%`);
  }

  public updateUndoRedoButtons(): void {
    if (this.undoButton) {
      const canUndo = this.view.commandHistory.canUndo();
      (this.undoButton as HTMLButtonElement).disabled = !canUndo;
      this.undoButton.classList.toggle('disabled', !canUndo);
    }
    
    if (this.redoButton) {
      const canRedo = this.view.commandHistory.canRedo();
      (this.redoButton as HTMLButtonElement).disabled = !canRedo;
      this.redoButton.classList.toggle('disabled', !canRedo);
    }
  }

  public getNodeOptions(): NodeOptions {
    return { ...this.nodeOptions };
  }

  public setNodeOptions(options: NodeOptions) {
    this.nodeOptions = { ...options };
  }
}
