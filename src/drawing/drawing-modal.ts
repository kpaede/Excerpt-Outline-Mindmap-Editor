import { App, Modal, Notice, setIcon } from 'obsidian';
import type { SimpleWhiteboard } from '@ludovicm67/simple-whiteboard';
import type { ExportedDrawingItem } from './types';
import { loadWhiteboardRuntime, WhiteboardRuntimeCapabilityError } from './whiteboard-runtime';
import { createPressurePenTool, type PressurePenToolControl } from './pressure-pen';
import { WhiteboardInputAdapter } from './whiteboard-input-adapter';
import { applyRetinaCanvasFix } from './retina-canvas';
import type { PenPreferenceStore } from './pen-preferences';

export interface DrawingModalResult {
  items: ExportedDrawingItem[];
}

export function openDrawingModal(
  app: App,
  initialItems: ExportedDrawingItem[] = [],
  registerCloser?: (close: () => void) => () => void,
  penPreferences?: PenPreferenceStore
): Promise<DrawingModalResult | null> {
  return new Promise((resolve) => {
    const modal = new DrawingModal(app, initialItems, resolve, penPreferences);
    modal.setLifecycleCleanup(registerCloser?.(() => modal.close()) ?? null);
    modal.open();
  });
}

class DrawingModal extends Modal {
  private board: SimpleWhiteboard | null = null;
  private inputController: WhiteboardInputAdapter | null = null;
  private pressurePen: PressurePenToolControl | null = null;
  private settled = false;
  private isClosed = false;
  private lifecycleCleanup: (() => void) | null = null;

  constructor(
    app: App,
    private readonly initialItems: ExportedDrawingItem[],
    private readonly resolveResult: (result: DrawingModalResult | null) => void,
    private readonly penPreferences?: PenPreferenceStore
  ) {
    super(app);
  }

  setLifecycleCleanup(cleanup: (() => void) | null): void {
    this.lifecycleCleanup = cleanup;
  }

  onOpen(): void {
    this.isClosed = false;
    this.modalEl.addClass('eome-drawing-modal');
    this.contentEl.addClass('eome-drawing-modal-content');
    this.contentEl.replaceChildren();

    const header = this.contentEl.createDiv({ cls: 'eome-drawing-header' });
    header.createEl('h2', { text: this.initialItems.length > 0 ? 'Edit drawing' : 'New drawing' });
    header.createEl('p', { text: 'Draw with Apple Pencil or a finger. Hold briefly at the end of a stroke to straighten it.' });

    const stage = this.contentEl.createDiv({ cls: 'eome-drawing-stage' });
    // The library's own tool palette is a floating pill it re-renders on every
    // board update (lit-html owns and replaces its children wholesale), so
    // anything appended into it would get wiped on the next redraw. This is a
    // second floating pill of our own instead, at the same top offset, styled
    // to match - not a DOM child of the library's, but reading as part of the
    // same floating-toolbar row. Undo/redo also duplicate the library's own
    // (now-hidden) footer buttons; see initializeBoard.
    const undoRedoGroup = stage.createDiv({ cls: 'eome-drawing-undo-redo' });
    const createHistoryButton = (label: string, icon: string): HTMLButtonElement => {
      const button = undoRedoGroup.createEl('button');
      button.addClass('clickable-icon');
      setIcon(button, icon);
      button.setAttribute('aria-label', label);
      button.disabled = true;
      return button;
    };
    const undoButton = createHistoryButton('Undo', 'undo');
    const redoButton = createHistoryButton('Redo', 'redo');
    undoButton.addEventListener('click', () => this.board?.undo());
    redoButton.addEventListener('click', () => this.board?.redo());
    const footer = this.contentEl.createDiv({ cls: 'eome-drawing-footer' });
    const status = footer.createSpan({ text: 'Loading drawing tools…', cls: 'eome-drawing-status' });
    const cancelButton = footer.createEl('button', { text: 'Cancel' });
    const saveButton = footer.createEl('button', { text: 'Save', cls: 'mod-cta' });
    saveButton.disabled = true;

    cancelButton.addEventListener('click', () => this.close());
    saveButton.addEventListener('click', () => {
      if (!this.board || this.settled) return;
      let items: ExportedDrawingItem[];
      try {
        items = this.board.exportItems() as ExportedDrawingItem[];
      } catch (error) {
        console.error('Could not export the drawing from the editor:', error);
        status.setText('The drawing could not be prepared for saving. Nothing was changed.');
        new Notice('Could not prepare the drawing for saving.');
        return;
      }
      saveButton.disabled = true;
      this.settled = true;
      this.resolveResult({ items });
      this.close();
    });

    void this.initializeBoard(stage).then(() => {
      if (this.isClosed) return;
      status.setText('Pencil pressure, palm rejection, pinch zoom and hold-to-straighten are active.');
      saveButton.disabled = false;
      undoButton.disabled = false;
      redoButton.disabled = false;
    }).catch((error: unknown) => {
      if (this.isClosed) return;
      console.error('Could not initialize the drawing editor:', error);
      if (error instanceof WhiteboardRuntimeCapabilityError) {
        status.setText(error.message);
        new Notice(error.message);
        return;
      }
      status.setText('The drawing editor could not be loaded.');
      new Notice('Could not open the drawing editor. See the developer console for details.');
    });
  }

  onClose(): void {
    this.isClosed = true;
    // Deliberately also on cancel: the pen's size and colour are preferences
    // for the tool, independent of whether this particular drawing was kept.
    this.persistPenPreferences();
    this.inputController?.destroy();
    this.inputController = null;
    this.pressurePen = null;
    this.board = null;
    this.contentEl.replaceChildren();
    this.lifecycleCleanup?.();
    this.lifecycleCleanup = null;
    if (!this.settled) {
      this.settled = true;
      this.resolveResult(null);
    }
  }

  private persistPenPreferences(): void {
    if (!this.penPreferences || !this.pressurePen) return;
    const { size, color } = this.pressurePen.getPenOptions();
    void this.penPreferences.save({ size, color }).catch((error: unknown) => {
      // The drawing itself is already saved; losing a tool preference is not
      // worth interrupting the user over.
      console.error('Could not persist the pen preferences:', error);
    });
  }

  private async initializeBoard(stage: HTMLElement): Promise<void> {
    const ownerDocument = stage.ownerDocument;
    const runtime = await loadWhiteboardRuntime(ownerDocument);
    if (this.isClosed) return;
    const board = ownerDocument.createElement('simple-whiteboard') as SimpleWhiteboard;
    if (typeof board.updateComplete === 'undefined') {
      throw new Error('The simple-whiteboard custom element was not registered in the active Obsidian window.');
    }
    board.hideLocalePicker = true;
    board.dottedBackground = true;
    // Always English, regardless of the host document's language: this
    // plugin's UI is English-only by design, and inheriting Obsidian's
    // interface language here would only translate the whiteboard's own
    // strings (tool-options labels, tooltips), leaving the rest of the
    // plugin's English UI mixed with a partially-translated tool.
    board.locale = 'en';
    board.classList.add('eome-simple-whiteboard');
    // Installed before the element connects, so even its first internal
    // resize call goes through the patched version.
    applyRetinaCanvasFix(board);

    const defaults = ownerDocument.createElement('simple-whiteboard--tool-defaults');
    board.appendChild(defaults);

    const requiredTools = new Set([
      'move', 'pointer', 'rect', 'circle', 'line', 'arrow',
      'pen', 'text', 'sticky', 'picture', 'eraser', 'clear',
    ]);
    const registeredTools = new Set<string>();
    let pressurePenInstalled = false;
    const toolsReady = new Promise<void>((resolve, reject) => {
      const ownerWindow = ownerDocument.defaultView ?? window;
      const timeout = ownerWindow.setTimeout(() => {
        board.removeEventListener('tool-registered', handleToolRegistered);
        const missing = Array.from(requiredTools).filter((name) => !registeredTools.has(name));
        reject(new Error(`Whiteboard tools did not finish registering: ${missing.join(', ')}`));
      }, 5000);
      const finishIfReady = (): void => {
        if (!pressurePenInstalled || Array.from(requiredTools).some((name) => !registeredTools.has(name))) return;
        ownerWindow.clearTimeout(timeout);
        board.removeEventListener('tool-registered', handleToolRegistered);
        resolve();
      };
      const handleToolRegistered = (event: Event): void => {
        const detail = (event as CustomEvent<{ name?: string }>).detail;
        if (!detail?.name) return;
        registeredTools.add(detail.name);
        if (detail.name === 'pen' && !pressurePenInstalled) {
          const originalPen = board.getToolInstance('pen');
          pressurePenInstalled = true;
          const pressurePen = createPressurePenTool(
            board,
            runtime.ItemLib.WhiteboardItem,
            runtime.ToolLib.WhiteboardTool,
            originalPen
          );
          board.registerTool(pressurePen);
          this.pressurePen = pressurePen;
        }
        finishIfReady();
      };
      board.addEventListener('tool-registered', handleToolRegistered);
    });

    stage.appendChild(board);
    await board.updateComplete;
    await toolsReady;
    // Restore the size and colour from the last session before the first
    // paint, so the tool options never briefly show the library's defaults.
    if (this.penPreferences) {
      this.pressurePen?.applyPenOptions(await this.penPreferences.load());
    }
    await board.updateComplete;
    if (this.isClosed) {
      board.remove();
      return;
    }

    const canvas = board.getCanvasElement();
    if (!canvas) throw new Error('simple-whiteboard did not create its canvas element.');
    // The library's hamburger menu only offers a language picker (already
    // hidden via hideLocalePicker) and PNG-download export options that write
    // to the browser's downloads, not the vault - disconnected from this
    // plugin's save-to-vault model and just a confusing extra button here.
    // Its host element is reachable because simple-whiteboard's shadow root
    // is open; that reference stays stable across re-renders.
    const menuHost = board.shadowRoot?.querySelector('simple-whiteboard-menu') as HTMLElement | null;
    if (menuHost) menuHost.style.display = 'none';
    // The library's own floating footer duplicates undo/redo (now in the
    // header above) and adds a zoom selector that only snaps the display to
    // the nearest of a handful of fixed presets (25/50/75/100/150/200/400%)
    // rather than showing the actual live zoom - removing it rather than
    // keeping a control that doesn't do what it visually claims to.
    const footerHost = board.shadowRoot?.querySelector('.footer-tools') as HTMLElement | null;
    if (footerHost) footerHost.style.display = 'none';
    this.inputController = new WhiteboardInputAdapter(board, canvas);
    if (this.initialItems.length > 0) board.importItems(this.initialItems, true);
    board.setCurrentTool('pen');
    board.draw();
    this.board = board;
  }
}
