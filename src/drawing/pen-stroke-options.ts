import type { StrokeOptions } from 'perfect-freehand';
import type { PressurePenOptions } from './types';

/**
 * Values and easing curve taken directly from Excalidraw's freedraw renderer
 * (packages/element/src/shape.ts, VARIABLE_WIDTH_FREEDRAW + easeOutSine).
 *
 * These live here, in one place both the live canvas renderer and the SVG
 * exporter import, because the two drifting apart is not a theoretical
 * concern: the exporter used to call getStroke() without `easing`, which
 * silently made every saved drawing ~35% thinner than the stroke the user
 * actually drew (perfect-freehand's default easing is the identity function,
 * so radius went from size*sin(45deg)=0.707*size to size*0.5).
 */
export const PEN_THINNING = 0.6;
export const PEN_SMOOTHING = 0.5;
export const PEN_STREAMLINE = 0.5;
/** https://easings.net/#easeOutSine */
export const PEN_EASING = (t: number): number => Math.sin((t * Math.PI) / 2);

export const PEN_SIZE_RANGE = { min: 1, max: 40 } as const;

/**
 * The size slider's starting value. Deliberately the thinnest the slider
 * offers rather than Excalidraw's own default (their "medium" freedraw width
 * of 1 * their 4.25 size factor = 4.25): measured side by side, our stroke
 * was already marginally thinner than Excalidraw's at every pressure, so this
 * is a preference for a finer default line, not a correction.
 */
export const PEN_DEFAULT_SIZE = PEN_SIZE_RANGE.min;

/**
 * The single source of truth for how a pen stroke's outline is generated.
 * `size` is passed explicitly because the live canvas renders in canvas space
 * (size scaled by the current zoom) while the SVG exporter renders in world
 * space (size as stored).
 */
export function penStrokeOptions(options: PressurePenOptions, size: number): StrokeOptions {
  return {
    ...options,
    size,
    thinning: PEN_THINNING,
    smoothing: PEN_SMOOTHING,
    streamline: PEN_STREAMLINE,
    easing: PEN_EASING,
    // Excalidraw passes this unconditionally: every render treats whatever the
    // stroke currently has as complete, giving a proper end cap on every frame
    // instead of an ever-tapering tail.
    last: true,
    // We always supply real per-sample pressure, so perfect-freehand must not
    // synthesise its own from point velocity.
    simulatePressure: false,
  };
}
