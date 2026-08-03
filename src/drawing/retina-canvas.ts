import type { SimpleWhiteboard } from '@ludovicm67/simple-whiteboard';
import type { DrawingContext } from '@ludovicm67/simple-whiteboard/dist/lib/types';

interface RendererInternals {
  generateDrawingContext: () => DrawingContext;
}

/**
 * simple-whiteboard never accounts for devicePixelRatio: its resize handler
 * sets the canvas bitmap to exactly clientWidth/clientHeight (CSS pixels), so
 * on a Retina/high-DPI display every stroke renders at native (1x)
 * resolution and gets upscaled - visibly softer/heavier than a canvas that
 * renders at the display's real pixel density, regardless of any logical
 * stroke-width setting.
 *
 * Excalidraw's own fix (packages/excalidraw/components/canvases/
 * StaticCanvas.tsx + renderer/helpers.ts bootstrapCanvas) is two parts, both
 * reproduced here:
 *  1. Size the canvas bitmap to logical-size * devicePixelRatio while the
 *     CSS box stays at the logical size (handleResize patch below).
 *  2. Reset the transform to identity and re-apply `scale(dpr, dpr)` at the
 *     start of every single render pass, not just once after a resize -
 *     Excalidraw does this unconditionally on every frame
 *     (context.setTransform(1,0,0,1,0,0); context.scale(scale, scale);)
 *     rather than relying on a scale set once surviving untouched across
 *     every future draw call. Patching only the resize handler turned out
 *     not to survive that way here either, hence hooking the actual render
 *     entry point (renderer.generateDrawingContext) instead.
 */
export function applyRetinaCanvasFix(board: SimpleWhiteboard): void {
  const dpr = window.devicePixelRatio || 1;
  if (dpr === 1) return;

  const originalHandleResize = board.handleResize.bind(board);
  board.handleResize = () => {
    originalHandleResize();
    const canvas = board.getCanvasElement();
    if (!canvas) return;
    canvas.width = Math.round(canvas.width * dpr);
    canvas.height = Math.round(canvas.height * dpr);
  };

  const renderer = (board as unknown as { renderer?: RendererInternals }).renderer;
  if (!renderer) return;
  const originalGenerateDrawingContext = renderer.generateDrawingContext.bind(renderer);
  renderer.generateDrawingContext = () => {
    const context = originalGenerateDrawingContext();
    context.canvas.setTransform(1, 0, 0, 1, 0, 0);
    context.canvas.scale(dpr, dpr);
    return context;
  };
}
