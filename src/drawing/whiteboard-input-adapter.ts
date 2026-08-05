import type { SimpleWhiteboard } from '@ludovicm67/simple-whiteboard';
import { withCurrentInkSample } from './pressure-pen';
import type { InkPoint } from './types';
import { WhiteboardItemSnapshot } from './whiteboard-item-snapshot';

interface Point {
  x: number;
  y: number;
}

interface ActivePenContact {
  pointerId: number;
  lastForwardedTimeStamp: number;
  lastPressure: number;
}

interface CancellableWhiteboardTool {
  cancelActiveStroke?: () => void;
}

interface PointerSampleIdentity {
  clientX: number;
  clientY: number;
  timeStamp: number;
}

/**
 * Deliberately strict: pressure and tilt are not enough to turn a compatibility
 * mouse event into a Pencil event. Misclassifying a real mouse would bypass
 * simple-whiteboard's own mouse, area-export and middle-button input paths.
 */
export function isExplicitPenPointer(event: Pick<PointerEvent, 'pointerType'>): boolean {
  return event.pointerType === 'pen';
}

export function penInkSample(
  event: Pick<PointerEvent, 'pressure' | 'tiltX' | 'tiltY' | 'timeStamp'>,
  point: Point,
  fallbackPressure = 0.5
): InkPoint {
  const pressure = Number.isFinite(event.pressure) && event.pressure > 0
    ? Math.min(1, event.pressure)
    : fallbackPressure;
  return {
    x: point.x,
    y: point.y,
    pressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    time: event.timeStamp,
  };
}

function sampleIdentity(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'timeStamp'>): PointerSampleIdentity {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    timeStamp: event.timeStamp,
  };
}

function sameSample(a: PointerSampleIdentity, b: PointerSampleIdentity): boolean {
  return a.clientX === b.clientX && a.clientY === b.clientY && a.timeStamp === b.timeStamp;
}

export function coalescedPenSamples(event: PointerEvent): PointerEvent[] {
  let coalesced: PointerEvent[] = [];
  try {
    coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  } catch {
    // Some WebKit builds expose the method but reject it for synthetic or
    // already-cancelled events. The parent event remains a complete sample.
  }
  if (coalesced.length === 0) return [event];
  const last = coalesced[coalesced.length - 1];
  return sameSample(sampleIdentity(last), sampleIdentity(event))
    ? coalesced
    : [...coalesced, event];
}

/**
 * Adds the one capability simple-whiteboard does not currently expose: a
 * pressure-aware Pointer Events path for a real pen. Mouse and touch input stay
 * entirely with simple-whiteboard, including one-finger drawing, two-finger
 * pan/pinch, middle-button panning and area export.
 */
/**
 * Once a pinch/pan gesture ends, fingers rarely lift at exactly the same
 * instant. A brand-new single-finger touch that lands this soon after is far
 * more likely to be the tail of that same gesture (a repeated pinch attempt
 * at the zoom limit, or one finger settling a beat after the other) than a
 * deliberate new stroke. Professional canvases (Excalidraw, tldraw) hit the
 * identical ambiguity and resolve it by refusing to treat that finger as
 * drawing input; this grace window is our version of that guard.
 */
const MULTI_TOUCH_DRAW_GRACE_MS = 250;

export class WhiteboardInputAdapter {
  private readonly suppressedPalmTouches = new Set<number>();
  private readonly activeNativeTouches = new Set<number>();
  private readonly ownerWindow: Window | null;
  private activePen: ActivePenContact | null = null;
  private nativeTouchSnapshot: WhiteboardItemSnapshot | null = null;
  private restoreDrawingStart: (() => void) | null = null;
  private nativeGestureWasMultiTouch = false;
  private lastMultiTouchEndedAt = 0;

  constructor(
    private readonly board: SimpleWhiteboard,
    private readonly canvas: HTMLCanvasElement
  ) {
    canvas.setCssStyles({ touchAction: 'none' });

    const pointerOptions: AddEventListenerOptions = {
      capture: true,
      passive: false,
    };
    canvas.addEventListener('pointerdown', this.onPointerDown, pointerOptions);
    canvas.addEventListener('pointermove', this.onPointerMove, pointerOptions);
    canvas.addEventListener('pointerup', this.onPointerUp, pointerOptions);
    canvas.addEventListener('pointercancel', this.onPointerCancel, pointerOptions);
    canvas.addEventListener('lostpointercapture', this.onLostPointerCapture, pointerOptions);

    // These capture listeners block only palm-generated TouchEvents while a Pen
    // contact is active. The library's original touch handlers remain installed
    // and receive every normal finger gesture.
    canvas.addEventListener('touchstart', this.onTouchStart, pointerOptions);
    canvas.addEventListener('touchstart', this.onTouchStartAfterLibrary);
    canvas.addEventListener('touchmove', this.onTouchMove, pointerOptions);
    canvas.addEventListener('touchend', this.onTouchEnd, pointerOptions);
    canvas.addEventListener('touchcancel', this.onTouchCancel, pointerOptions);

    // Bubble phase makes these true fallbacks: a canvas event is handled there
    // first. Events that end outside the canvas still close the matching Pen
    // lifecycle, without cancelling or stopping unrelated window input.
    this.ownerWindow = canvas.ownerDocument.defaultView;
    this.ownerWindow?.addEventListener('pointerup', this.onWindowPointerUp);
    this.ownerWindow?.addEventListener('pointercancel', this.onWindowPointerCancel);
  }

  destroy(): void {
    try {
      if (this.activePen) this.cancelPenContact();
    } finally {
      this.restoreSuspendedDrawingStart();
      this.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
      this.canvas.removeEventListener('pointermove', this.onPointerMove, true);
      this.canvas.removeEventListener('pointerup', this.onPointerUp, true);
      this.canvas.removeEventListener('pointercancel', this.onPointerCancel, true);
      this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
      this.canvas.removeEventListener('touchstart', this.onTouchStart, true);
      this.canvas.removeEventListener('touchstart', this.onTouchStartAfterLibrary);
      this.canvas.removeEventListener('touchmove', this.onTouchMove, true);
      this.canvas.removeEventListener('touchend', this.onTouchEnd, true);
      this.canvas.removeEventListener('touchcancel', this.onTouchCancel, true);
      this.ownerWindow?.removeEventListener('pointerup', this.onWindowPointerUp);
      this.ownerWindow?.removeEventListener('pointercancel', this.onWindowPointerCancel);
      this.suppressedPalmTouches.clear();
      this.activeNativeTouches.clear();
      this.nativeTouchSnapshot = null;
    }
  }

  private local(event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private sample(event: PointerEvent, fallbackPressure = 0.5): { point: Point; ink: InkPoint } {
    const point = this.local(event);
    return { point, ink: penInkSample(event, point, fallbackPressure) };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!isExplicitPenPointer(event) || event.button !== 0 || this.activePen) return;

    if (this.activeNativeTouches.size > 0) {
      // A prior finger contact can either be a normal tool interaction or the
      // library's area-export marquee. Only the former sets `interacting`.
      // Leave area export entirely on its native touch path.
      if (!this.board.isInteracting()) return;
      if (!this.rollbackNativeTouchInteraction()) {
        // Do not begin a second interaction on top of a board state that could
        // not be proven equal to the pre-touch snapshot. Palm-suppress the
        // remaining finger sequence as well, because its tool was already ended.
        this.suppressActiveNativeTouchSequence();
        event.preventDefault();
        return;
      }
      for (const identifier of this.activeNativeTouches) {
        this.suppressedPalmTouches.add(identifier);
      }
      this.activeNativeTouches.clear();
    }

    event.preventDefault();
    const { point, ink } = this.sample(event);
    this.activePen = {
      pointerId: event.pointerId,
      lastForwardedTimeStamp: event.timeStamp,
      lastPressure: ink.pressure,
    };
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an optimization. The owner-window fallback still
      // balances the drawing lifecycle on older WKWebView versions.
    }

    try {
      withCurrentInkSample(this.board, ink, () => {
        this.board.handleDrawingStart(point.x, point.y);
      });
    } catch (error) {
      this.activePen = null;
      this.releaseCapture(event.pointerId);
      throw error;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isActivePen(event.pointerId)) return;
    event.preventDefault();

    for (const sample of coalescedPenSamples(event)) this.forwardPenMove(sample);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.isActivePen(event.pointerId)) return;
    event.preventDefault();
    this.forwardPenMove(event);
    this.finishPenContact();
    this.releaseCapture(event.pointerId);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.isActivePen(event.pointerId)) return;
    try {
      this.cancelPenContact();
    } finally {
      this.releaseCapture(event.pointerId);
    }
  };

  private onLostPointerCapture = (event: PointerEvent): void => {
    if (this.isActivePen(event.pointerId)) this.cancelPenContact();
  };

  private onWindowPointerUp = (event: PointerEvent): void => {
    if (!this.isActivePen(event.pointerId)) return;
    // This path is reached only when capture was unavailable and the pointer
    // ended outside the canvas. Preserve the final hardware sample just as the
    // ordinary canvas path does, then balance and release the contact.
    this.forwardPenMove(event);
    this.finishPenContact();
    this.releaseCapture(event.pointerId);
  };

  private onWindowPointerCancel = (event: PointerEvent): void => {
    if (!this.isActivePen(event.pointerId)) return;
    try {
      this.cancelPenContact();
    } finally {
      this.releaseCapture(event.pointerId);
    }
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (this.activePen) {
      this.rememberTouches(event.changedTouches, this.suppressedPalmTouches);
      this.suppressPalmEvent(event);
      return;
    }

    if (this.activeNativeTouches.size === 0) {
      if (event.touches.length === 1 && this.withinMultiTouchDrawGrace()) {
        // This looks like a fresh single-finger touch, but a pinch/pan gesture
        // just ended a moment ago. Treat it as that gesture's tail (fingers
        // rarely lift in perfect sync) rather than a deliberate new stroke.
        this.rememberTouches(event.changedTouches, this.suppressedPalmTouches);
        this.suppressPalmEvent(event);
        return;
      }
      // Capture before simple-whiteboard's bubble listener lets the active tool
      // create, move, resize, reorder, or erase anything.
      this.nativeTouchSnapshot = WhiteboardItemSnapshot.capture(this.board);
    }
    this.rememberTouches(event.changedTouches, this.activeNativeTouches);
    if (event.touches.length >= 2) this.nativeGestureWasMultiTouch = true;
    if (event.touches.length < 2) return;

    // simple-whiteboard 0.6 initializes pinch state and then also starts the
    // current tool a second time. End the first-finger interaction and gate only
    // that redundant synchronous start; its native pinch setup still runs.
    // Area export deliberately does not set `interacting`; leave that separate
    // native workflow untouched.
    if (!this.board.isInteracting()) return;
    if (!this.rollbackNativeTouchInteraction()) {
      // The native pinch handler would otherwise continue from a partially
      // rolled-back tool interaction. Keep its complete touch sequence out of
      // the library, not merely this first failed promotion event.
      this.suppressActiveNativeTouchSequence();
      this.suppressPalmEvent(event);
      return;
    }
    this.suspendDrawingStartForCurrentEvent();
  };

  private onTouchStartAfterLibrary = (): void => {
    this.restoreSuspendedDrawingStart();
  };

  private onTouchMove = (event: TouchEvent): void => {
    if (this.activePen) this.rememberTouches(event.touches, this.suppressedPalmTouches);
    if (this.activePen || this.hasSuppressedTouch(event.touches)) this.suppressPalmEvent(event);
  };

  private onTouchEnd = (event: TouchEvent): void => {
    const wasSuppressed = this.hasSuppressedTouch(event.changedTouches);
    for (const touch of Array.from(event.changedTouches)) {
      this.suppressedPalmTouches.delete(touch.identifier);
      this.activeNativeTouches.delete(touch.identifier);
    }
    if (this.activeNativeTouches.size === 0) {
      this.nativeTouchSnapshot = null;
      this.armMultiTouchDrawGrace();
    }
    if (wasSuppressed) this.suppressPalmEvent(event);
  };

  private onTouchCancel = (event: TouchEvent): void => {
    const wasSuppressed = this.hasSuppressedTouch(event.changedTouches);
    if (!this.activePen && this.board.isInteracting()) {
      this.rollbackNativeTouchInteraction();
    }
    for (const touch of Array.from(event.changedTouches)) {
      this.suppressedPalmTouches.delete(touch.identifier);
      this.activeNativeTouches.delete(touch.identifier);
    }
    if (this.activeNativeTouches.size === 0) {
      this.nativeTouchSnapshot = null;
      this.armMultiTouchDrawGrace();
    }
    if (wasSuppressed) this.suppressPalmEvent(event);
  };

  private armMultiTouchDrawGrace(): void {
    if (this.nativeGestureWasMultiTouch) this.lastMultiTouchEndedAt = Date.now();
    this.nativeGestureWasMultiTouch = false;
  }

  private withinMultiTouchDrawGrace(): boolean {
    return Date.now() - this.lastMultiTouchEndedAt < MULTI_TOUCH_DRAW_GRACE_MS;
  }

  private suppressPalmEvent(event: TouchEvent): void {
    event.preventDefault();
    // This is intentionally canvas-local. It prevents only the library handler
    // for the same palm event; no document/window listener is affected.
    event.stopImmediatePropagation();
  }

  private rememberTouches(touches: TouchList, target: Set<number>): void {
    for (const touch of Array.from(touches)) {
      target.add(touch.identifier);
    }
  }

  private hasSuppressedTouch(touches: TouchList): boolean {
    return Array.from(touches).some((touch) => this.suppressedPalmTouches.has(touch.identifier));
  }

  private suppressActiveNativeTouchSequence(): void {
    for (const identifier of this.activeNativeTouches) {
      this.suppressedPalmTouches.add(identifier);
    }
  }

  private isActivePen(pointerId: number): boolean {
    return this.activePen?.pointerId === pointerId;
  }

  private forwardPenMove(event: PointerEvent): void {
    if (!this.activePen) return;
    // Some WebKit builds hand back overlapping getCoalescedEvents() batches -
    // the tail of one pointermove's coalesced samples reappears as the head of
    // the next. Comparing only against the immediately previous sample missed
    // that (it had already moved past the duplicate), so the same handful of
    // samples got appended twice, over and over, for the whole stroke: the
    // path kept doubling back on itself, which is what rendered as a
    // dotted/broken line even though the pen never left the surface.
    // Timestamps are monotonic per contact, so a high-water mark is enough.
    if (event.timeStamp <= this.activePen.lastForwardedTimeStamp) return;
    this.activePen.lastForwardedTimeStamp = event.timeStamp;
    const { point, ink } = this.sample(event, this.activePen.lastPressure);
    this.activePen.lastPressure = ink.pressure;
    withCurrentInkSample(this.board, ink, () => {
      this.board.handleDrawingMove(point.x, point.y);
    });
  }

  private finishPenContact(): void {
    if (!this.activePen) return;
    this.activePen = null;
    this.board.handleDrawingEnd();
  }

  private cancelPenContact(): void {
    if (!this.activePen) return;
    this.activePen = null;
    this.cancelBoardInteraction();
  }

  private cancelBoardInteraction(): void {
    const tool = this.board.getToolInstance(this.board.getCurrentTool()) as CancellableWhiteboardTool | undefined;
    try {
      tool?.cancelActiveStroke?.();
    } finally {
      // Always balance board.handleDrawingStart, even when the active tool has
      // no custom rollback hook. Built-in tools can then clear their internal
      // drag/create state and the board commits exactly one interaction end.
      this.board.handleDrawingEnd();
    }
  }

  private rollbackNativeTouchInteraction(): boolean {
    const snapshot = this.nativeTouchSnapshot;
    this.nativeTouchSnapshot = null;

    let rollbackError: unknown = null;
    try {
      this.cancelBoardInteraction();
    } catch (error) {
      rollbackError = error;
    }

    try {
      snapshot?.restoreIfChanged(this.board);
    } catch (error) {
      rollbackError ??= error;
    }

    if (rollbackError) {
      console.error('Could not roll back the interrupted whiteboard touch interaction.', rollbackError);
      return false;
    }
    return true;
  }

  private suspendDrawingStartForCurrentEvent(): void {
    if (this.restoreDrawingStart) return;
    const original = this.board.handleDrawingStart.bind(this.board);
    const blocked = (): void => undefined;
    this.board.handleDrawingStart = blocked;
    this.restoreDrawingStart = () => {
      if (this.board.handleDrawingStart === blocked) this.board.handleDrawingStart = original;
      this.restoreDrawingStart = null;
    };
    queueMicrotask(() => this.restoreSuspendedDrawingStart());
  }

  private restoreSuspendedDrawingStart(): void {
    this.restoreDrawingStart?.();
  }

  private releaseCapture(pointerId: number): void {
    try {
      if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    } catch {
      // A cancelled pointer may have lost capture before cleanup reaches us.
    }
  }
}
