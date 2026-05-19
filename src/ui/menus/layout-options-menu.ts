import type { MindmapView } from '../../view/mindmap-view';
import type { LayoutOptions } from '../../domain/layout-options';
import { applyMobileMenuPosition } from './menu-positioning';

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
    const menuWidth = 460;
    const left = Math.max(12, Math.min(rect.left + window.scrollX - menuWidth - 12, window.scrollX + window.innerWidth - menuWidth - 12));
    menu.style.setProperty('--menu-left', `${left}px`);
    menu.style.setProperty('--menu-top', `${rect.top + window.scrollY}px`);

    this.buildMenuContent(menu);
    this.applyMobilePosition(menu, left, menuWidth);
    applyMobileMenuPosition(menu, menuWidth);
    return menu;
  }

  private applyMobilePosition(menu: HTMLElement, left: number, menuWidth: number): void {
    if (!document.body.classList.contains('mindmap-touch-toolbar')) return;

    const visualViewport = window.visualViewport;
    const viewportWidth = Math.round(visualViewport?.width || document.documentElement.clientWidth || window.innerWidth);
    const viewportHeight = Math.round(visualViewport?.height || document.documentElement.clientHeight || window.innerHeight);
    const top = 8;
    const maxWidth = Math.max(180, viewportWidth - 24);

    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.right = 'auto';
    menu.style.width = `${Math.min(menuWidth, maxWidth)}px`;
    menu.style.maxWidth = `${maxWidth}px`;
    menu.style.maxHeight = `${Math.max(160, viewportHeight - top - 12)}px`;
    menu.style.overflowY = 'auto';

    if (document.body.classList.contains('mindmap-toolbar-side')) {
      menu.style.left = `${Math.max(12, Math.min(left, viewportWidth - Math.min(menuWidth, maxWidth) - 12))}px`;
      menu.style.transform = 'none';
    } else {
      menu.style.left = '50%';
      menu.style.transform = 'translateX(-50%)';
    }
  }

  private buildMenuContent(container: HTMLElement): void {
    const title = container.createEl('h3', { text: 'Layout Options' });
    title.addClass('layout-options-menu-title');

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
      'Bias node alignment within each rank',
      {
        none: 'none',
        UL: 'Left',
        UR: 'Right',
      },
      opts.align ?? 'none',
      async (value) => {
        const alignValue = value === 'none' ? undefined : (value as 'UL' | 'UR');
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

    // Sliders - make all callbacks async and save to frontmatter.
    // Edge separation and graph margins are intentionally omitted here:
    // with our straight, unlabeled edges and centered viewport they have no useful visible effect.
    this.addSliderSetting(container, 'Node Separation', 'Pixels between adjacent nodes horizontally', 0, 300, 10, () => opts.nodeSep, async (v) => { 
      opts.nodeSep = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ nodeSep: v }); 
    });
    this.addSliderSetting(container, 'Rank Separation', 'Pixels between ranks vertically', 0, 300, 10, () => opts.rankSep, async (v) => { 
      opts.rankSep = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ rankSep: v }); 
    });
    this.addSliderSetting(container, 'Spacing Factor', 'Overall spacing multiplier', 0.5, 3.0, 0.1, () => opts.spacingFactor, async (v) => { 
      opts.spacingFactor = v; 
      this.view.relayout(); 
      await this.saveToFrontmatter({ spacingFactor: v }); 
    });

    const resetBtn = container.createEl('button', { text: 'Reset layout options' });
    resetBtn.addClass('fullwidth-button', 'layout-reset-button');
    resetBtn.addEventListener('click', async () => {
      await this.view.resetLayoutOptions();
      this.close();
    });

    const closeBtn = container.createEl('button', { text: 'Close' });
    closeBtn.addClass('fullwidth-button');
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
    setValue: (v: number) => Promise<void>,
    formatValue: (v: number) => string = (v) => String(v)
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
    
    const valueEl = controlEl.createEl('span', {
      text: formatValue(getValue()),
      cls: 'setting-item-value',
    });
    
    slider.addEventListener('input', async () => {
      const newVal = Number(slider.value);
      await setValue(newVal);
      valueEl.textContent = formatValue(newVal);
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
