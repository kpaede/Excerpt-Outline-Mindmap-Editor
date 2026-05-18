import type { MindmapView } from './mindmapView';

export class ZoomOptionsMenu {
  private menu: HTMLDivElement;
  private view: MindmapView;

  constructor(anchorEl: HTMLElement, view: MindmapView) {
    this.view = view;
    this.menu = this.createMenu(anchorEl);
    document.body.appendChild(this.menu);
    this.setupEventListeners();
  }

  private createMenu(anchorEl: HTMLElement): HTMLDivElement {
    const menu = document.createElement('div');
    menu.className = 'zoom-options-menu';

    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = 320;
    const left = Math.max(
      12,
      Math.min(rect.left + window.scrollX - menuWidth - 12, window.scrollX + window.innerWidth - menuWidth - 12)
    );

    menu.style.setProperty('--menu-left', `${left}px`);
    menu.style.setProperty('--menu-top', `${rect.top + window.scrollY}px`);

    this.buildMenuContent(menu);
    return menu;
  }

  private buildMenuContent(container: HTMLElement): void {
    const currentZoom = this.view.cy?.zoom() ?? this.view.layoutOptions.zoomFactor ?? 1;

    container.createEl('h3', { text: 'Zoom Options' });

    const settingEl = container.createDiv({ cls: 'setting-item' });
    const infoEl = settingEl.createDiv({ cls: 'setting-item-info' });
    infoEl.createDiv({ text: 'Zoom', cls: 'setting-item-name' });
    infoEl.createDiv({ text: 'Current canvas zoom level', cls: 'setting-item-description' });

    const controlEl = settingEl.createDiv({ cls: 'setting-item-control' });
    const slider = controlEl.createEl('input', { type: 'range' });
    slider.min = '0.25';
    slider.max = '3';
    slider.step = '0.05';
    slider.value = String(currentZoom);
    slider.classList.add('slider-margin-right');

    const valueEl = controlEl.createEl('span', {
      text: this.formatZoom(currentZoom),
      cls: 'setting-item-value',
    });

    slider.addEventListener('input', () => {
      const nextZoom = Number(slider.value);
      this.view.setZoomFactor(nextZoom, true);
      valueEl.textContent = this.formatZoom(nextZoom);
    });

    const actions = container.createDiv({ cls: 'zoom-options-actions' });
    const fitButton = actions.createEl('button', { text: 'Fit to view' });
    fitButton.addEventListener('click', () => {
      this.view.fitToView();
      const fittedZoom = this.view.cy?.zoom() ?? currentZoom;
      slider.value = String(fittedZoom);
      valueEl.textContent = this.formatZoom(fittedZoom);
    });

    const resetButton = actions.createEl('button', { text: '100%' });
    resetButton.addEventListener('click', () => {
      this.view.setZoomFactor(1, true);
      slider.value = '1';
      valueEl.textContent = this.formatZoom(1);
    });

    const closeButton = container.createEl('button', { text: 'Close' });
    closeButton.classList.add('fullwidth-button');
    closeButton.addEventListener('click', () => this.close());
  }

  private formatZoom(zoomFactor: number): string {
    return `${Math.round(zoomFactor * 100)}%`;
  }

  private setupEventListeners(): void {
    const handleClickOutside = (event: MouseEvent) => {
      if (!this.menu.contains(event.target as Node)) {
        this.close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 10);

    this.menu.addEventListener('remove', () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    });
  }

  public close(): void {
    if (this.menu.parentElement) {
      this.menu.remove();
    }
  }

  public isOpen(): boolean {
    return this.menu.parentElement !== null;
  }
}
