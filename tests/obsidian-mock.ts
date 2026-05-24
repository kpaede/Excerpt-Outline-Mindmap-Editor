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

export class TFile {
  path = '';
  extension = 'md';
  name = '';
}
