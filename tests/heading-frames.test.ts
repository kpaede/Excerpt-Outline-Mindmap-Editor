import { describe, expect, it, vi } from 'vitest';
import type { HeadingSection } from '../src/utils/heading-sections';
import { renderHeadingFrames } from '../src/view/heading-frames';

type Listener = EventListenerOrEventListenerObject;

class FakeClassList {
  private readonly values = new Set<string>();
  add(...names: string[]): void { names.forEach((name) => this.values.add(name)); }
  contains(name: string): boolean { return this.values.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(name);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeStyle {
  readonly values = new Map<string, string>();
  setProperty(name: string, value: string): void { this.values.set(name, value); }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  type = '';
  textContent = '';
  parent: FakeElement | null = null;

  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {}

  // Obsidian's createEl creates in this element's document and appends in one
  // step; the stub mirrors that so the assertions still see the same tree.
  createEl(tagName: string, options?: { cls?: string; prepend?: boolean }): FakeElement {
    const child = this.ownerDocument.createElement(tagName);
    if (options?.cls) child.className = options.cls;
    if (options?.prepend) this.children.unshift(child);
    else this.appendChild(child);
    return child;
  }

  createDiv(options?: { cls?: string; prepend?: boolean }): FakeElement {
    return this.createEl('div', options);
  }

  // Obsidian augments HTMLElement with these at runtime; the stubs mirror them
  // onto the same `style` the assertions read.
  setCssProps(props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
  }

  setCssStyles(styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) this.style.setProperty(name, value);
  }

  set className(value: string) {
    value.split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  addClass(name: string): void { this.classList.add(name); }

  createEl(tagName: string, options?: { text?: string }): FakeElement {
    const child = this.ownerDocument.createElement(tagName);
    child.textContent = options?.text ?? '';
    this.appendChild(child);
    return child;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches = (element: FakeElement): boolean =>
      selector === '[data-heading-frame]' && Boolean(element.dataset.headingFrame);
    const found: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      element.children.forEach((child) => {
        if (matches(child)) found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName.toUpperCase());
  }
}

describe('heading frame controls', () => {
  it('renders the empty-heading action as a semantic button with native activation', () => {
    const document = new FakeDocument();
    const wrapper = document.createElement('div');
    const section: HeadingSection = {
      text: 'Ideas', rawText: '# Ideas', line: 0, endLine: 0, level: 1, nodeLines: [],
    };
    const onEmptyHeadingCreate = vi.fn();
    const cy = {
      zoom: () => 1,
      pan: () => ({ x: 0, y: 0 }),
      getElementById: () => ({ empty: () => true }),
    };

    renderHeadingFrames(
      wrapper as unknown as HTMLElement,
      cy as never,
      [section],
      new Map(),
      { onEmptyHeadingCreate }
    );

    const frame = wrapper.children[0];
    const button = frame.children.find((child) => child.classList.contains('mindmap-empty-heading-drop-target'));
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.type).toBe('button');

    const click = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    button?.emit('click', click);
    expect(onEmptyHeadingCreate).toHaveBeenCalledTimes(1);
    expect(click.stopPropagation).toHaveBeenCalledTimes(1);
  });
});
