import { TFile } from 'obsidian';
import { FrontmatterStorage } from '../../storage/frontmatter-storage';
import { applyMobileMenuPosition } from './menu-positioning';

type ClickHandlerElement = HTMLElement & {
  _clickHandler?: (event: MouseEvent) => void;
};

interface NodeOptionsView {
  file?: TFile | null;
  frontmatterStorage?: FrontmatterStorage;
}

export interface NodeOptions {
  nodeWidth: number;
}

/**
 * NodeOptionsMenu creates a menu-style interface for node options
 * positioned next to the clicked button
 */
export class NodeOptionsMenu {
  private container: HTMLDivElement;
  private options: NodeOptions;
  private onSave: (options: NodeOptions) => void;
  private anchorEl: HTMLElement;
  private view?: NodeOptionsView;

  constructor(anchorEl: HTMLElement, options: NodeOptions, onSave: (options: NodeOptions) => void, view?: NodeOptionsView) {
    this.anchorEl = anchorEl;
    this.options = { ...options };
    this.onSave = onSave;
    this.view = view;
    this.createMenu();
  }

  private createMenu() {
    // Create menu container
    this.container = document.body.createDiv({ cls: 'node-options-menu' });
    
    // Position menu relative to anchor element
    this.positionMenu();
    
    // Build menu content
    this.buildContent();
    
    // Add click outside handler to close menu
    this.addClickOutsideHandler();
  }

  private positionMenu() {
    const rect = this.anchorEl.getBoundingClientRect();
    const menuWidth = 320;
    const left = Math.max(
      12,
      Math.min(rect.left + window.scrollX - menuWidth - 12, window.scrollX + window.innerWidth - menuWidth - 12)
    );
    
    // Position menu to the left of the button
    // Only set dynamic left/top variables; other layout handled via CSS class
    this.container.style.setProperty('--menu-left', `${left}px`);
    this.container.style.setProperty('--menu-top', `${rect.top + window.scrollY}px`);
    this.applyMobilePosition(left, menuWidth);
    applyMobileMenuPosition(this.container, menuWidth);
  }

  private applyMobilePosition(left: number, menuWidth: number): void {
    if (!document.body.classList.contains('mindmap-touch-toolbar')) return;

    const visualViewport = window.visualViewport;
    const viewportWidth = Math.round(visualViewport?.width || document.documentElement.clientWidth || window.innerWidth);
    const viewportHeight = Math.round(visualViewport?.height || document.documentElement.clientHeight || window.innerHeight);
    const top = 8;
    const maxWidth = Math.max(180, viewportWidth - 24);
    const width = Math.min(menuWidth, maxWidth);

    this.container.style.position = 'fixed';
    this.container.style.top = `${top}px`;
    this.container.style.right = 'auto';
    this.container.style.width = `${width}px`;
    this.container.style.maxWidth = `${maxWidth}px`;
    this.container.style.maxHeight = `${Math.max(160, viewportHeight - top - 12)}px`;
    this.container.style.overflowY = 'auto';

    if (document.body.classList.contains('mindmap-toolbar-side')) {
      this.container.style.left = `${Math.max(12, Math.min(left, viewportWidth - width - 12))}px`;
      this.container.style.transform = 'none';
    } else {
      this.container.style.left = '50%';
      this.container.style.transform = 'translateX(-50%)';
    }
  }

  private buildContent() {
    // Header
    this.container.createEl('h3', { text: 'Node Options' });

    // Node Width Slider
    this.addSliderSetting(
      'Node Width',
      'Width of nodes in pixels',
      100,
      600,
      10,
      () => this.options.nodeWidth,
      (v) => {
        this.options.nodeWidth = v;
        this.onSave(this.options);
      }
    );

    // Close button
    const closeBtn = this.container.createEl('button', { text: 'Close' });
    closeBtn.classList.add('fullwidth-button');
    closeBtn.addEventListener('click', () => this.close());
  }

  private addSliderSetting(
    label: string,
    desc: string,
    min: number,
    max: number,
    step: number,
    getValue: () => number,
    setValue: (v: number) => void
  ) {
    const settingDiv = this.container.createDiv({ cls: 'setting-item' });
    
    const labelDiv = settingDiv.createDiv({ cls: 'setting-item-info' });
    labelDiv.createDiv({ text: label, cls: 'setting-item-name' });
    labelDiv.createDiv({ text: desc, cls: 'setting-item-description' });
    
    const controlDiv = settingDiv.createDiv({ cls: 'setting-item-control' });
    
    const slider = controlDiv.createEl('input', { attr: { type: 'range' } }) as HTMLInputElement;
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(getValue());
    slider.classList.add('slider-margin-right');
    
    const valueEl = controlDiv.createEl('span', { text: `${getValue()}px` });
    
    slider.oninput = async () => {
      const newVal = Number(slider.value);
      setValue(newVal);
      valueEl.setText(`${newVal}px`);
      
      // Save to frontmatter
      if (this.view?.file && this.view?.frontmatterStorage) {
        try {
          await this.view.frontmatterStorage.updateNodeOptions(this.view.file, this.options);
        } catch (error) {
          console.error('Failed to save node options to frontmatter:', error);
        }
      }
    };
  }

  private addClickOutsideHandler() {
    const handler = (event: MouseEvent) => {
      if (!this.container.contains(event.target as Node) && 
          !this.anchorEl.contains(event.target as Node)) {
        this.close();
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', handler);
    }, 100);
    
    // Store handler for cleanup
    const container = this.container as ClickHandlerElement;
    container._clickHandler = handler;
  }

  public close() {
    if (this.container) {
      // Remove click handler
      const container = this.container as ClickHandlerElement;
      const handler = container._clickHandler;
      if (handler) {
        document.removeEventListener('click', handler);
      }
      
      this.container.remove();
    }
  }
}
