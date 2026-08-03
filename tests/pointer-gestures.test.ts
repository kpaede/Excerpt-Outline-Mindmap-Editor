import { describe, expect, it } from 'vitest';
import {
  CompletedDirectTapTracker,
  DIRECT_GESTURE_CONFIG,
  directPointerKind,
  directPointerLongPressDelay,
  directPointerMovementThreshold,
  directPointerTapTolerance,
  isMatchingCompletedDoubleTap,
} from '../src/view/pointer-gestures';

describe('direct pointer gesture policy', () => {
  it('claims only explicit touch and Pencil pointer types', () => {
    expect(directPointerKind('pen')).toBe('pen');
    expect(directPointerKind('touch')).toBe('touch');
    expect(directPointerKind('mouse')).toBeNull();
    expect(directPointerKind('')).toBeNull();
  });

  it('uses one hold timing and only a small contact-size tolerance difference', () => {
    expect(directPointerLongPressDelay('pen')).toBe(DIRECT_GESTURE_CONFIG.longPressMs);
    expect(directPointerLongPressDelay('touch')).toBe(DIRECT_GESTURE_CONFIG.longPressMs);
    expect(directPointerMovementThreshold('pen')).toBeLessThan(directPointerMovementThreshold('touch'));
    expect(directPointerTapTolerance('pen')).toBeLessThan(directPointerTapTolerance('touch'));
  });

  it('matches completed taps only on the same node and with the same input kind', () => {
    const previous = { target: 4, kind: 'pen' as const, x: 100, y: 100, at: 1_000 };
    expect(isMatchingCompletedDoubleTap(previous, {
      target: 4, kind: 'pen', x: 110, y: 108, at: 1_400,
    })).toBe(true);
    expect(isMatchingCompletedDoubleTap(previous, {
      target: 4, kind: 'touch', x: 110, y: 108, at: 1_400,
    })).toBe(false);
    expect(isMatchingCompletedDoubleTap(previous, {
      target: 5, kind: 'pen', x: 110, y: 108, at: 1_400,
    })).toBe(false);
  });

  it('rejects taps outside the time and distance boundaries', () => {
    const previous = { target: 4, kind: 'pen' as const, x: 100, y: 100, at: 1_000 };
    expect(isMatchingCompletedDoubleTap(previous, {
      target: 4,
      kind: 'pen',
      x: 100 + DIRECT_GESTURE_CONFIG.doubleTapDistancePx + 0.1,
      y: 100,
      at: 1_300,
    })).toBe(false);
    expect(isMatchingCompletedDoubleTap(previous, {
      target: 4,
      kind: 'pen',
      x: 100,
      y: 100,
      at: 1_000 + DIRECT_GESTURE_CONFIG.doubleTapMs + 1,
    })).toBe(false);
  });

  it('advances only when a complete tap is submitted and consumes tap two', () => {
    const tracker = new CompletedDirectTapTracker<number>();
    const first = { target: 4, kind: 'pen' as const, x: 100, y: 100, at: 1_000 };
    expect(tracker.completeTap(first)).toBe(false);
    expect(tracker.completeTap({ ...first, x: 103, at: 1_300 })).toBe(true);
    expect(tracker.completeTap({ ...first, x: 104, at: 1_450 })).toBe(false);
    tracker.cancel();
    expect(tracker.completeTap({ ...first, at: 1_600 })).toBe(false);
  });
});
