export class Modal {
  contentEl = document.createElement('div');

  constructor(_app?: unknown) {}

  close(): void {}
}

export class Setting {
  constructor(_containerEl?: HTMLElement) {}

  setName(_name: string): this {
    return this;
  }

  addText(_callback: (text: { setValue: (value: string) => { onChange: (callback: (value: string) => void) => void } }) => void): this {
    return this;
  }
}

export class Notice {
  constructor(_message: string) {}
}

export function setIcon(_element: HTMLElement, _icon: string): void {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

export class TFile {
  path = '';
  extension = 'md';
  name = '';
}

export class MenuItem {
  title = '';
  disabled = false;
  click: (() => void) | null = null;

  setTitle(title: string): this { this.title = title; return this; }
  setIcon(_icon: string): this { return this; }
  setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
  onClick(callback: () => void): this { this.click = callback; return this; }
}

export let lastMenu: Menu | null = null;

export class Menu {
  items: MenuItem[] = [];
  position: { x: number; y: number } | null = null;
  positionDocument: Document | null = null;

  constructor() { lastMenu = this; }
  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this { return this; }
  showAtMouseEvent(_event: MouseEvent): void {}
  showAtPosition(position: { x: number; y: number }, doc?: Document): this {
    this.position = position;
    this.positionDocument = doc ?? null;
    return this;
  }
  onHide(_callback: () => void): void {}
  hide(): void {}
}
