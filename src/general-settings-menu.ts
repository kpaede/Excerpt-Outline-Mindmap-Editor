import { TFile, Setting, ToggleComponent } from 'obsidian';
import { FrontmatterStorage } from './frontmatter-storage';
import { applyMobileMenuPosition } from './menu-positioning';

type ClickHandlerElement = HTMLElement & {
  _clickHandler?: (event: MouseEvent) => void;
};

interface GeneralSettingsView {
  file?: TFile | null;
  frontmatterStorage?: FrontmatterStorage;
}

export interface GeneralSettings {
  keyboardNavigation: 'hierarchical' | 'spatial';
  showCheckboxesOnHover?: boolean;
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
  private view?: GeneralSettingsView;

  constructor(anchorEl: HTMLElement, settings: GeneralSettings, onSave: (settings: GeneralSettings) => void, view?: GeneralSettingsView) {
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
    const menuWidth = 320;
    const left = Math.max(
      12,
      Math.min(rect.left + window.scrollX - menuWidth - 12, window.scrollX + window.innerWidth - menuWidth - 12)
    );
    // Only set dynamic position variables; other layout handled by CSS
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
    this.container.createEl('h3', { text: 'General Settings' });
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

    new Setting(this.container)
      .setName('Show checkbox toggle on non-checkbox nodes')
      .setDesc('Display a checkbox icon when hovering over nodes that are not already task list items.')
      .addToggle((toggle: ToggleComponent) =>
        toggle
          .setValue(this.settings.showCheckboxesOnHover ?? false)
          .onChange(async (value: boolean) => {
            this.settings.showCheckboxesOnHover = value;
            this.onSave(this.settings);
            if (this.view?.file && this.view?.frontmatterStorage) {
              try {
                await this.view.frontmatterStorage.updateGeneralSettings(this.view.file, this.settings);
              } catch (error) {
                console.error('Failed to save general settings to frontmatter:', error);
              }
            }
          })
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
    const container = this.container as ClickHandlerElement;
    container._clickHandler = handler;
  }

  public close() {
    if (this.container) {
      const container = this.container as ClickHandlerElement;
      const handler = container._clickHandler;
      if (handler) {
        document.removeEventListener('click', handler);
      }
      this.container.remove();
    }
  }
}
