import { getStroke } from 'perfect-freehand';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import type { SimpleWhiteboard, ItemLib, ToolLib } from '@ludovicm67/simple-whiteboard';
import type { DrawingContext, ResizeHandle } from '@ludovicm67/simple-whiteboard/dist/lib/types';
import type { ExportedWhiteboardItem } from '@ludovicm67/simple-whiteboard/dist/lib/item';
import { beautifyStroke, interpolateStroke } from './shape-beautifier';
import {
  PEN_DEFAULT_SIZE,
  PEN_SIZE_RANGE,
  PEN_SMOOTHING,
  PEN_STREAMLINE,
  PEN_THINNING,
  penStrokeOptions,
} from './pen-stroke-options';
import type { InkPoint, PressurePenData, PressurePenOptions } from './types';

type ItemBase = typeof ItemLib.WhiteboardItem;
type ToolBase = typeof ToolLib.WhiteboardTool;

const currentSamples = new WeakMap<SimpleWhiteboard, InkPoint>();

const PEN_COLORS = ['#000000', '#ff1a40', '#29b312', '#135aa0', '#fc8653'];

/**
 * Bridges one synchronous PointerEvent sample into simple-whiteboard's
 * coordinate-only drawing callback. The sample deliberately exists only for
 * the duration of that callback, so a later native mouse/touch stroke can
 * never inherit stale Pencil pressure or tilt.
 */
export function withCurrentInkSample<T>(
  board: SimpleWhiteboard,
  sample: InkPoint,
  callback: () => T
): T {
  const previous = currentSamples.get(board);
  currentSamples.set(board, sample);
  try {
    return callback();
  } finally {
    if (previous) currentSamples.set(board, previous);
    else currentSamples.delete(board);
  }
}

export function getActiveInkSample(board: SimpleWhiteboard): InkPoint | undefined {
  return currentSamples.get(board);
}

export function shouldRestartHoldTimer(
  anchor: { x: number; y: number },
  next: { x: number; y: number },
  movementThreshold = 1.5
): boolean {
  return Math.hypot(next.x - anchor.x, next.y - anchor.y) >= movementThreshold;
}

function replaceEndpointSample(
  path: InkPoint[],
  sample: InkPoint,
  preservePosition: boolean
): InkPoint[] {
  if (path.length === 0) return path;
  const previous = path[path.length - 1];
  const endpoint = preservePosition
    ? { ...sample, x: previous.x, y: previous.y }
    : sample;
  return [...path.slice(0, -1), endpoint];
}

interface CanvasInkPoint {
  x: number;
  y: number;
  pressure: number;
}

/**
 * Pointer sampling is time-throttled, not distance-throttled: a fast stroke
 * leaves large screen-space gaps between raw points regardless of zoom, while
 * the rendered stroke width shrinks with zoom. Without this, perfect-freehand
 * can pinch or break the outline wherever a gap is wide relative to the
 * current on-screen width. Interpolating extra points keeps spacing
 * proportional to that width so the outline stays continuous at any zoom or
 * drawing speed.
 */
function densifyForStrokeWidth(points: CanvasInkPoint[], strokeWidth: number): CanvasInkPoint[] {
  if (points.length < 2) return points;
  const maxSpacing = Math.max(1, strokeWidth / 4);
  const result: CanvasInkPoint[] = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    const steps = Math.min(64, Math.floor(distance / maxSpacing));
    for (let step = 1; step <= steps; step++) {
      const t = step / (steps + 1);
      result.push({
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
        pressure: previous.pressure + (current.pressure - previous.pressure) * t,
      });
    }
    result.push(current);
  }
  return result;
}

/**
 * With `simulatePressure: false` (needed because we supply real per-sample
 * pressure), this bundled perfect-freehand version skips its own internal
 * pressure averaging entirely - that path only runs when simulatePressure is
 * true. Each raw sample's pressure then drives its outline radius directly,
 * so ordinary sensor-level noise in real Pencil pressure - amplified by a
 * high `thinning` - pinches the stroke down to near-zero width over and over,
 * rendering as a dotted/beaded line instead of continuous ink even while the
 * pen never left the surface. A short centered moving average smooths that
 * noise out while still tracking genuine, slower pressure changes (pressing
 * down harder mid-stroke).
 */
function smoothPressures(points: readonly { pressure: number }[], window = 5): number[] {
  const half = Math.floor(window / 2);
  return points.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -half; offset <= half; offset++) {
      const sample = points[index + offset];
      if (sample) {
        sum += sample.pressure;
        count++;
      }
    }
    return sum / count;
  });
}

function strokePath(points: number[][]): string {
  if (points.length < 4) return '';
  const average = (a: number, b: number): number => (a + b) / 2;
  const first = points[0];
  const second = points[1];
  const third = points[2];
  let path = `M${first[0].toFixed(2)},${first[1].toFixed(2)} Q${second[0].toFixed(2)},${second[1].toFixed(2)} ${average(second[0], third[0]).toFixed(2)},${average(second[1], third[1]).toFixed(2)} T`;
  for (let index = 2; index < points.length - 1; index++) {
    path += `${average(points[index][0], points[index + 1][0]).toFixed(2)},${average(points[index][1], points[index + 1][1]).toFixed(2)} `;
  }
  return `${path}Z`;
}

export interface PressurePenToolControl {
  scheduleBeautification(): void;
  cancelActiveStroke(): void;
  /** The pen's live size/colour, for persisting them between sessions. */
  getPenOptions(): PressurePenOptions;
  /** Applies restored preferences; the tool options UI reflects them immediately. */
  applyPenOptions(options: Partial<PressurePenOptions>): void;
}

export function createPressurePenTool(
  board: SimpleWhiteboard,
  itemBase: ItemBase,
  toolBase: ToolBase,
  originalPen: ReturnType<SimpleWhiteboard['getToolInstance']>
): ToolLib.WhiteboardTool<ItemLib.WhiteboardItem<PressurePenData>> & PressurePenToolControl {
  const boardWindow = board.ownerDocument.defaultView ?? window;
  class PressurePenItem extends itemBase<PressurePenData> {
    private path: InkPoint[];
    private rawPath?: InkPoint[];
    private beautification?: PressurePenData['beautification'];
    private options: PressurePenOptions;

    constructor(data: PressurePenData, id?: string) {
      super(data, id);
      this.path = data.path;
      this.rawPath = data.rawPath;
      this.beautification = data.beautification;
      this.options = data.options;
    }

    getType(): string { return 'pen'; }

    export(): ExportedWhiteboardItem<PressurePenData> {
      return {
        id: this.getId(),
        type: 'pen',
        data: {
          path: this.path,
          ...(this.rawPath ? { rawPath: this.rawPath } : {}),
          ...(this.beautification ? { beautification: this.beautification } : {}),
          options: this.options,
        },
      };
    }

    partialUpdate(data: Partial<PressurePenData>): void {
      this.path = data.path ?? this.path;
      if ('rawPath' in data) this.rawPath = data.rawPath;
      if ('beautification' in data) this.beautification = data.beautification;
      this.options = data.options ?? this.options;
    }

    update(data: PressurePenData): void {
      this.path = data.path;
      this.rawPath = data.rawPath;
      this.beautification = data.beautification;
      this.options = data.options;
    }

    getOptions(): PressurePenOptions { return this.options; }
    setOptions(options: PressurePenOptions): void { this.options = options; }
    updateOptions(options: Partial<PressurePenOptions>): void { this.options = { ...this.options, ...options }; }

    draw(context: DrawingContext): void {
      const zoom = context.coords.getZoom();
      const strokeWidth = this.options.size * zoom;
      const smoothedPressures = smoothPressures(this.path);
      const rawInput = this.path.map((point, index) => {
        const canvasPoint = context.coords.convertToCanvas(point.x, point.y);
        return { x: canvasPoint.x, y: canvasPoint.y, pressure: smoothedPressures[index] };
      });
      const input = densifyForStrokeWidth(rawInput, strokeWidth);
      const outline = getStroke(input, penStrokeOptions(this.options, strokeWidth));
      const pathData = strokePath(outline);
      if (!pathData) return;
      const previousFill = context.canvas.fillStyle;
      context.canvas.fillStyle = this.options.color;
      context.canvas.fill(new Path2D(pathData));
      context.canvas.fillStyle = previousFill;
    }

    getBoundingBox(): { x: number; y: number; width: number; height: number } | null {
      if (this.path.length === 0) return null;
      const smoothedPressures = smoothPressures(this.path);
      const outline = getStroke(this.path.map((point, index) => ({
        x: point.x,
        y: point.y,
        pressure: smoothedPressures[index],
      })), penStrokeOptions(this.options, this.options.size));
      if (outline.length === 0) return null;
      let minX = outline[0][0];
      let minY = outline[0][1];
      let maxX = minX;
      let maxY = minY;
      for (const point of outline) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    relativeMoveOperation(dx: number, dy: number): Partial<PressurePenData> {
      const move = (points: InkPoint[]): InkPoint[] => points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
      return {
        path: move(this.path),
        ...(this.rawPath ? { rawPath: move(this.rawPath) } : {}),
      };
    }

    isHitByEraser(x: number, y: number, radius: number): boolean {
      const threshold = radius + this.options.size / 2;
      return this.path.some((point) => Math.hypot(point.x - x, point.y - y) <= threshold);
    }

    isResizable(): boolean { return true; }

    relativeResizeOperation(dx: number, dy: number, name: string): Partial<PressurePenData> | null {
      if (name !== 'bottom-right') return null;
      const bounds = this.getBoundingBox();
      if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
      const scaleX = Math.max(0.05, (bounds.width + dx) / bounds.width);
      const scaleY = Math.max(0.05, (bounds.height + dy) / bounds.height);
      const resize = (points: InkPoint[]): InkPoint[] => points.map((point) => ({
        ...point,
        x: bounds.x + (point.x - bounds.x) * scaleX,
        y: bounds.y + (point.y - bounds.y) * scaleY,
      }));
      return {
        path: resize(this.path),
        ...(this.rawPath ? { rawPath: resize(this.rawPath) } : {}),
      };
    }

    getResizeHandles(): ResizeHandle[] {
      const bounds = this.getBoundingBox();
      return bounds ? [{ name: 'bottom-right', x: bounds.x + bounds.width, y: bounds.y + bounds.height }] : [];
    }
  }

  class PressurePenTool extends toolBase<PressurePenItem> implements PressurePenToolControl {
    private currentItemId: string | null = null;
    private rawPath: InkPoint[] = [];
    private visiblePath: InkPoint[] = [];
    private holdTimer: number | null = null;
    private animationFrame: number | null = null;
    private animationTarget: InkPoint[] | null = null;
    private animationSource: InkPoint[] | null = null;
    private activeBeautification: PressurePenData['beautification'] = undefined;
    private isDrawing = false;
    private holdAnchor: { x: number; y: number } | null = null;
    private beautifiedWhileHeld = false;

    constructor() {
      super(board, (data: PressurePenData, id?: string) => new PressurePenItem(data, id));
    }

    getName(): string { return 'pen'; }
    getIcon(): TemplateResult | null { return originalPen?.getIcon() ?? null; }

    // The library's own size slider only has ~8 steps (step=7 across 1-50) and
    // its default doesn't even land on one, so the first drag visibly jumps
    // the stroke width. Render our own finer control instead of delegating.
    renderToolOptions(item: PressurePenItem | null): TemplateResult | null {
      if (!originalPen) return null;
      const penTool = originalPen as typeof originalPen & {
        getCurrentOptions: () => PressurePenOptions;
        updateCurrentOptions: (options: Partial<PressurePenOptions>) => void;
        generateColorSelect: (
          colors: string[],
          currentColor: string,
          onClick: (color: string) => void
        ) => TemplateResult<1>[];
      };
      const i18n = board.getI18nContext();
      const current = item ? item.getOptions() : penTool.getCurrentOptions();

      const setSize = (size: number): void => {
        penTool.updateCurrentOptions({ size });
        if (item) board.partialItemUpdateById(item.getId(), { options: { ...current, size } });
      };
      const setColor = (color: string): void => {
        penTool.updateCurrentOptions({ color });
        if (item) board.partialItemUpdateById(item.getId(), { options: { ...current, color } });
      };

      return html`
        <style>
          /* Scoped to this shadow root (our external stylesheet can't reach in
             here). <input type="color">'s own swatch is a UA-drawn
             ::-webkit-color-swatch pseudo-element that iOS WebKit in
             particular won't let go of (a white ring stayed no matter what
             was set on it directly) - so the visible swatch is a plain
             <label> we fully control, styled to match the color-select
             swatches next to it, wrapping a color input that's only there to
             open the native picker and is otherwise invisible. */
          .eome-color-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            /* Each color-select wraps its swatch in an inline-block, so its
               flex box is a line box: it carries the strut's descender space
               below the swatch, making the element taller than the 28px it
               shows. align-items:center then centres that taller box, sitting
               its visible swatch slightly high - and our label, whose box is
               exactly its swatch, correspondingly low. Collapsing the strut
               (inherited into the shadow roots) makes every box exactly the
               swatch, so they line up. */
            line-height: 0;
          }

          /* Geometry copied verbatim from the library's own color-select
             swatch, because its declared 24px is NOT its rendered size: with
             box-sizing:border-box, padding(12+12) + border(2+2) = 28px
             exceeds width:24px, so the content box clamps to 0 and the used
             size is 28x28. Restating the same declarations keeps the two
             provably identical instead of hardcoding a derived 28px. */
          .eome-color-picker-swatch {
            display: inline-block;
            width: 24px;
            height: 24px;
            padding: 12px;
            border: 2px solid transparent;
            border-radius: 6px;
            box-sizing: border-box;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
            margin: 2px 2px 2px 6px;
            /* The row is a flex container and this label's only child is a
               1px hidden input, so without this it has a near-zero
               min-content width and flex shrinks it. */
            flex: none;
            cursor: pointer;
          }
          .eome-color-picker-input {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            overflow: hidden;
          }
        </style>
        <p>${i18n.t('tool-options-size')}</p>
        <input
          class="width-100-percent"
          type="range"
          min=${PEN_SIZE_RANGE.min}
          max=${PEN_SIZE_RANGE.max}
          step="1"
          .value=${String(current.size)}
          @input=${(event: Event) => setSize(parseInt((event.target as HTMLInputElement).value, 10))}
        />
        <p>${i18n.t('tool-options-color')}</p>
        <div class="eome-color-row">
          ${penTool.generateColorSelect(PEN_COLORS, current.color || '#000000', setColor)}
          <label
            class="eome-color-picker-swatch"
            title="Custom color"
            style="background-color: ${current.color || '#000000'};"
          >
            <input
              type="color"
              class="eome-color-picker-input"
              aria-label="Custom color"
              .value=${current.color || '#000000'}
              @input=${(event: Event) => setColor((event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        ${item
          ? html`
              <button class="button width-100-percent" @click=${() => board.removeItemById(item.getId(), true)}>
                ${i18n.t('tool-options-delete')}
              </button>
            `
          : ''}
      `;
    }
    getPenOptions(): PressurePenOptions {
      return this.options();
    }

    applyPenOptions(options: Partial<PressurePenOptions>): void {
      const penTool = originalPen as typeof originalPen & {
        updateCurrentOptions?: (options: Partial<PressurePenOptions>) => void;
      };
      penTool?.updateCurrentOptions?.(options);
      board.requestUpdate();
    }

    onToolSelected(): void { originalPen?.onToolSelected(); }
    onToolUnselected(): void {
      if (this.currentItemId || this.isDrawing) this.cancelActiveStroke();
      else this.cancelTimers();
      originalPen?.onToolUnselected();
    }

    private options(): PressurePenOptions {
      const candidate = originalPen as typeof originalPen & { getCurrentOptions?: () => PressurePenOptions };
      const base = candidate?.getCurrentOptions?.() ?? {
        color: '#000000', size: PEN_DEFAULT_SIZE, smoothing: 0.5, thinning: 0.5, streamline: 0.5,
      };
      // The library's own pen options UI only lets users change color and size;
      // thinning/smoothing/streamline stay at their built-in 0.5 forever. Pin
      // them to our shared values so a stroke's *stored* options match what it
      // was actually rendered with, rather than whatever the library reported.
      return {
        ...base,
        thinning: PEN_THINNING,
        smoothing: PEN_SMOOTHING,
        streamline: PEN_STREAMLINE,
      };
    }

    private sampleAt(x: number, y: number): InkPoint {
      const world = board.getCoordsContext().convertFromCanvas(x, y);
      const sample = getActiveInkSample(board);
      return {
        x: world.x,
        y: world.y,
        pressure: sample?.pressure ?? 0.5,
        tiltX: sample?.tiltX,
        tiltY: sample?.tiltY,
        time: sample?.time ?? Date.now(),
      };
    }

    handleDrawingStart(x: number, y: number): void {
      this.cancelTimers();
      this.isDrawing = true;
      this.beautifiedWhileHeld = false;
      this.activeBeautification = undefined;
      this.rawPath = [this.sampleAt(x, y)];
      this.visiblePath = this.rawPath.slice();
      const item = this.newItem({ path: this.rawPath.slice(), options: { ...this.options() } });
      this.currentItemId = item.getId();
      board.addItem(item);
    }

    handleDrawingMove(x: number, y: number): void {
      if (!this.currentItemId) return;
      const point = this.sampleAt(x, y);
      const movedBeyondHoldTolerance = this.holdAnchor === null
        || shouldRestartHoldTimer(this.holdAnchor, { x, y });

      // WebKit can keep emitting stationary Pencil samples as pressure and
      // tilt fluctuate. They update the active sample, but must neither cancel
      // the straighten animation nor restart its hold timer indefinitely.
      if (this.beautifiedWhileHeld && !movedBeyondHoldTolerance) {
        this.rawPath = replaceEndpointSample(this.rawPath, point, false);
        this.visiblePath = replaceEndpointSample(this.visiblePath, point, true);
        if (this.animationSource) {
          this.animationSource = replaceEndpointSample(this.animationSource, point, false);
        }
        if (this.animationTarget) {
          this.animationTarget = replaceEndpointSample(this.animationTarget, point, true);
        }
        board.partialItemUpdateById(this.currentItemId, {
          path: this.visiblePath,
          rawPath: this.rawPath,
          beautification: this.activeBeautification,
        });
        return;
      }

      if (this.beautifiedWhileHeld && movedBeyondHoldTolerance) {
        this.cancelAnimation();
        this.rawPath = this.visiblePath.slice();
        this.beautifiedWhileHeld = false;
        this.activeBeautification = undefined;
      }

      this.rawPath.push(point);
      this.visiblePath = this.rawPath.slice();
      board.partialItemUpdateById(this.currentItemId, {
        path: this.visiblePath,
        rawPath: undefined,
        beautification: undefined,
      });
      this.scheduleBeautificationAt(x, y);
    }

    handleDrawingEnd(): void {
      if (this.holdTimer !== null) boardWindow.clearTimeout(this.holdTimer);
      this.holdTimer = null;
      this.holdAnchor = null;
      this.isDrawing = false;
      if (this.animationFrame !== null && this.currentItemId && this.animationTarget && this.animationSource) {
        boardWindow.cancelAnimationFrame(this.animationFrame);
        board.partialItemUpdateById(this.currentItemId, {
          path: this.animationTarget,
          rawPath: this.animationSource,
          beautification: this.activeBeautification,
        }, false);
        this.visiblePath = this.animationTarget.slice();
        this.rawPath = this.animationSource.slice();
        this.animationFrame = null;
        this.clearAnimationState();
      }
      this.currentItemId = null;
      this.beautifiedWhileHeld = false;
      this.activeBeautification = undefined;
    }

    scheduleBeautification(): void {
      const last = this.rawPath[this.rawPath.length - 1];
      if (!last) return;
      const canvas = board.getCoordsContext().convertToCanvas(last.x, last.y);
      this.scheduleBeautificationAt(canvas.x, canvas.y);
    }

    private scheduleBeautificationAt(x: number, y: number): void {
      if (!this.currentItemId || this.rawPath.length < 6) return;
      const nextAnchor = { x, y };
      if (this.holdTimer !== null && this.holdAnchor
        && !shouldRestartHoldTimer(this.holdAnchor, nextAnchor)) return;
      if (this.holdTimer !== null) boardWindow.clearTimeout(this.holdTimer);
      this.holdAnchor = nextAnchor;
      this.holdTimer = boardWindow.setTimeout(() => this.beginBeautification(), 430);
    }

    cancelActiveStroke(): void {
      this.cancelTimers();
      if (this.currentItemId) board.removeItemById(this.currentItemId, false);
      this.currentItemId = null;
      this.isDrawing = false;
      this.rawPath = [];
      this.visiblePath = [];
      this.holdAnchor = null;
      this.beautifiedWhileHeld = false;
      this.activeBeautification = undefined;
      board.draw();
    }

    private beginBeautification(): void {
      this.holdTimer = null;
      if (!this.currentItemId) return;
      const result = beautifyStroke(this.rawPath);
      if (!result) return;
      this.beautifiedWhileHeld = true;
      const itemId = this.currentItemId;
      const source = this.rawPath.slice();
      this.animationSource = source;
      this.animationTarget = result.points;
      this.activeBeautification = { kind: result.kind, confidence: result.confidence };
      const started = boardWindow.performance.now();
      const animate = (now: number): void => {
        if (!this.animationSource || !this.animationTarget || this.currentItemId !== itemId) {
          this.animationFrame = null;
          return;
        }
        const progress = Math.min(1, (now - started) / 160);
        this.visiblePath = progress < 1
          ? interpolateStroke(this.animationSource, this.animationTarget, progress)
          : this.animationTarget.slice();
        board.partialItemUpdateById(itemId, {
          path: this.visiblePath,
          rawPath: this.animationSource,
          beautification: this.activeBeautification,
        }, false);
        board.draw();
        if (progress < 1) {
          this.animationFrame = boardWindow.requestAnimationFrame(animate);
        } else {
          this.rawPath = this.animationSource.slice();
          this.animationFrame = null;
          this.clearAnimationState();
          if (!this.isDrawing) this.currentItemId = null;
        }
      };
      this.animationFrame = boardWindow.requestAnimationFrame(animate);
    }

    private cancelTimers(): void {
      if (this.holdTimer !== null) boardWindow.clearTimeout(this.holdTimer);
      this.holdTimer = null;
      this.holdAnchor = null;
      this.cancelAnimation();
    }

    private cancelAnimation(): void {
      if (this.animationFrame !== null) boardWindow.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      this.clearAnimationState();
    }

    private clearAnimationState(): void {
      this.animationTarget = null;
      this.animationSource = null;
    }
  }

  return new PressurePenTool();
}
