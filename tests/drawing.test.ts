import { describe, expect, it, vi } from 'vitest';
import { getStroke } from 'perfect-freehand';
import { beautifyStroke } from '../src/drawing/shape-beautifier';
import { penStrokeOptions } from '../src/drawing/pen-stroke-options';
import { createDrawingSvg, extractDrawingLink, parseDrawingSvg } from '../src/drawing/drawing-svg';
import type { InkPoint, PressurePenData, PressurePenOptions } from '../src/drawing/types';
import {
  createPressurePenTool,
  getActiveInkSample,
  shouldRestartHoldTimer,
  withCurrentInkSample,
} from '../src/drawing/pressure-pen';
import {
  coalescedPenSamples,
  isExplicitPenPointer,
  penInkSample,
  WhiteboardInputAdapter,
} from '../src/drawing/whiteboard-input-adapter';
import type { SimpleWhiteboard } from '@ludovicm67/simple-whiteboard';
import type { Plugin } from 'obsidian';
import {
  assertWhiteboardRuntimeInDocument,
  WhiteboardRuntimeCapabilityError,
} from '../src/drawing/whiteboard-runtime';
import { DEFAULT_PEN_PREFERENCES, PenPreferenceStore } from '../src/drawing/pen-preferences';

const point = (x: number, y: number, pressure = 0.5): InkPoint => ({ x, y, pressure });

interface PressureTestItem {
  export(): { data: PressurePenData };
  partialUpdate(data: Partial<PressurePenData>): void;
  getBoundingBox(): { x: number; y: number; width: number; height: number } | null;
}

class PressureTestItemBase {
  private static nextId = 0;
  private id: string;

  constructor(_data: unknown, id?: string) {
    this.id = id ?? `pressure-item-${PressureTestItemBase.nextId++}`;
  }

  getId(): string { return this.id; }
  setId(id: string): void { this.id = id; }
}

class PressureTestToolBase<Item> {
  protected readonly newItem: (data: unknown, id?: string) => Item;

  constructor(_board: unknown, builder: (data: unknown, id?: string) => Item) {
    this.newItem = builder;
  }
}

function pressureToolFixture(options: Partial<PressurePenOptions> = {}): {
  board: SimpleWhiteboard;
  tool: ReturnType<typeof createPressurePenTool>;
  items: Map<string, PressureTestItem>;
  originalUnselected: ReturnType<typeof vi.fn>;
} {
  const items = new Map<string, PressureTestItem>();
  const originalUnselected = vi.fn();
  const boardWindow = {
    setTimeout: (callback: () => void, delay: number): number => setTimeout(callback, delay) as unknown as number,
    clearTimeout: (timer: number): void => clearTimeout(timer),
    requestAnimationFrame: (callback: FrameRequestCallback): number => (
      setTimeout(() => callback(Date.now()), 16) as unknown as number
    ),
    cancelAnimationFrame: (frame: number): void => clearTimeout(frame),
    performance: { now: (): number => Date.now() },
  };
  const coords = {
    convertFromCanvas: (x: number, y: number) => ({ x, y }),
    convertToCanvas: (x: number, y: number) => ({ x, y }),
    getZoom: () => 1,
  };
  const board = {
    ownerDocument: { defaultView: boardWindow },
    getCoordsContext: () => coords,
    addItem: (item: PressureTestItem & { getId(): string }) => items.set(item.getId(), item),
    getItemById: (id: string) => items.get(id),
    partialItemUpdateById: (id: string, data: Partial<PressurePenData>) => items.get(id)?.partialUpdate(data),
    removeItemById: (id: string) => { items.delete(id); },
    draw: vi.fn(),
  } as unknown as SimpleWhiteboard;
  const penOptions: PressurePenOptions = {
    color: '#000000',
    size: 10,
    smoothing: 0.5,
    thinning: 0.5,
    streamline: 0.5,
    ...options,
  };
  const originalPen = {
    getIcon: () => null,
    renderToolOptions: () => null,
    onToolSelected: vi.fn(),
    onToolUnselected: originalUnselected,
    getCurrentOptions: () => penOptions,
  } as unknown as ReturnType<SimpleWhiteboard['getToolInstance']>;
  const tool = createPressurePenTool(
    board,
    PressureTestItemBase as never,
    PressureTestToolBase as never,
    originalPen
  );
  return { board, tool, items, originalUnselected };
}

function drawPressureStart(
  board: SimpleWhiteboard,
  tool: ReturnType<typeof createPressurePenTool>,
  sample: InkPoint
): void {
  withCurrentInkSample(board, sample, () => tool.handleDrawingStart(sample.x, sample.y));
}

function drawPressureMove(
  board: SimpleWhiteboard,
  tool: ReturnType<typeof createPressurePenTool>,
  sample: InkPoint
): void {
  withCurrentInkSample(board, sample, () => tool.handleDrawingMove(sample.x, sample.y));
}

describe('drawing shape beautification', () => {
  it('straightens a nearly linear Pencil stroke while preserving its endpoints', () => {
    const input = [point(0, 0, 0.2), point(10, 1, 0.3), point(20, -1, 0.4), point(30, 1, 0.5), point(40, 0, 0.6), point(50, 0, 0.8)];
    const result = beautifyStroke(input);
    expect(result?.kind).toBe('line');
    expect(result?.points[0]).toMatchObject({ x: 0, y: 0, pressure: 0.2 });
    expect(result?.points.at(-1)).toMatchObject({ x: 50, y: 0, pressure: 0.8 });
  });

  it('cleans an arbitrary stroke without forcing an open stroke into a closed primitive', () => {
    const input = [point(0, 0), point(8, 12), point(17, 7), point(25, 20), point(34, 12), point(43, 25), point(55, 18)];
    const result = beautifyStroke(input);
    expect(result?.kind).toBe('freeform');
    expect(result?.points).toHaveLength(input.length);
  });

  it('recognizes a hand-drawn rectangle and outputs an axis-aligned point path', () => {
    const width = 120;
    const height = 70;
    const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }, { x: 0, y: 0 }];
    const input: InkPoint[] = [];
    for (let side = 0; side < 4; side++) {
      const a = corners[side];
      const b = corners[side + 1];
      for (let step = 0; step < 8; step++) {
        const t = step / 8;
        input.push(point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
      }
    }
    const result = beautifyStroke(input);
    expect(result?.kind).toBe('rectangle');
    const xs = result!.points.map((p) => p.x);
    const ys = result!.points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 0);
    expect(Math.max(...xs)).toBeCloseTo(width, 0);
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(height, 0);
  });

  it('recognizes a hand-drawn ellipse and outputs a rounded point path', () => {
    const radiusX = 60;
    const radiusY = 40;
    const steps = 40;
    const input: InkPoint[] = Array.from({ length: steps + 1 }, (_, i) => {
      const theta = (i / steps) * Math.PI * 2;
      return point(Math.cos(theta) * radiusX, Math.sin(theta) * radiusY);
    });
    const result = beautifyStroke(input);
    expect(result?.kind).toBe('ellipse');
    // fitEllipse's radius is a statistical (variance-based) estimate, not an
    // exact reconstruction, so allow some slack around the true diameters.
    const xs = result!.points.map((p) => p.x);
    const ys = result!.points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThan(radiusX * 1.6);
    expect(width).toBeLessThan(radiusX * 2.4);
    expect(height).toBeGreaterThan(radiusY * 1.6);
    expect(height).toBeLessThan(radiusY * 2.4);
  });
});

describe('pressure pen tool lifecycle', () => {
  it('keeps a stationary hold timer, persists held pressure and continues from the visible beautified path', () => {
    vi.useFakeTimers();
    try {
      const { board, tool, items } = pressureToolFixture();
      drawPressureStart(board, tool, point(0, 0, 0.2));
      drawPressureMove(board, tool, point(10, 0.2, 0.3));
      drawPressureMove(board, tool, point(20, -0.2, 0.4));
      drawPressureMove(board, tool, point(30, 0.1, 0.5));
      drawPressureMove(board, tool, point(40, -0.1, 0.6));
      drawPressureMove(board, tool, point(50, 0, 0.7));

      vi.advanceTimersByTime(300);
      drawPressureMove(board, tool, point(50.4, 0.2, 0.9));
      vi.advanceTimersByTime(130);
      vi.advanceTimersByTime(200);

      const item = Array.from(items.values())[0];
      const beautified = item.export().data;
      expect(beautified.beautification?.kind).toBe('line');
      expect(beautified.rawPath?.at(-1)?.pressure).toBe(0.9);

      drawPressureMove(board, tool, point(50.6, 0.1, 0.31));
      const held = item.export().data;
      expect(held.path.at(-1)?.pressure).toBe(0.31);
      expect(held.rawPath?.at(-1)?.pressure).toBe(0.31);

      const visibleBeforeContinuation = held.path.map((sample) => ({ ...sample }));
      drawPressureMove(board, tool, point(60, 4, 0.72));
      const continued = item.export().data;
      expect(continued.path.slice(0, -1)).toEqual(visibleBeforeContinuation);
      expect(continued.path.at(-1)).toMatchObject({ x: 60, y: 4, pressure: 0.72 });
      expect(continued.rawPath).toBeUndefined();
      expect(continued.beautification).toBeUndefined();
      tool.handleDrawingEnd();
    } finally {
      vi.useRealTimers();
    }
  });

  it('derives selection bounds from the actual pressure-sensitive outline', () => {
    const { board, tool, items } = pressureToolFixture({ size: 10, thinning: 0.5 });
    drawPressureStart(board, tool, point(0, 0, 1));
    drawPressureMove(board, tool, point(100, 0, 1));

    const bounds = Array.from(items.values())[0].getBoundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.y).toBeLessThan(-5);
    expect(bounds?.height).toBeGreaterThan(10);
    tool.handleDrawingEnd();
  });

  it('cancels the active item and its pending hold timer when the tool is unselected', () => {
    vi.useFakeTimers();
    try {
      const { board, tool, items, originalUnselected } = pressureToolFixture();
      drawPressureStart(board, tool, point(0, 0));
      for (let x = 10; x <= 50; x += 10) drawPressureMove(board, tool, point(x, 0));
      expect(items.size).toBe(1);

      tool.onToolUnselected();
      expect(items.size).toBe(0);
      expect(originalUnselected).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000);
      expect(items.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('drawing pointer classification', () => {
  it('claims only explicit Pen pointers', () => {
    expect(isExplicitPenPointer({ pointerType: 'pen' })).toBe(true);
    expect(isExplicitPenPointer({ pointerType: 'mouse' })).toBe(false);
    expect(isExplicitPenPointer({ pointerType: 'touch' })).toBe(false);
    expect(isExplicitPenPointer({ pointerType: '' })).toBe(false);
  });

  it('scopes Pencil pressure to exactly one synchronous board callback', () => {
    const board = {} as SimpleWhiteboard;
    const sample = point(4, 8, 0.91);

    expect(getActiveInkSample(board)).toBeUndefined();
    withCurrentInkSample(board, sample, () => {
      expect(getActiveInkSample(board)).toBe(sample);
    });
    expect(getActiveInkSample(board)).toBeUndefined();

    expect(() => withCurrentInkSample(board, sample, () => {
      throw new Error('drawing failed');
    })).toThrow('drawing failed');
    expect(getActiveInkSample(board)).toBeUndefined();
  });

  it('does not restart hold-to-straighten for stationary pressure jitter', () => {
    const anchor = { x: 120, y: 80 };
    expect(shouldRestartHoldTimer(anchor, { x: 120, y: 80 })).toBe(false);
    expect(shouldRestartHoldTimer(anchor, { x: 120.7, y: 80.5 })).toBe(false);
    expect(shouldRestartHoldTimer(anchor, { x: 121.6, y: 80 })).toBe(true);
  });

  it('preserves Pencil pressure and tilt with a neutral no-pressure fallback', () => {
    expect(penInkSample(
      { pressure: 0.73, tiltX: -18, tiltY: 7, timeStamp: 42 },
      { x: 12, y: 19 }
    )).toEqual({ x: 12, y: 19, pressure: 0.73, tiltX: -18, tiltY: 7, time: 42 });
    expect(penInkSample(
      { pressure: 0, tiltX: 0, tiltY: 0, timeStamp: 43 },
      { x: 3, y: 4 }
    ).pressure).toBe(0.5);
    expect(penInkSample(
      { pressure: 0, tiltX: 0, tiltY: 0, timeStamp: 43 },
      { x: 3, y: 4 },
      0.73
    ).pressure).toBe(0.73);
    expect(penInkSample(
      { pressure: Number.NaN, tiltX: 0, tiltY: 0, timeStamp: 44 },
      { x: 3, y: 4 }
    ).pressure).toBe(0.5);
    expect(penInkSample(
      { pressure: Number.POSITIVE_INFINITY, tiltX: 0, tiltY: 0, timeStamp: 45 },
      { x: 3, y: 4 }
    ).pressure).toBe(0.5);
    expect(penInkSample(
      { pressure: 1.7, tiltX: 0, tiltY: 0, timeStamp: 46 },
      { x: 3, y: 4 }
    ).pressure).toBe(1);
  });

  it('appends a missing parent sample but does not duplicate it', () => {
    const historical = pointerEvent({ clientX: 20, clientY: 30, timeStamp: 10 });
    const current = pointerEvent({
      clientX: 22,
      clientY: 32,
      timeStamp: 11,
      getCoalescedEvents: () => [historical],
    });
    expect(coalescedPenSamples(current)).toEqual([historical, current]);

    const included = pointerEvent({ clientX: 22, clientY: 32, timeStamp: 11 });
    const alreadyIncluded = pointerEvent({
      clientX: 22,
      clientY: 32,
      timeStamp: 11,
      getCoalescedEvents: () => [historical, included],
    });
    expect(coalescedPenSamples(alreadyIncluded)).toEqual([historical, included]);
  });
});

describe('whiteboard runtime window capability', () => {
  it('fails explicitly when the active Obsidian window has no registered board elements', () => {
    const ownerDocument = {
      defaultView: { customElements: { get: () => undefined } },
    } as unknown as Document;
    expect(() => assertWhiteboardRuntimeInDocument(ownerDocument))
      .toThrow(WhiteboardRuntimeCapabilityError);
  });

  it('accepts a document whose registry contains the complete whiteboard runtime', () => {
    const ownerDocument = {
      defaultView: { customElements: { get: () => class RegisteredElement {} } },
    } as unknown as Document;
    expect(() => assertWhiteboardRuntimeInDocument(ownerDocument)).not.toThrow();
  });
});

type Listener = EventListenerOrEventListenerObject;
const fakeImmediatePropagationStopped = Symbol('fake-immediate-propagation-stopped');

interface RegisteredListener {
  listener: Listener;
  capture: boolean;
}

class FakeEventTarget {
  private readonly listeners = new Map<string, RegisteredListener[]>();

  addEventListener(type: string, listener: Listener | null, options?: AddEventListenerOptions | boolean): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({
      listener,
      capture: typeof options === 'object' ? Boolean(options.capture) : Boolean(options),
    });
    this.listeners.set(type, listeners);
    const signal = typeof options === 'object' ? options.signal : undefined;
    signal?.addEventListener('abort', () => this.removeEventListener(type, listener), { once: true });
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(type, listeners.filter((candidate) => candidate.listener !== listener));
  }

  emit(type: string, event: Event): void {
    const listeners = [...(this.listeners.get(type) ?? [])]
      .sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const { listener } of listeners) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
      if ((event as Event & { [fakeImmediatePropagationStopped]?: boolean })[fakeImmediatePropagationStopped]) {
        break;
      }
    }
  }
}

class FakeCanvas extends FakeEventTarget {
  readonly style: Record<string, string> = { touchAction: '' };
  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.style, styles);
  }

  readonly ownerWindow = new FakeEventTarget();
  readonly ownerDocument = { defaultView: this.ownerWindow };
  readonly capturedPointers = new Set<number>();

  getBoundingClientRect(): DOMRect {
    return { left: 10, top: 20 } as DOMRect;
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }
}

function pointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerType: 'pen',
    pointerId: 7,
    button: 0,
    clientX: 15,
    clientY: 26,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 100,
    preventDefault: vi.fn(),
    getCoalescedEvents: () => [],
    ...overrides,
  } as PointerEvent;
}

function touchEvent(
  changedIdentifiers: number[],
  activeIdentifiers: number[] = changedIdentifiers
): TouchEvent {
  const touch = (identifier: number): Touch => ({ identifier } as Touch);
  const event = {
    changedTouches: changedIdentifiers.map(touch) as unknown as TouchList,
    touches: activeIdentifiers.map(touch) as unknown as TouchList,
    preventDefault: vi.fn(),
  } as unknown as TouchEvent & { [fakeImmediatePropagationStopped]?: boolean };
  event.stopImmediatePropagation = vi.fn(() => {
    event[fakeImmediatePropagationStopped] = true;
  });
  return event;
}

interface FakeWhiteboardItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

function cloneFakeItems(items: FakeWhiteboardItem[]): FakeWhiteboardItem[] {
  return JSON.parse(JSON.stringify(items)) as FakeWhiteboardItem[];
}

function serializeFakeItems(items: FakeWhiteboardItem[]): string {
  return JSON.stringify(items);
}

function adapterFixture(options: {
  cancelActiveStroke?: () => void;
  emulateLibraryTouchStart?: boolean;
  areaExportActive?: boolean;
  history?: FakeWhiteboardItem[][];
  currentTool?: string;
  selectedItemId?: string | null;
  onDrawingStart?: (items: FakeWhiteboardItem[], interactionNumber: number) => void;
  disableUndo?: boolean;
} = {}): {
  adapter: WhiteboardInputAdapter;
  board: SimpleWhiteboard;
  canvas: FakeCanvas;
  start: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
  getItems: () => FakeWhiteboardItem[];
} {
  const start = vi.fn();
  const move = vi.fn();
  const end = vi.fn();
  let interacting = false;
  let currentTool = options.currentTool ?? 'pen';
  let selectedItemId = options.selectedItemId ?? null;
  let history = (options.history ?? [[]]).map(cloneFakeItems);
  if (history.length === 0) history = [[]];
  let historyIndex = history.length - 1;
  let items = cloneFakeItems(history[historyIndex]);
  const legacyMouseDown = vi.fn();
  const legacyTouchStart = vi.fn();
  const tool = options.cancelActiveStroke ? { cancelActiveStroke: options.cancelActiveStroke } : {};

  const commitHistory = (): void => {
    if (serializeFakeItems(items) === serializeFakeItems(history[historyIndex])) return;
    history = history.slice(0, historyIndex + 1);
    history.push(cloneFakeItems(items));
    historyIndex = history.length - 1;
  };
  const undo = vi.fn(() => {
    // simple-whiteboard commits the live state before moving its public history
    // cursor. handleDrawingEnd already did so in the ordinary rollback path.
    commitHistory();
    if (options.disableUndo || historyIndex <= 0) return;
    historyIndex -= 1;
    items = cloneFakeItems(history[historyIndex]);
    selectedItemId = null;
  });
  const board = {
    handleDrawingStart: vi.fn((x: number, y: number) => {
      commitHistory();
      interacting = true;
      start(x, y);
      options.onDrawingStart?.(items, start.mock.calls.length);
    }),
    handleDrawingMove: move,
    handleDrawingEnd: vi.fn(() => {
      interacting = false;
      end();
      commitHistory();
    }),
    getCurrentTool: () => currentTool,
    setCurrentTool: vi.fn((toolName: string) => { currentTool = toolName; }),
    getToolInstance: () => tool,
    isInteracting: () => interacting,
    exportItems: vi.fn(() => cloneFakeItems(items)),
    canUndo: () => !options.disableUndo && historyIndex > 0,
    undo,
    getSelectedItemId: () => selectedItemId,
    setSelectedItemId: vi.fn((itemId: string | null) => { selectedItemId = itemId; }),
    draw: vi.fn(),
    handleMouseDown: legacyMouseDown,
    handleTouchStart: legacyTouchStart,
  } as unknown as SimpleWhiteboard;
  const canvas = new FakeCanvas();
  if (options.emulateLibraryTouchStart) {
    canvas.addEventListener('touchstart', (event) => {
      if (options.areaExportActive) return;
      const touch = event as TouchEvent;
      board.handleDrawingStart(touch.touches[0]?.clientX ?? 0, touch.touches[0]?.clientY ?? 0);
    });
  }
  const adapter = new WhiteboardInputAdapter(board, canvas as unknown as HTMLCanvasElement);
  expect(board.handleMouseDown).toBe(legacyMouseDown);
  expect(board.handleTouchStart).toBe(legacyTouchStart);
  return {
    adapter,
    board,
    canvas,
    start,
    move,
    end,
    undo,
    getItems: () => cloneFakeItems(items),
  };
}

describe('whiteboard Pencil input adapter', () => {
  it('leaves mouse and touch pointers to simple-whiteboard', () => {
    const { adapter, canvas, start } = adapterFixture();
    const mouse = pointerEvent({ pointerType: 'mouse', pressure: 0.2, tiltX: 18 });
    const touch = pointerEvent({ pointerType: 'touch' });

    canvas.emit('pointerdown', mouse as unknown as Event);
    canvas.emit('pointerdown', touch as unknown as Event);

    expect(start).not.toHaveBeenCalled();
    expect(mouse.preventDefault).not.toHaveBeenCalled();
    expect(touch.preventDefault).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it('locks an explicit Pen contact and forwards all coalesced samples', () => {
    const { adapter, canvas, start, move, end } = adapterFixture();
    const down = pointerEvent();
    const samples = [
      pointerEvent({ clientX: 18, clientY: 29, pressure: 0.2, timeStamp: 110 }),
      pointerEvent({ clientX: 22, clientY: 35, pressure: 0.8, timeStamp: 120 }),
    ];
    // WKWebView may expose a compatibility-looking type after pointerdown. The
    // pointer ID, not a fresh heuristic, owns the rest of this contact.
    const moveEvent = pointerEvent({
      pointerType: 'mouse',
      clientX: 24,
      clientY: 36,
      timeStamp: 130,
      getCoalescedEvents: () => samples,
    });

    canvas.emit('pointerdown', down as unknown as Event);
    canvas.emit('pointermove', moveEvent as unknown as Event);
    const up = pointerEvent({ clientX: 25, clientY: 37, timeStamp: 140 });
    canvas.emit('pointerup', up as unknown as Event);
    // This is what the browser does after the canvas handler: the same event
    // continues to the owner window. Cleanup must remain idempotent.
    canvas.ownerWindow.emit('pointerup', up as unknown as Event);

    expect(start).toHaveBeenCalledWith(5, 6);
    expect(move.mock.calls).toEqual([[8, 9], [12, 15], [14, 16], [15, 17]]);
    expect(end).toHaveBeenCalledTimes(1);
    expect(canvas.capturedPointers.has(7)).toBe(false);
    adapter.destroy();
  });

  it('drops getCoalescedEvents samples a later pointermove redelivers, instead of appending them again', () => {
    // Some WebKit builds hand back overlapping batches: the tail of one
    // pointermove's coalesced samples reappears as the head of the next.
    // Forwarding those again made the recorded path double back on itself
    // over and over, which rendered as a dotted/broken line even though the
    // Pencil never left the surface.
    const { adapter, canvas, move } = adapterFixture();
    canvas.emit('pointerdown', pointerEvent({ timeStamp: 100 }) as unknown as Event);

    const firstBatch = [
      pointerEvent({ clientX: 18, clientY: 29, timeStamp: 110 }),
      pointerEvent({ clientX: 22, clientY: 35, timeStamp: 120 }),
    ];
    canvas.emit('pointermove', pointerEvent({
      clientX: 24,
      clientY: 36,
      timeStamp: 130,
      getCoalescedEvents: () => firstBatch,
    }) as unknown as Event);

    const secondBatch = [
      pointerEvent({ clientX: 22, clientY: 35, timeStamp: 120 }),
      pointerEvent({ clientX: 24, clientY: 36, timeStamp: 130 }),
      pointerEvent({ clientX: 26, clientY: 38, timeStamp: 140 }),
    ];
    canvas.emit('pointermove', pointerEvent({
      clientX: 27,
      clientY: 39,
      timeStamp: 150,
      getCoalescedEvents: () => secondBatch,
    }) as unknown as Event);

    expect(move.mock.calls).toEqual([
      [8, 9], [12, 15], [14, 16],
      [16, 18], [17, 19],
    ]);
    adapter.destroy();
  });

  it('uses the last contact pressure for a pressure-zero pointerup sample', () => {
    const { adapter, board, canvas, move, end } = adapterFixture();
    const forwardedPressures: Array<number | undefined> = [];
    move.mockImplementation(() => forwardedPressures.push(getActiveInkSample(board)?.pressure));

    canvas.emit('pointerdown', pointerEvent({ pressure: 0.24, timeStamp: 100 }) as unknown as Event);
    canvas.emit('pointermove', pointerEvent({
      clientX: 25,
      clientY: 36,
      pressure: 0.82,
      timeStamp: 110,
    }) as unknown as Event);
    canvas.emit('pointerup', pointerEvent({
      clientX: 26,
      clientY: 37,
      pressure: 0,
      timeStamp: 120,
    }) as unknown as Event);

    expect(forwardedPressures).toEqual([0.82, 0.82]);
    expect(end).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it('uses the window only as an ID-filtered end fallback and keeps the final sample', () => {
    const { adapter, canvas, move, end } = adapterFixture();
    canvas.emit('pointerdown', pointerEvent({ pointerId: 4 }) as unknown as Event);
    const unrelated = pointerEvent({ pointerId: 99 });
    const matching = pointerEvent({ pointerId: 4, clientX: 32, clientY: 48, timeStamp: 180 });

    canvas.ownerWindow.emit('pointerup', unrelated as unknown as Event);
    expect(end).not.toHaveBeenCalled();
    expect(unrelated.preventDefault).not.toHaveBeenCalled();

    canvas.ownerWindow.emit('pointerup', matching as unknown as Event);
    expect(end).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(22, 28);
    expect(canvas.capturedPointers.has(4)).toBe(false);
    expect(matching.preventDefault).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it('balances built-in tools and calls an optional pressure-tool rollback on cancel', () => {
    const cancel = vi.fn();
    const { adapter, canvas, end } = adapterFixture({ cancelActiveStroke: cancel });
    canvas.emit('pointerdown', pointerEvent() as unknown as Event);
    canvas.emit('pointercancel', pointerEvent() as unknown as Event);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it('removes canvas and owner-window listeners when destroyed', () => {
    const { adapter, canvas, start, end } = adapterFixture();
    canvas.emit('pointerdown', pointerEvent() as unknown as Event);
    adapter.destroy();
    expect(end).toHaveBeenCalledTimes(1);

    canvas.emit('pointerdown', pointerEvent({ pointerId: 8 }) as unknown as Event);
    canvas.ownerWindow.emit('pointerup', pointerEvent({ pointerId: 8 }) as unknown as Event);
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('suppresses only palm touch sequences that overlap an active Pen contact', () => {
    const { adapter, canvas } = adapterFixture();
    const ordinaryTouch = touchEvent([1]);
    canvas.emit('touchstart', ordinaryTouch as unknown as Event);
    expect(ordinaryTouch.preventDefault).not.toHaveBeenCalled();
    canvas.emit('touchend', touchEvent([1], []) as unknown as Event);

    canvas.emit('pointerdown', pointerEvent() as unknown as Event);
    const palmStart = touchEvent([12]);
    canvas.emit('touchstart', palmStart as unknown as Event);
    expect(palmStart.preventDefault).toHaveBeenCalledTimes(1);
    expect(palmStart.stopImmediatePropagation).toHaveBeenCalledTimes(1);

    canvas.emit('pointerup', pointerEvent() as unknown as Event);
    const palmEnd = touchEvent([12], []);
    canvas.emit('touchend', palmEnd as unknown as Event);
    expect(palmEnd.preventDefault).toHaveBeenCalledTimes(1);

    const nextTouch = touchEvent([13]);
    canvas.emit('touchstart', nextTouch as unknown as Event);
    expect(nextTouch.preventDefault).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it('ends a prior finger tool interaction before accepting the Pencil', () => {
    const cancel = vi.fn();
    const { adapter, board, canvas, start, end } = adapterFixture({
      cancelActiveStroke: cancel,
      emulateLibraryTouchStart: true,
    });
    canvas.emit('touchstart', touchEvent([21]) as unknown as Event);
    expect(start).toHaveBeenCalledTimes(1);

    const penDown = pointerEvent({ pointerId: 9 });
    canvas.emit('pointerdown', penDown as unknown as Event);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    expect(board.isInteracting()).toBe(true);
    expect(penDown.preventDefault).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it('undoes a built-in item creation before pinch and preserves older undo history', () => {
    const olderItems: FakeWhiteboardItem[] = [{
      id: 'older',
      type: 'rect',
      data: { x1: 0, y1: 0, x2: 5, y2: 5 },
    }];
    const itemsAtTouchStart: FakeWhiteboardItem[] = [{
      id: 'existing',
      type: 'rect',
      data: { x1: 10, y1: 10, x2: 30, y2: 30 },
    }];
    const partialItem: FakeWhiteboardItem = {
      id: 'partial',
      type: 'circle',
      data: { x1: 40, y1: 40, x2: 40, y2: 40 },
    };
    const { adapter, board, canvas, start, end, undo, getItems } = adapterFixture({
      emulateLibraryTouchStart: true,
      history: [olderItems, itemsAtTouchStart],
      onDrawingStart: (items, interactionNumber) => {
        if (interactionNumber === 1) items.push(cloneFakeItems([partialItem])[0]);
      },
    });

    canvas.emit('touchstart', touchEvent([1], [1]) as unknown as Event);
    expect(getItems()).toEqual([...itemsAtTouchStart, partialItem]);
    canvas.emit('touchstart', touchEvent([2], [1, 2]) as unknown as Event);

    expect(getItems()).toEqual(itemsAtTouchStart);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(board.canUndo()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect((board as unknown as { clear?: unknown }).clear).toBeUndefined();
    expect((board as unknown as { importItems?: unknown }).importItems).toBeUndefined();

    canvas.emit('touchend', touchEvent([1], [2]) as unknown as Event);
    canvas.emit('touchend', touchEvent([2], []) as unknown as Event);
    adapter.destroy();
  });

  it('restores eraser deletions, selection, and tool state exactly before pinch', () => {
    const itemsAtTouchStart: FakeWhiteboardItem[] = [
      { id: 'keep-selected', type: 'rect', data: { x1: 0, y1: 0, x2: 20, y2: 20 } },
      { id: 'erased', type: 'pen', data: { path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } },
    ];
    const { adapter, board, canvas, undo, getItems } = adapterFixture({
      emulateLibraryTouchStart: true,
      history: [itemsAtTouchStart],
      currentTool: 'eraser',
      selectedItemId: 'keep-selected',
      onDrawingStart: (items, interactionNumber) => {
        if (interactionNumber === 1) items.splice(1, 1);
      },
    });

    canvas.emit('touchstart', touchEvent([10], [10]) as unknown as Event);
    expect(getItems()).toEqual([itemsAtTouchStart[0]]);
    board.setCurrentTool('pointer');
    board.setSelectedItemId(null);
    canvas.emit('touchstart', touchEvent([11], [10, 11]) as unknown as Event);

    expect(getItems()).toEqual(itemsAtTouchStart);
    expect(board.getCurrentTool()).toBe('eraser');
    expect(board.getSelectedItemId()).toBe('keep-selected');
    expect(undo).toHaveBeenCalledTimes(1);

    canvas.emit('touchend', touchEvent([10], [11]) as unknown as Event);
    canvas.emit('touchend', touchEvent([11], []) as unknown as Event);
    adapter.destroy();
  });

  it('undoes a built-in item update before Pencil takes over the finger contact', () => {
    const itemsAtTouchStart: FakeWhiteboardItem[] = [{
      id: 'moved',
      type: 'rect',
      data: { x1: 5, y1: 5, x2: 25, y2: 25 },
    }];
    const { adapter, board, canvas, start, end, undo, getItems } = adapterFixture({
      emulateLibraryTouchStart: true,
      history: [itemsAtTouchStart],
      onDrawingStart: (items, interactionNumber) => {
        if (interactionNumber === 1) items[0].data.x1 = 99;
      },
    });

    canvas.emit('touchstart', touchEvent([21], [21]) as unknown as Event);
    expect(getItems()[0].data.x1).toBe(99);
    const penDown = pointerEvent({ pointerId: 22 });
    canvas.emit('pointerdown', penDown as unknown as Event);

    expect(getItems()).toEqual(itemsAtTouchStart);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(1);
    expect(board.isInteracting()).toBe(true);
    expect(penDown.preventDefault).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it('fails closed for the complete touch sequence when public undo cannot restore it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const originalItems: FakeWhiteboardItem[] = [{ id: 'before', type: 'rect', data: { x1: 1 } }];
      const { adapter, canvas, start } = adapterFixture({
        emulateLibraryTouchStart: true,
        history: [originalItems],
        disableUndo: true,
        onDrawingStart: (items, interactionNumber) => {
          if (interactionNumber === 1) {
            items.push({ id: 'unrecoverable', type: 'rect', data: { x1: 2 } });
          }
        },
      });

      canvas.emit('touchstart', touchEvent([31], [31]) as unknown as Event);
      const secondTouch = touchEvent([32], [31, 32]);
      canvas.emit('touchstart', secondTouch as unknown as Event);
      const remainingMove = touchEvent([], [31, 32]);
      canvas.emit('touchmove', remainingMove as unknown as Event);

      expect(start).toHaveBeenCalledTimes(1);
      expect(secondTouch.preventDefault).toHaveBeenCalledTimes(1);
      expect(secondTouch.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      expect(remainingMove.preventDefault).toHaveBeenCalledTimes(1);
      expect(remainingMove.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledTimes(1);

      canvas.emit('touchend', touchEvent([31], [32]) as unknown as Event);
      canvas.emit('touchend', touchEvent([32], []) as unknown as Event);
      adapter.destroy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not let the library start an orphan tool when a second finger initializes pinch', () => {
    const cancel = vi.fn();
    const { adapter, canvas, start, end } = adapterFixture({
      cancelActiveStroke: cancel,
      emulateLibraryTouchStart: true,
    });
    canvas.emit('touchstart', touchEvent([1], [1]) as unknown as Event);
    canvas.emit('touchstart', touchEvent([2], [1, 2]) as unknown as Event);

    expect(start).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);

    canvas.emit('touchend', touchEvent([1], [2]) as unknown as Event);
    canvas.emit('touchend', touchEvent([2], []) as unknown as Event);
    adapter.destroy();
  });

  it('suppresses a single-finger touch that lands just after a pinch/pan gesture ends, but not one that lands later', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const { adapter, canvas, start } = adapterFixture({ emulateLibraryTouchStart: true });
      canvas.emit('touchstart', touchEvent([1], [1]) as unknown as Event);
      canvas.emit('touchstart', touchEvent([2], [1, 2]) as unknown as Event);
      canvas.emit('touchend', touchEvent([1], [2]) as unknown as Event);
      canvas.emit('touchend', touchEvent([2], []) as unknown as Event);
      expect(start).toHaveBeenCalledTimes(1);

      vi.setSystemTime(10_100);
      const tooSoon = touchEvent([3], [3]);
      canvas.emit('touchstart', tooSoon as unknown as Event);
      expect(start).toHaveBeenCalledTimes(1);
      expect(tooSoon.preventDefault).toHaveBeenCalledTimes(1);
      expect(tooSoon.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      canvas.emit('touchend', touchEvent([3], []) as unknown as Event);

      vi.setSystemTime(10_400);
      const later = touchEvent([4], [4]);
      canvas.emit('touchstart', later as unknown as Event);
      expect(start).toHaveBeenCalledTimes(2);
      expect(later.preventDefault).not.toHaveBeenCalled();
      canvas.emit('touchend', touchEvent([4], []) as unknown as Event);
      adapter.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an active area-export touch sequence in the native library path', () => {
    const { adapter, canvas, start, end } = adapterFixture({
      emulateLibraryTouchStart: true,
      areaExportActive: true,
    });
    canvas.emit('touchstart', touchEvent([31]) as unknown as Event);
    const penDown = pointerEvent({ pointerId: 10 });
    canvas.emit('pointerdown', penDown as unknown as Event);

    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(penDown.preventDefault).not.toHaveBeenCalled();
    adapter.destroy();
  });
});

describe('editable SVG drawing format', () => {
  const viewBox = (svg: string): [number, number, number, number] => {
    const match = svg.match(/viewBox="([^"]+)"/);
    if (!match) throw new Error('SVG has no viewBox');
    return match[1].split(/\s+/).map(Number) as [number, number, number, number];
  };

  it('exports a stroke at the same width the canvas renders it at', () => {
    // The exporter used to call getStroke() without the shared easing, which
    // silently made every saved drawing ~35% thinner than what was drawn.
    const options: PressurePenOptions = { color: '#000000', size: 8, thinning: 0.6 };
    const path: InkPoint[] = Array.from({ length: 30 }, (_, i) => point(i * 4, 50, 0.5));
    const svg = createDrawingSvg([{ id: 'stroke', type: 'pen', data: { path, options } }]);

    const canvasOutline = getStroke(
      path.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure })),
      penStrokeOptions(options, options.size)
    );
    const canvasYs = canvasOutline.filter(([x]) => Math.abs(x - 58) < 3).map(([, y]) => y);
    const canvasWidth = Math.max(...canvasYs) - Math.min(...canvasYs);

    const svgYs = Array.from(svg.matchAll(/[ML]?(-?[\d.]+),(-?[\d.]+)/g))
      .map((m) => [Number(m[1]), Number(m[2])] as const)
      .filter(([x]) => Math.abs(x - 58) < 3)
      .map(([, y]) => y);
    const svgWidth = Math.max(...svgYs) - Math.min(...svgYs);

    expect(svgWidth).toBeCloseTo(canvasWidth, 1);
  });

  it('keeps pressure data in SVG metadata and produces a regular SVG preview', () => {
    const items = [{
      id: 'stroke-1',
      type: 'pen',
      data: {
        path: [point(1, 2, 0.1), point(12, 8, 0.9), point(20, 3, 0.4)],
        options: { color: '#123456', size: 5, thinning: 0.5 },
      },
    }];
    const svg = createDrawingSvg(items);
    const parsed = parseDrawingSvg(svg);
    expect(svg).toContain('<svg');
    expect(svg).toContain('eome-drawing-data');
    expect(svg).toContain('fill="#ffffff"');
    expect(parsed?.items).toEqual(items);
  });

  it('recognizes standard Obsidian SVG embeds with aliases', () => {
    expect(extractDrawingLink('![[Drawings/Idea.svg|480]]')).toBe('Drawings/Idea.svg');
  });

  it('matches simple-whiteboard multiline text anchors and open arrow geometry', () => {
    const svg = createDrawingSvg([
      { id: 'text', type: 'text', data: { x: 10, y: 20, content: 'One\nTwo', options: { fontSize: 16, color: '#112233' } } },
      { id: 'arrow', type: 'arrow', data: { x1: 0, y1: 0, x2: 50, y2: 30, options: { stroke: '#000000', strokeWidth: 2 } } },
    ]);
    expect(svg).toContain('<tspan x="10" y="36">One</tspan>');
    expect(svg).toContain('<tspan x="10" y="52">Two</tspan>');
    expect(svg.match(/<line /g)).toHaveLength(3);
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('context-stroke');
  });

  it('keeps the editor maximum line width and its round caps inside the viewBox', () => {
    const svg = createDrawingSvg([
      { id: 'line', type: 'line', data: { x1: 0, y1: 0, x2: 100, y2: 0, options: { stroke: '#000000', strokeWidth: 50 } } },
    ]);
    const [x, y, width, height] = viewBox(svg);

    // Painted line bounds are [-25,-25]..[125,25], followed by the format's
    // intentional 20-unit document padding.
    expect(x).toBe(-45);
    expect(y).toBe(-45);
    expect(width).toBe(190);
    expect(height).toBe(90);
  });

  it('includes simple-whiteboard arrowhead arms and their stroke radius in bounds', () => {
    const strokeWidth = 10;
    const headLength = 12 + strokeWidth * 2;
    const headExtentY = Math.sin(Math.PI / 7) * headLength;
    const svg = createDrawingSvg([
      { id: 'arrow', type: 'arrow', data: { x1: 0, y1: 0, x2: 100, y2: 0, options: { stroke: '#000000', strokeWidth } } },
    ]);
    const [x, y, width, height] = viewBox(svg);

    expect(x).toBe(-25);
    expect(x + width).toBe(125);
    expect(y).toBeCloseTo(-headExtentY - strokeWidth / 2 - 20, 8);
    expect(y + height).toBeCloseTo(headExtentY + strokeWidth / 2 + 20, 8);
    expect(svg.match(/<line /g)).toHaveLength(3);
  });

  it('uses the editor text baseline and bounding-box origin in SVG coordinates', () => {
    const svg = createDrawingSvg([
      { id: 'text', type: 'text', data: { x: 10, y: 20, content: 'One\nTwo', options: { fontSize: 16, fontFamily: 'sans-serif', color: '#112233' } } },
    ]);
    const [, y, , height] = viewBox(svg);

    expect(svg).toContain('<tspan x="10" y="36">One</tspan>');
    expect(svg).toContain('<tspan x="10" y="52">Two</tspan>');
    expect(y).toBe(-5);
    expect(y + height).toBe(87);
  });

  it('does not emit external image requests or CSS URL colors', () => {
    const svg = createDrawingSvg([
      { id: 'remote', type: 'picture', data: { x1: 0, y1: 0, x2: 20, y2: 20, src: 'https://example.com/tracker.png' } },
      { id: 'rect', type: 'rect', data: { x1: 0, y1: 0, x2: 20, y2: 20, options: { stroke: 'url(https://example.com/x)', fill: 'transparent' } } },
    ]);
    expect(svg).not.toContain('example.com');
    expect(svg).toContain('stroke="#000000"');
  });
});

describe('pen preferences persistence', () => {
  const fakePlugin = (initial: Record<string, unknown> | null = null) => {
    let data = initial;
    return {
      plugin: {
        loadData: vi.fn(async () => data),
        saveData: vi.fn(async (next: Record<string, unknown>) => { data = next; }),
      },
      current: () => data,
    };
  };

  it('restores a stored size and colour', async () => {
    const { plugin } = fakePlugin({ pen: { size: 12, color: '#ff8800' } });
    const store = new PenPreferenceStore(plugin as unknown as Plugin);
    expect(await store.load()).toEqual({ size: 12, color: '#ff8800' });
  });

  it('falls back to defaults when nothing is stored yet', async () => {
    const { plugin } = fakePlugin(null);
    const store = new PenPreferenceStore(plugin as unknown as Plugin);
    expect(await store.load()).toEqual(DEFAULT_PEN_PREFERENCES);
  });

  it('rejects values that a hand-edited or older data file could contain', async () => {
    const { plugin } = fakePlugin({
      pen: { size: 9999, color: 'url(https://example.com/x)' },
    });
    const store = new PenPreferenceStore(plugin as unknown as Plugin);
    const loaded = await store.load();
    expect(loaded.size).toBe(40);
    expect(loaded.color).toBe(DEFAULT_PEN_PREFERENCES.color);
  });

  it('keeps unrelated plugin data intact when saving', async () => {
    const { plugin, current } = fakePlugin({ somethingElse: { keep: true } });
    const store = new PenPreferenceStore(plugin as unknown as Plugin);
    await store.save({ size: 7, color: '#123456' });
    expect(current()).toEqual({
      somethingElse: { keep: true },
      pen: { size: 7, color: '#123456' },
    });
  });
});
