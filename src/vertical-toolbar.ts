// src/vertical-toolbar.ts

import { ButtonComponent, type IconName } from 'obsidian';
import type { MindmapView } from './view';
import { LayoutOptionsModal } from './layout-options-modal';

export class VerticalToolbar {
  private container: HTMLDivElement;
  private view: MindmapView;

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
    // Layout Options Button
    const layoutBtnComp = new ButtonComponent(this.container);
    layoutBtnComp.setIcon('layout-dashboard' as IconName);
    layoutBtnComp.setTooltip('Layout Options');
    const layoutButtonEl = this.container.querySelector('button:last-child') as HTMLElement;
    layoutBtnComp.onClick(() => {
      new LayoutOptionsModal(this.view.app, this.view, layoutButtonEl).open();
    });

    // Fit to View Button
    const fitBtnComp = new ButtonComponent(this.container);
    fitBtnComp.setIcon('maximize-2' as IconName);
    fitBtnComp.setTooltip('Fit to View');
    fitBtnComp.onClick(() => {
      this.view.fitToView();
    });
  }
}
