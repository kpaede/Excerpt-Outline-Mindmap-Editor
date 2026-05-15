import { Setting } from 'obsidian';

export interface GeneralSettings {
  keyboardNavigation: 'hierarchical' | 'spatial';
}

/**
 * GeneralSettingsMenu creates a menu-style interface for general options
 * positioned next to the clicked button
 */
export class GeneralSettingsMenu {
  private container: HTMLDivElement;
  private settings: GeneralSettings;
  private onSave: (settings: GeneralSettings) => void;
  private anchorEl: HTMLElement;
  private view: any;

  constructor(anchorEl: HTMLElement, settings: GeneralSettings, onSave: (settings: GeneralSettings) => void, view?: any) {
    this.anchorEl = anchorEl;
    this.settings = { ...settings };
    this.onSave = onSave;
    this.view = view;
    this.createMenu();
  }

  private createMenu() {
    this.container = document.body.createDiv({ cls: 'general-settings-menu' });
    this.positionMenu();
    this.buildContent();
    this.addClickOutsideHandler();
  }

  private positionMenu() {
    const rect = this.anchorEl.getBoundingClientRect();
    // Only set dynamic position; other layout handled by CSS
    this.container.style.left = `${rect.left + window.scrollX - 328}px`;
    this.container.style.top = `${rect.top + window.scrollY}px`;
  }

  private buildContent() {
    const header = this.container.createEl('h3', { text: 'General Settings' });
    // Header styling provided via CSS

    this.addSelectSetting(
      'Keyboard Navigation',
      'Choose how arrow keys move the selection.',
      ['hierarchical', 'spatial'],
      ['Hierarchical (Tree)', 'Spatial (Visual)'],
      () => this.settings.keyboardNavigation,
      (val) => {
        this.settings.keyboardNavigation = val as 'hierarchical' | 'spatial';
        this.onSave(this.settings);
      }
    );

    const closeBtn = this.container.createEl('button', { text: 'Close' });
    closeBtn.classList.add('fullwidth-button');
    closeBtn.addEventListener('click', () => this.close());
  }

  private addSelectSetting(
    label: string,
    desc: string,
    options: string[],
    optionLabels: string[],
    getValue: () => string,
    setValue: (v: string) => void
  ) {
    const settingDiv = this.container.createDiv({ cls: 'setting-item' });
    
    const labelDiv = settingDiv.createDiv({ cls: 'setting-item-info' });
    labelDiv.createDiv({ text: label, cls: 'setting-item-name' });
    labelDiv.createDiv({ text: desc, cls: 'setting-item-description' });
    
    const controlDiv = settingDiv.createDiv({ cls: 'setting-item-control' });
    const select = controlDiv.createEl('select');
    
    options.forEach((opt, index) => {
      const optionEl = select.createEl('option', { value: opt, text: optionLabels[index] });
      if (opt === getValue()) {
        optionEl.selected = true;
      }
    });

    select.addEventListener('change', async () => {
      setValue(select.value);
      if (this.view?.file && this.view?.frontmatterStorage) {
        try {
          await this.view.frontmatterStorage.updateGeneralSettings(this.view.file, this.settings);
        } catch (error) {
          console.error('Failed to save general settings to frontmatter:', error);
        }
      }
    });
  }

  private addClickOutsideHandler() {
    const handler = (event: MouseEvent) => {
      if (!this.container.contains(event.target as Node) && 
          !this.anchorEl.contains(event.target as Node)) {
        this.close();
      }
    };
    setTimeout(() => { document.addEventListener('click', handler); }, 100);
    (this.container as any)._clickHandler = handler;
  }

  public close() {
    if (this.container) {
      const handler = (this.container as any)._clickHandler;
      if (handler) {
        document.removeEventListener('click', handler);
      }
      this.container.remove();
    }
  }
}
