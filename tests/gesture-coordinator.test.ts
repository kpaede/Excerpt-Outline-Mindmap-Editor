import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutlineNode } from '../src/utils/outline';

const { startNodeEditingMock } = vi.hoisted(() => ({
  startNodeEditingMock: vi.fn(() => ({})),
}));

vi.mock('../src/editor/node-editing', () => ({
  startNodeEditing: startNodeEditingMock,
}));

import { MindmapGestureCoordinator } from '../src/view/gesture-coordinator';
import { DIRECT_GESTURE_CONFIG } from '../src/view/pointer-gestures';

type Listener = EventListenerOrEventListenerObject;

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener | null, options?: AddEventListenerOptions | boolean): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
    const signal = typeof options === 'object' ? options.signal : undefined;
    signal?.addEventListener('abort', () => this.removeEventListener(type, listener), { once: true });
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  emit(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

class FakeClassList {
  private readonly values = new Set<string>();

  add(...names: string[]): void { names.forEach((name) => this.values.add(name)); }
  remove(...names: string[]): void { names.forEach((name) => this.values.delete(name)); }
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
  removeProperty(name: string): string { const value = this.values.get(name) ?? ''; this.values.delete(name); return value; }
}

class FakeWindow extends FakeEventTarget {
  setTimeout = windowSetTimeout;
  clearTimeout = windowClearTimeout;
  requestAnimationFrame(callback: FrameRequestCallback): number {
    return windowSetTimeout(() => callback(Date.now()), 0) as unknown as number;
  }
}

function windowSetTimeout(handler: TimerHandler, timeout?: number): number {
  return setTimeout(handler, timeout) as unknown as number;
}

function windowClearTimeout(id: number): void {
  clearTimeout(id);
}

class FakeDocument {
  readonly defaultView = new FakeWindow();
  readonly body = new FakeElement(this, 'body');
  hitElements: FakeElement[] = [];

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  elementsFromPoint(): Element[] {
    return this.hitElements as unknown as Element[];
  }

  elementFromPoint(): Element | null {
    return this.hitElements[0] as unknown as Element ?? null;
  }
}

class FakeElement extends FakeEventTarget {
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  draggable = false;
  isConnected = true;
  private capturedPointers = new Set<number>();
  rect = { left: 0, top: 0, right: 120, bottom: 80, width: 120, height: 80 };

  constructor(readonly ownerDocument: FakeDocument, readonly tagName = 'div') {
    super();
  }

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

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.isConnected = false;
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  cloneNode(deep = false): FakeElement {
    const clone = new FakeElement(this.ownerDocument, this.tagName);
    if (this.classList.contains('markdown-rendered')) clone.classList.add('markdown-rendered');
    if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
    return clone;
  }

  closest(selector: string): FakeElement | null {
    if (selector.includes('.mindmap-overlay button') && selector.includes('.mindmap-heading-frame button')) {
      let candidate: FakeElement | null = this;
      while (candidate) {
        const isControl = candidate.tagName.toLowerCase() === 'button' || candidate.tagName.toLowerCase() === 'a';
        if (isControl) {
          let ancestor = candidate.parent;
          while (ancestor) {
            if (
              ancestor.classList.contains('mindmap-overlay') ||
              ancestor.classList.contains('mindmap-heading-frame')
            ) return candidate;
            ancestor = ancestor.parent;
          }
        }
        candidate = candidate.parent;
      }
      return null;
    }

    let current: FakeElement | null = this;
    while (current) {
      if (selector === '.mindmap-heading-frame-title' && current.classList.contains('mindmap-heading-frame-title')) return current;
      if (
        selector === '[data-heading-frame][data-heading-line]' &&
        current.dataset.headingFrame &&
        current.dataset.headingLine
      ) return current;
      if (selector.includes('.mindmap-overlay') && current.classList.contains('mindmap-overlay')) return current;
      if (selector.includes('.mindmap-empty-heading-drop-target') && current.classList.contains('mindmap-empty-heading-drop-target')) return current;
      if (selector.includes('button') && current.tagName.toLowerCase() === 'button') return current;
      if (selector.includes('.vertical-toolbar') && current.classList.contains('vertical-toolbar')) return current;
      current = current.parent;
    }
    return null;
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    const lineMatch = selector.match(/data-node-line="(\d+)"/);
    const matches = (element: FakeElement): boolean => {
      if (selector.includes('.mindmap-overlay') && !element.classList.contains('mindmap-overlay')) return false;
      if (lineMatch && element.dataset.nodeLine !== lineMatch[1]) return false;
      if (selector === '.markdown-rendered' && !element.classList.contains('markdown-rendered')) return false;
      if (selector === '.checkbox-toggle' && !element.classList.contains('checkbox-toggle')) return false;
      if (selector.includes('.node-editor') || selector.includes('.mindmap-heading-editor')) return false;
      return selector.includes('.mindmap-overlay') || selector === '.markdown-rendered' || selector === '.checkbox-toggle';
    };
    const visit = (element: FakeElement): FakeElement | null => {
      for (const child of element.children) {
        if (matches(child)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this) as unknown as T | null;
  }

  contains(candidate: FakeElement): boolean {
    let current: FakeElement | null = candidate;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect;
  }

  setPointerCapture(pointerId: number): void { this.capturedPointers.add(pointerId); }
  hasPointerCapture(pointerId: number): boolean { return this.capturedPointers.has(pointerId); }
  releasePointerCapture(pointerId: number): void { this.capturedPointers.delete(pointerId); }
}

function outlineNode(line: number, endLine = line): OutlineNode {
  return { text: `Node ${line}`, indent: '', marker: '-', line, endLine, children: [], checkbox: 'none' };
}

function pointerEvent(
  target: FakeElement,
  overrides: Partial<PointerEvent> = {}
): PointerEvent {
  return {
    pointerType: 'pen',
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX: 60,
    clientY: 40,
    target: target as unknown as EventTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as PointerEvent;
}

interface Fixture {
  coordinator: MindmapGestureCoordinator;
  wrapper: FakeElement;
  ownerWindow: FakeWindow;
  doc: FakeDocument;
  source: FakeElement;
  target: FakeElement;
  checkbox: FakeElement;
  headingTitle: FakeElement;
  view: Record<string, any>;
}

function fixture(): Fixture {
  const doc = new FakeDocument();
  const wrapper = new FakeElement(doc);
  const source = new FakeElement(doc);
  source.classList.add('mindmap-overlay', 'has-checkbox');
  source.dataset.nodeLine = '4';
  source.draggable = true;
  const sourceMarkdown = new FakeElement(doc);
  sourceMarkdown.classList.add('markdown-rendered');
  source.appendChild(sourceMarkdown);
  const checkbox = new FakeElement(doc, 'button');
  checkbox.classList.add('checkbox-toggle');
  checkbox.rect = { left: 0, top: 0, right: 24, bottom: 24, width: 24, height: 24 };
  source.appendChild(checkbox);
  wrapper.appendChild(source);

  const target = new FakeElement(doc);
  target.classList.add('mindmap-overlay');
  target.dataset.nodeLine = '8';
  target.draggable = true;
  wrapper.appendChild(target);

  const headingFrame = new FakeElement(doc);
  headingFrame.classList.add('mindmap-heading-frame');
  headingFrame.dataset.headingFrame = '1';
  headingFrame.dataset.headingLine = '0';
  const headingTitle = new FakeElement(doc);
  headingTitle.classList.add('mindmap-heading-frame-title');
  headingFrame.appendChild(headingTitle);
  wrapper.appendChild(headingFrame);

  const nodes = [outlineNode(4), outlineNode(8)];
  const selected = new Set<number>();
  const panBy = vi.fn();
  const view: Record<string, any> = {
    file: {},
    cy: {
      panBy,
      zoom: () => 1,
      minZoom: () => 0.1,
      maxZoom: () => 4,
      container: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
    },
    toolbar: { closeMenus: vi.fn() },
    dismissNodeContextMenu: vi.fn(),
    showNodeContextMenu: vi.fn(),
    selectNode: vi.fn((line: number) => { selected.clear(); selected.add(line); }),
    clearSelection: vi.fn(() => selected.clear()),
    getNodeByLine: (line: number) => nodes.find((node) => node.line === line) ?? null,
    toggleNodeCheckbox: vi.fn(),
    setZoomFactor: vi.fn(),
    updateOverlayGeometry: vi.fn(),
    enterEditModeForHeadingByLine: vi.fn(),
    executeMoveSubtreeCommand: vi.fn(),
    executeMoveSubtreeToEmptyHeadingCommand: vi.fn(),
  };
  const coordinator = new MindmapGestureCoordinator(view as never, wrapper as unknown as HTMLElement);
  return { coordinator, wrapper, ownerWindow: doc.defaultView, doc, source, target, checkbox, headingTitle, view };
}

describe('mindmap direct-input coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    startNodeEditingMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects on completed up and edits after exactly two completed Pencil taps', () => {
    const { coordinator, wrapper, ownerWindow, source, view } = fixture();
    const firstDown = pointerEvent(source);
    wrapper.emit('pointerdown', firstDown as unknown as Event);
    expect(view.selectNode).not.toHaveBeenCalled();
    ownerWindow.emit('pointerup', pointerEvent(source, { buttons: 0 }) as unknown as Event);
    expect(view.selectNode).toHaveBeenCalledTimes(1);
    expect(startNodeEditingMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    wrapper.emit('pointerdown', pointerEvent(source, { pointerId: 2 }) as unknown as Event);
    expect(startNodeEditingMock).not.toHaveBeenCalled();
    ownerWindow.emit('pointerup', pointerEvent(source, { pointerId: 2, buttons: 0 }) as unknown as Event);

    expect(startNodeEditingMock).toHaveBeenCalledTimes(1);
    expect(coordinator.getMode()).toBe('edit');
    coordinator.destroy();
  });

  it('does not combine a Pencil tap and a finger tap into a double tap', () => {
    const { coordinator, wrapper, ownerWindow, source } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source) as unknown as Event);
    ownerWindow.emit('pointerup', pointerEvent(source, { buttons: 0 }) as unknown as Event);
    wrapper.emit('pointerdown', pointerEvent(source, { pointerId: 2, pointerType: 'touch' }) as unknown as Event);
    ownerWindow.emit('pointerup', pointerEvent(source, { pointerId: 2, pointerType: 'touch', buttons: 0 }) as unknown as Event);
    expect(startNodeEditingMock).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it('edits a heading after exactly two completed direct taps through the coordinator', () => {
    const { coordinator, wrapper, ownerWindow, headingTitle, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(headingTitle) as unknown as Event);
    ownerWindow.emit('pointerup', pointerEvent(headingTitle, { buttons: 0 }) as unknown as Event);
    expect(view.enterEditModeForHeadingByLine).not.toHaveBeenCalled();

    vi.advanceTimersByTime(180);
    wrapper.emit('pointerdown', pointerEvent(headingTitle, { pointerId: 2 }) as unknown as Event);
    ownerWindow.emit('pointerup', pointerEvent(headingTitle, { pointerId: 2, buttons: 0 }) as unknown as Event);

    expect(view.enterEditModeForHeadingByLine).toHaveBeenCalledTimes(1);
    expect(view.enterEditModeForHeadingByLine).toHaveBeenCalledWith(0);
    expect(startNodeEditingMock).not.toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('edit');
    coordinator.destroy();
  });

  it('opens the menu on a stationary hold and turns hold plus movement into drag', () => {
    const { coordinator, wrapper, ownerWindow, source, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source) as unknown as Event);
    vi.advanceTimersByTime(DIRECT_GESTURE_CONFIG.longPressMs);
    expect(coordinator.getMode()).toBe('menu');
    expect(view.showNodeContextMenu).toHaveBeenCalledTimes(1);

    view.dismissNodeContextMenu.mockClear();
    ownerWindow.emit('pointermove', pointerEvent(source, { clientX: 80, clientY: 40 }) as unknown as Event);
    expect(coordinator.getMode()).toBe('drag');
    expect(view.dismissNodeContextMenu).toHaveBeenCalledTimes(1);
    expect(source.classList.contains('mm-src')).toBe(true);
    coordinator.destroy();
  });

  it('pans on early movement over a node and never opens or starts a node drag', () => {
    const { coordinator, wrapper, ownerWindow, source, view } = fixture();
    const down = pointerEvent(source);
    const move = pointerEvent(source, { clientX: 80, clientY: 40 });
    wrapper.emit('pointerdown', down as unknown as Event);
    ownerWindow.emit('pointermove', move as unknown as Event);
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(move.stopPropagation).toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('pan');
    expect(view.cy.panBy).toHaveBeenCalled();
    vi.advanceTimersByTime(DIRECT_GESTURE_CONFIG.longPressMs);
    expect(view.showNodeContextMenu).not.toHaveBeenCalled();
    expect(source.classList.contains('mm-src')).toBe(false);
    coordinator.destroy();
  });

  it('gives a second direct contact pinch precedence, even on an interactive control', () => {
    const { coordinator, wrapper, ownerWindow, source, checkbox, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source) as unknown as Event);
    const second = pointerEvent(checkbox, { pointerId: 2, pointerType: 'touch', clientX: 100 });
    wrapper.emit('pointerdown', second as unknown as Event);
    expect(coordinator.getMode()).toBe('pinch');
    expect(second.stopPropagation).toHaveBeenCalled();

    ownerWindow.emit('pointermove', pointerEvent(checkbox, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 120,
    }) as unknown as Event);
    expect(view.setZoomFactor).toHaveBeenCalled();
    expect(source.classList.contains('mm-src')).toBe(false);
    expect(view.showNodeContextMenu).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it('promotes a control-first sequence to pinch and suppresses its later activation', () => {
    const { coordinator, wrapper, ownerWindow, source, checkbox, view } = fixture();
    const first = pointerEvent(checkbox, {
      pointerType: 'touch', clientX: 12, clientY: 12,
    });
    wrapper.emit('pointerdown', first as unknown as Event);
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(first.stopPropagation).not.toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('idle');

    const second = pointerEvent(source, {
      pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 40,
    });
    wrapper.emit('pointerdown', second as unknown as Event);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(second.stopPropagation).toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('pinch');

    ownerWindow.emit('pointerup', pointerEvent(source, {
      pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 40, buttons: 0,
    }) as unknown as Event);
    const firstUp = pointerEvent(checkbox, {
      pointerType: 'touch', clientX: 12, clientY: 12, buttons: 0,
    });
    ownerWindow.emit('pointerup', firstUp as unknown as Event);
    expect(firstUp.preventDefault).toHaveBeenCalled();

    const compatibilityClick = pointerEvent(checkbox, {
      pointerType: 'touch', clientX: 12, clientY: 12, buttons: 0,
    });
    wrapper.emit('click', compatibilityClick as unknown as Event);
    expect(compatibilityClick.preventDefault).toHaveBeenCalled();
    expect(view.toggleNodeCheckbox).not.toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('idle');
    coordinator.destroy();
  });

  it('leaves an isolated viewport control sequence native and does not consume its click', () => {
    const { coordinator, wrapper, ownerWindow, checkbox } = fixture();
    const down = pointerEvent(checkbox, { pointerType: 'touch', clientX: 12, clientY: 12 });
    wrapper.emit('pointerdown', down as unknown as Event);
    const up = pointerEvent(checkbox, {
      pointerType: 'touch', clientX: 12, clientY: 12, buttons: 0,
    });
    ownerWindow.emit('pointerup', up as unknown as Event);
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(up.preventDefault).not.toHaveBeenCalled();

    const click = pointerEvent(checkbox, {
      pointerType: 'touch', clientX: 12, clientY: 12, buttons: 0,
    });
    wrapper.emit('click', click as unknown as Event);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('idle');
    coordinator.destroy();
  });

  it('accumulates many slow Pinch deltas that are individually below 0.01 zoom', () => {
    const { coordinator, wrapper, ownerWindow, source, target, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 60,
    }) as unknown as Event);
    wrapper.emit('pointerdown', pointerEvent(target, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 100,
    }) as unknown as Event);

    // Each move grows the 40px span by just 0.08px: roughly 0.002 zoom.
    // Ten moves must still reach 1.02 instead of repeatedly snapping to 1.00.
    for (let step = 1; step <= 10; step++) {
      ownerWindow.emit('pointermove', pointerEvent(target, {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 100 + step * 0.08,
      }) as unknown as Event);
    }

    const zoomTargets = view.setZoomFactor.mock.calls.map(([zoom]: [number]) => zoom);
    expect(zoomTargets).toHaveLength(10);
    expect(zoomTargets[0]).toBeCloseTo(1.002, 6);
    expect(zoomTargets.at(-1)).toBeCloseTo(1.02, 6);
    expect(zoomTargets.every((zoom: number, index: number) => index === 0 || zoom > zoomTargets[index - 1])).toBe(true);
    coordinator.destroy();
  });

  it('returns to idle on pointercancel and cannot fire a stale hold', () => {
    const { coordinator, wrapper, ownerWindow, source, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source) as unknown as Event);
    ownerWindow.emit('pointercancel', pointerEvent(source, { buttons: 0 }) as unknown as Event);
    expect(coordinator.getMode()).toBe('idle');
    expect(source.draggable).toBe(true);
    vi.advanceTimersByTime(DIRECT_GESTURE_CONFIG.longPressMs);
    expect(view.showNodeContextMenu).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it('toggles a checked node once within a 44px target and suppresses only the nearby compatibility click', () => {
    const { coordinator, wrapper, ownerWindow, source, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source, { clientX: 30, clientY: 20 }) as unknown as Event);
    ownerWindow.emit('pointerup', pointerEvent(source, { clientX: 30, clientY: 20, buttons: 0 }) as unknown as Event);
    expect(view.toggleNodeCheckbox).toHaveBeenCalledTimes(1);

    const compatibilityClick = pointerEvent(source, {
      pointerType: 'touch', clientX: 30, clientY: 20, buttons: 0,
    });
    wrapper.emit('click', compatibilityClick as unknown as Event);
    expect(compatibilityClick.preventDefault).toHaveBeenCalled();
    expect(view.toggleNodeCheckbox).toHaveBeenCalledTimes(1);

    const mouseClick = pointerEvent(source, {
      pointerType: 'mouse', clientX: 30, clientY: 20, buttons: 0,
    });
    wrapper.emit('click', mouseClick as unknown as Event);
    expect(mouseClick.preventDefault).not.toHaveBeenCalled();
    coordinator.destroy();
  });

  it('marks a self-drop invalid at the source and never mutates the document', async () => {
    const { coordinator, wrapper, ownerWindow, doc, source, view } = fixture();
    wrapper.emit('pointerdown', pointerEvent(source) as unknown as Event);
    vi.advanceTimersByTime(DIRECT_GESTURE_CONFIG.longPressMs);
    doc.hitElements = [source];
    ownerWindow.emit('pointermove', pointerEvent(source, { clientX: 80, clientY: 40 }) as unknown as Event);
    expect(source.classList.contains('mm-tgt-invalid')).toBe(true);
    ownerWindow.emit('pointerup', pointerEvent(source, { clientX: 80, clientY: 40, buttons: 0 }) as unknown as Event);
    await Promise.resolve();
    expect(view.executeMoveSubtreeCommand).not.toHaveBeenCalled();
    expect(coordinator.getMode()).toBe('idle');
    coordinator.destroy();
  });
});
