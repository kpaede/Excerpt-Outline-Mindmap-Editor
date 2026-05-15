import type { MindmapView, LayoutOptions } from './mindmapView';

export class LayoutOptionsMenu {
  private menu: HTMLDivElement;
  private view: MindmapView;

  constructor(
    anchorEl: HTMLElement,
    view: MindmapView
  ) {
    this.view = view;
    this.menu = this.createMenu(anchorEl);
    document.body.appendChild(this.menu);
    this.setupEventListeners();
  }

  private createMenu(anchorEl: HTMLElement): HTMLDivElement {
    const menu = document.createElement('div');
    menu.className = 'layout-options-menu';
    
    // Position relative to anchor element
    const rect = anchorEl.getBoundingClientRect();
    Object.assign(menu.style, {
      position: 'absolute',
      left: `${rect.left + window.scrollX - 340}px`, // Position to the left of button
      top: `${rect.top + window.scrollY}px`,
      width: '320px',
      maxHeight: '70vh',
      overflowY: 'auto',
      zIndex: '1000',
      background: 'var(--background-primary)',
      border: '1px solid var(--background-modifier-border)',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      fontSize: 'var(--font-size-sm)',
    } as CSSStyleDeclaration);

    this.buildMenuContent(menu);
    return menu;
  }

  private buildMenuContent(container: HTMLElement): void {
    const title = container.createEl('h3', { text: 'Layout Options' });
    Object.assign(title.style, {
      margin: '0 0 16px 0',
      fontSize: 'var(--font-size-md)',
      fontWeight: '600',
    });

    const opts = this.view.layoutOptions;

    // Rank Direction
    this.addDropdownSetting(
      container,
      'Rank Direction',
      'Direction for rank nodes',
      {
        TB: 'TB (Top → Bottom)',
        BT: 'BT (Bottom → Top)',
        LR: 'LR (Left → Right)',
        RL: 'RL (Right → Left)',
      },
      opts.rankDir,
      async (value) => {
        opts.rankDir = value as 'TB' | 'BT' | 'LR' | 'RL';
        this.view.relayout();
        await this.view.updateLayoutOptions({ rankDir: value as 'TB' | 'BT' | 'LR' | 'RL' });
      }
    );

    // Alignment
    this.addDropdownSetting(
      container,
      'Alignment',
      'Alignment for rank nodes',
      {
        none: 'none',
        UL: 'UL (Up-Left)',
        UR: 'UR (Up-Right)',
        DL: 'DL (Down-Left)',
        DR: 'DR (Down-Right)',
      },
      opts.align ?? 'none',
      async (value) => {
        const alignValue = value === 'none' ? undefined : (value as 'UL' | 'UR' | 'DL' | 'DR');
        opts.align = alignValue;
        this.view.relayout();
        await this.view.updateLayoutOptions({ align: alignValue });
      }
    );

    // Ranker
    this.addDropdownSetting(
      container,
      'Ranker',
      'Algorithm for assigning ranks',
      {
        'network-simplex': 'network-simplex',
        'tight-tree': 'tight-tree',
        'longest-path': 'longest-path',
      },
      opts.ranker,
      async (value) => {
        const rankerValue = value as 'network-simplex' | 'tight-tree' | 'longest-path';
        opts.ranker = rankerValue;
        this.view.relayout();
        await this.view.updateLayoutOptions({ ranker: rankerValue });
      }
    );

    // Sliders - make all callbacks async and save to frontmatter
    this.addSliderSetting(container, 'Node Separation', 'Pixels between adjacent nodes horizontally', 0, 300, 10, () => opts.nodeSep, async (v) => { 
      opts.nodeSep = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ nodeSep: v }); 
    });
    this.addSliderSetting(container, 'Edge Separation', 'Pixels between edges horizontally', 0, 200, 5, () => opts.edgeSep, async (v) => { 
      opts.edgeSep = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ edgeSep: v }); 
    });
    this.addSliderSetting(container, 'Rank Separation', 'Pixels between ranks vertically', 0, 300, 10, () => opts.rankSep, async (v) => { 
      opts.rankSep = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ rankSep: v }); 
    });
    this.addSliderSetting(container, 'Margin X', 'Pixels of margin left/right', 0, 100, 5, () => opts.marginx, async (v) => { 
      opts.marginx = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ marginx: v }); 
    });
    this.addSliderSetting(container, 'Margin Y', 'Pixels of margin top/bottom', 0, 100, 5, () => opts.marginy, async (v) => { 
      opts.marginy = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ marginy: v }); 
    });
    this.addSliderSetting(container, 'Spacing Factor', 'Overall spacing multiplier', 0.5, 3.0, 0.1, () => opts.spacingFactor, async (v) => { 
      opts.spacingFactor = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ spacingFactor: v }); 
    });

    // Close button
    const closeBtn = container.createEl('button', { text: 'Close' });
    Object.assign(closeBtn.style, {
      marginTop: '16px',
      padding: '8px 16px',
      borderRadius: '4px',
      border: 'none',
      background: 'var(--interactive-accent)',
      color: 'var(--text-on-accent)',
      cursor: 'pointer',
      width: '100%',
      fontSize: 'var(--font-size-sm)',
    });
    closeBtn.addEventListener('click', () => this.close());
  }

  private addDropdownSetting(
    container: HTMLElement,
    name: string,
    desc: string,
    options: Record<string, string>,
    currentValue: string,
    onChange: (value: string) => Promise<void>
  ): void {
    const settingEl = container.createDiv({ cls: 'setting-item' });
    
    const infoEl = settingEl.createDiv({ cls: 'setting-item-info' });
    infoEl.createDiv({ text: name, cls: 'setting-item-name' });
    infoEl.createDiv({ text: desc, cls: 'setting-item-description' });
    
    const controlEl = settingEl.createDiv({ cls: 'setting-item-control' });
    const select = controlEl.createEl('select');
    
    Object.entries(options).forEach(([value, label]) => {
      const option = select.createEl('option', { text: label, value });
      if (value === currentValue) {
        option.selected = true;
      }
    });
    
    select.addEventListener('change', () => onChange(select.value));
  }

  private addSliderSetting(
    container: HTMLElement,
    name: string,
    desc: string,
    min: number,
    max: number,
    step: number,
    getValue: () => number,
    setValue: (v: number) => Promise<void>
  ): void {
    const settingEl = container.createDiv({ cls: 'setting-item' });
    
    const infoEl = settingEl.createDiv({ cls: 'setting-item-info' });
    infoEl.createDiv({ text: name, cls: 'setting-item-name' });
    infoEl.createDiv({ text: desc, cls: 'setting-item-description' });
    
    const controlEl = settingEl.createDiv({ cls: 'setting-item-control' });
    
    const slider = controlEl.createEl('input', { type: 'range' });
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(getValue());
    
    const valueEl = controlEl.createEl('span', { text: String(getValue()) });
    
    slider.addEventListener('input', async () => {
      const newVal = Number(slider.value);
      await setValue(newVal);
      valueEl.textContent = String(newVal);
    });
  }

  private setupEventListeners(): void {
    // Close menu when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      if (!this.menu.contains(e.target as Node)) {
        this.close();
      }
    };
    
    // Close menu on escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 10);
    
    // Store cleanup functions
    this.menu.addEventListener('remove', () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    });
  }

  private async saveToFrontmatter(options: Partial<LayoutOptions>): Promise<void> {
    if (this.view.file && this.view.frontmatterStorage) {
      try {
        await this.view.frontmatterStorage.updateLayoutOptions(this.view.file, options);
      } catch (error) {
        console.error('Failed to save layout options to frontmatter:', error);
      }
    }
  }

  public close(): void {
    if (this.menu.parentElement) {
      this.menu.remove();
    }
  }
}
