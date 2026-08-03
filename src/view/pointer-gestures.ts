export type DirectPointerKind = 'touch' | 'pen';

export interface CompletedDirectTap<TTarget> {
  target: TTarget;
  kind: DirectPointerKind;
  x: number;
  y: number;
  at: number;
}

/**
 * One policy for direct input. Finger contacts get slightly more spatial
 * tolerance because their contact patch is wider; timings are input-neutral.
 */
export const DIRECT_GESTURE_CONFIG = Object.freeze({
  doubleTapMs: 500,
  doubleTapDistancePx: 24,
  longPressMs: 340,
  movementPx: Object.freeze({ pen: 12, touch: 16 }),
  tapPx: Object.freeze({ pen: 14, touch: 20 }),
  compatibilityMouseMs: 400,
  compatibilityMouseDistancePx: 24,
});

/**
 * Stores only completed taps. Pointer-down events never advance the sequence,
 * so a cancelled contact or Pencil hover cannot turn the next tap into a
 * phantom double tap.
 */
export class CompletedDirectTapTracker<TTarget> {
  private previous: CompletedDirectTap<TTarget> | null = null;

  completeTap(current: CompletedDirectTap<TTarget>): boolean {
    const isDoubleTap = isMatchingCompletedDoubleTap(this.previous, current);
    this.previous = isDoubleTap ? null : current;
    return isDoubleTap;
  }

  cancel(): void {
    this.previous = null;
  }
}

export function directPointerKind(pointerType: string): DirectPointerKind | null {
  if (pointerType === 'touch' || pointerType === 'pen') return pointerType;
  return null;
}

export function directPointerMovementThreshold(kind: DirectPointerKind): number {
  return DIRECT_GESTURE_CONFIG.movementPx[kind];
}

export function directPointerLongPressDelay(_kind: DirectPointerKind): number {
  return DIRECT_GESTURE_CONFIG.longPressMs;
}

export function directPointerTapTolerance(kind: DirectPointerKind): number {
  return DIRECT_GESTURE_CONFIG.tapPx[kind];
}

export function isMatchingCompletedDoubleTap<TTarget>(
  previous: CompletedDirectTap<TTarget> | null,
  current: CompletedDirectTap<TTarget>
): boolean {
  if (!previous) return false;

  return previous.target === current.target &&
    previous.kind === current.kind &&
    current.at >= previous.at &&
    current.at - previous.at <= DIRECT_GESTURE_CONFIG.doubleTapMs &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= DIRECT_GESTURE_CONFIG.doubleTapDistancePx;
}
