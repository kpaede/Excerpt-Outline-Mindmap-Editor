import type * as WhiteboardModule from '@ludovicm67/simple-whiteboard';

type RuntimeModule = typeof WhiteboardModule;

const MODULE_CACHE_KEY = '__eomeSimpleWhiteboardModule_v1__';
const WHITEBOARD_CUSTOM_ELEMENTS = [
  'color-select',
  'simple-whiteboard',
  'simple-whiteboard-menu',
  'simple-whiteboard--tool-arrow',
  'simple-whiteboard--tool-circle',
  'simple-whiteboard--tool-clear',
  'simple-whiteboard--tool-defaults',
  'simple-whiteboard--tool-eraser',
  'simple-whiteboard--tool-line',
  'simple-whiteboard--tool-move',
  'simple-whiteboard--tool-pen',
  'simple-whiteboard--tool-picture',
  'simple-whiteboard--tool-pointer',
  'simple-whiteboard--tool-rect',
  'simple-whiteboard--tool-sticky',
  'simple-whiteboard--tool-text',
] as const;

export class WhiteboardRuntimeCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhiteboardRuntimeCapabilityError';
  }
}

function installOffscreenCanvasFallback(): void {
  // typeof rather than `in`: the `in` form narrows `window` itself, leaving
  // the rest of this function with nothing left to read `document` from.
  if (typeof window.OffscreenCanvas !== 'undefined') return;
  if (!window.document) {
    throw new WhiteboardRuntimeCapabilityError('The drawing editor needs a browser document.');
  }

  class HtmlCanvasFallback {
    // This canvas is used only for text measurement and is never attached. Use
    // the stable module realm instead of capturing whichever Obsidian window
    // happened to open the first drawing.
    private readonly canvas = window.document.body.createEl('canvas', {}, (el) => el.detach());

    constructor(width: number, height: number) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    get width(): number { return this.canvas.width; }
    set width(value: number) { this.canvas.width = value; }
    get height(): number { return this.canvas.height; }
    set height(value: number) { this.canvas.height = value; }

    getContext(contextId: string): RenderingContext | null {
      return this.canvas.getContext(contextId);
    }
  }

  Object.defineProperty(window, 'OffscreenCanvas', {
    configurable: true,
    writable: true,
    value: HtmlCanvasFallback,
  });
}

export function assertWhiteboardRuntimeInDocument(ownerDocument: Document): void {
  const registry = ownerDocument.defaultView?.customElements;
  const missing = registry
    ? WHITEBOARD_CUSTOM_ELEMENTS.filter((name) => !registry.get(name))
    : [...WHITEBOARD_CUSTOM_ELEMENTS];
  if (missing.length === 0) return;

  throw new WhiteboardRuntimeCapabilityError(
    'Drawing tools are unavailable in this Obsidian pop-out window. Open the mind map in the main window to edit drawings.'
  );
}

export async function loadWhiteboardRuntime(ownerDocument: Document): Promise<RuntimeModule> {
  installOffscreenCanvasFallback();
  const runtime = window as typeof window & { [MODULE_CACHE_KEY]?: RuntimeModule };
  const cached = runtime[MODULE_CACHE_KEY];
  if (cached) {
    assertWhiteboardRuntimeInDocument(ownerDocument);
    return cached;
  }

  const module = await import('@ludovicm67/simple-whiteboard');
  runtime[MODULE_CACHE_KEY] = module;
  assertWhiteboardRuntimeInDocument(ownerDocument);
  return module;
}

/**
 * Evaluates the whiteboard module ahead of the first drawing, without
 * blocking the caller.
 *
 * The bundler turns the dynamic import above into a lazy require of a module
 * that is already inside main.js, so nothing is fetched - but its top-level
 * code (registering ~16 custom elements plus their Lit templates) only runs
 * on that first call, and on a tablet that is seconds of work sitting
 * directly in the path between tapping "Add drawing" and being able to draw.
 * Called when the menu offering those actions opens, so the cost overlaps
 * with the user reading the menu instead of following their tap. Doing it
 * any earlier (plugin load) would put the same work on Obsidian's startup.
 *
 * Safe to call repeatedly: after the first call the module is cached.
 */
export function warmWhiteboardRuntime(): void {
  const runtime = window as typeof window & { [MODULE_CACHE_KEY]?: RuntimeModule };
  if (runtime[MODULE_CACHE_KEY]) return;
  void import('@ludovicm67/simple-whiteboard')
    .then((module) => {
      runtime[MODULE_CACHE_KEY] ??= module;
    })
    .catch(() => {
      // Purely an optimisation: loadWhiteboardRuntime reports real failures
      // when the editor is actually opened.
    });
}
