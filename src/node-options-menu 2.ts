import { Setting } from 'obsidian';

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
  private view: any; // Add view reference for frontmatter access

  constructor(anchorEl: HTMLElement, options: NodeOptions, onSave: (options: NodeOptions) => void, view?: any) {
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
    
    // Position menu to the left of the button
    this.container.style.position = 'absolute';
    this.container.style.left = `${rect.left + window.scrollX - 328}px`;
    this.container.style.top = `${rect.top + window.scrollY}px`;
    this.container.style.width = '320px';
    this.container.style.maxHeight = '400px';
    this.container.style.overflowY = 'auto';
    this.container.style.zIndex = '1000';
  }

  private buildContent() {
    // Header
    const header = this.container.createEl('h3', { text: 'Node Options' });
    header.style.margin = '0 0 12px 0';
    header.style.fontSize = '14px';
    header.style.fontWeight = '600';

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
    closeBtn.style.marginTop = '12px';
    closeBtn.style.padding = '6px 12px';
    closeBtn.style.width = '100%';
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
    slider.style.marginRight = '8px';
    
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
    (this.container as any)._clickHandler = handler;
  }

  public close() {
    if (this.container) {
      // Remove click handler
      const handler = (this.container as any)._clickHandler;
      if (handler) {
        document.removeEventListener('click', handler);
      }
      
      this.container.remove();
    }
  }
}