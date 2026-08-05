import { App, Modal, Notice, setIcon } from 'obsidian';
import type { SimpleWhiteboard } from '@ludovicm67/simple-whiteboard';
import type { ExportedDrawingItem } from './types';
import { loadWhiteboardRuntime, WhiteboardRuntimeCapabilityError } from './whiteboard-runtime';
import { createPressurePenTool, type PressurePenToolControl } from './pressure-pen';
import { WhiteboardInputAdapter } from './whiteboard-input-adapter';
import { applyRetinaCanvasFix } from './retina-canvas';
import type { PenPreferences, PenPreferenceStore } from './pen-preferences';
import { canonicalizeDrawing } from './drawing-changes';

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
    // The lifecycle closer fires when the mindmap view itself goes away, and
    // it must not stop to ask anything: there is nobody left to answer, and
    // the editor cannot outlive the view it belongs to.
    modal.setLifecycleCleanup(registerCloser?.(() => modal.closeWithoutPrompt()) ?? null);
    modal.open();
  });
}

type UnsavedChoice = 'save' | 'discard' | 'keep-editing';

class UnsavedDrawingModal extends Modal {
  private settled = false;

  constructor(app: App, private readonly onChoice: (choice: UnsavedChoice) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Unsaved drawing');
    const container = this.contentEl.createDiv({ cls: 'eome-drawing-unsaved' });
    container.createEl('p', { text: 'This drawing has changes that have not been saved yet.' });

    const buttons = container.createDiv({ cls: 'eome-drawing-unsaved-buttons' });
    const keepEditing = buttons.createEl('button', { text: 'Keep editing' });
    const discard = buttons.createEl('button', { text: "Don't save", cls: 'mod-warning' });
    const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta' });

    keepEditing.addEventListener('click', () => this.settle('keep-editing'));
    discard.addEventListener('click', () => this.settle('discard'));
    save.addEventListener('click', () => this.settle('save'));
    save.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    // Escape or a click outside is not a decision. Reading it as "keep
    // editing" is the only choice here that cannot lose the drawing.
    this.settle('keep-editing');
  }

  private settle(choice: UnsavedChoice): void {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.onChoice(choice);
  }
}

class DrawingModal extends Modal {
  private board: SimpleWhiteboard | null = null;
  private inputController: WhiteboardInputAdapter | null = null;
  private pressurePen: PressurePenToolControl | null = null;
  private settled = false;
  private isClosed = false;
  private lifecycleCleanup: (() => void) | null = null;
  private statusEl: HTMLElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private unsavedPrompt: UnsavedDrawingModal | null = null;
  private isDiscarding = false;
  private savedSnapshot: string | null = null;

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
    header.createEl('p', { text: 'Pencil and finger input both draw. Hold briefly at the end of a stroke to straighten it.' });

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

    this.statusEl = status;
    this.saveButton = saveButton;
    cancelButton.addEventListener('click', () => this.close());
    saveButton.addEventListener('click', () => this.commitSave());

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

  /**
   * Closing is the only way to lose a drawing, so it is the one place that
   * has to ask. Save and the lifecycle closer both mark their intent first,
   * which is why this can treat every remaining call - the Cancel button,
   * Escape, a click outside - as "the user wants out" and nothing else.
   */
  close(): void {
    if (this.isDiscarding || !this.hasUnsavedChanges()) {
      super.close();
      return;
    }
    if (this.unsavedPrompt) return;

    this.unsavedPrompt = new UnsavedDrawingModal(this.app, (choice) => {
      this.unsavedPrompt = null;
      if (this.isClosed) return;
      if (choice === 'save') {
        this.commitSave();
      } else if (choice === 'discard') {
        this.isDiscarding = true;
        this.close();
      }
    });
    this.unsavedPrompt.open();
  }

  /**
   * Closes without asking, for when the mindmap view is going away and the
   * question could not be answered anyway.
   */
  closeWithoutPrompt(): void {
    this.isDiscarding = true;
    this.unsavedPrompt?.close();
    this.unsavedPrompt = null;
    this.close();
  }

  /**
   * Compares the board against what it was opened with, using the same export
   * the save path uses. That makes this exactly the question that matters:
   * would closing now lose something that saving would keep?
   */
  private hasUnsavedChanges(): boolean {
    if (!this.board || this.settled || this.isClosed || this.savedSnapshot === null) return false;
    const current = this.snapshotBoard(this.board);
    // A drawing that cannot be exported cannot be saved either. Offering a
    // dialog whose "Save" is bound to fail would only trap the user.
    return current !== null && current !== this.savedSnapshot;
  }

  private snapshotBoard(board: SimpleWhiteboard): string | null {
    try {
      return canonicalizeDrawing(board.exportItems());
    } catch (error) {
      console.error('Could not read the drawing back from the editor:', error);
      return null;
    }
  }

  private commitSave(): void {
    if (!this.board || this.settled) return;

    let items: ExportedDrawingItem[];
    try {
      items = this.board.exportItems() as ExportedDrawingItem[];
    } catch (error) {
      console.error('Could not export the drawing from the editor:', error);
      this.statusEl?.setText('The drawing could not be prepared for saving. Nothing was changed.');
      new Notice('Could not prepare the drawing for saving.');
      return;
    }

    if (this.saveButton) this.saveButton.disabled = true;
    this.settled = true;
    this.resolveResult({ items });
    this.close();
  }

  onClose(): void {
    this.isClosed = true;
    this.unsavedPrompt?.close();
    this.unsavedPrompt = null;
    // Deliberately also on cancel: the pen's size and colour are preferences
    // for the tool, independent of whether this particular drawing was kept.
    this.persistPenPreferences();
    this.inputController?.destroy();
    this.inputController = null;
    this.pressurePen = null;
    this.board = null;
    this.statusEl = null;
    this.saveButton = null;
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
    // Started before the board exists so the vault read overlaps with building
    // the element instead of queueing behind it.
    const pendingPreferences = this.penPreferences?.load();
    const runtime = await loadWhiteboardRuntime(ownerDocument);
    if (this.isClosed) return;
    // Created through the document so the custom element lands in the right
    // realm; it moves into the modal's stage further down.
    const board = ownerDocument.body.createEl(
      'simple-whiteboard' as 'div'
    ) as unknown as SimpleWhiteboard;
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

    board.createEl('simple-whiteboard--tool-defaults' as 'div');

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
    const menuHost = board.shadowRoot?.querySelector<HTMLElement>('simple-whiteboard-menu');
    menuHost?.setCssStyles({ display: 'none' });
    // The library's own floating footer duplicates undo/redo (now in the
    // header above) and adds a zoom selector that only snaps the display to
    // the nearest of a handful of fixed presets (25/50/75/100/150/200/400%)
    // rather than showing the actual live zoom - removing it rather than
    // keeping a control that doesn't do what it visually claims to.
    const footerHost = board.shadowRoot?.querySelector<HTMLElement>('.footer-tools');
    footerHost?.setCssStyles({ display: 'none' });
    this.inputController = new WhiteboardInputAdapter(board, canvas);
    if (this.initialItems.length > 0) board.importItems(this.initialItems, true);
    board.setCurrentTool('pen');
    board.draw();
    this.board = board;
    // Taken from the board rather than from initialItems, so the import's own
    // normalisation is part of the baseline instead of looking like an edit.
    this.savedSnapshot = this.snapshotBoard(board);

    // Applied after the board can already be drawn on, not before. The size
    // and colour from the last session only affect how the next stroke looks,
    // so blocking the first stroke on a vault read - and on the extra render
    // pass that follows it - bought nothing but a delay. The load was started
    // at the top of this method, so in practice it is already resolved here.
    void this.restorePenPreferences(pendingPreferences);
  }

  private async restorePenPreferences(pending: Promise<PenPreferences> | undefined): Promise<void> {
    if (!pending) return;
    try {
      const preferences = await pending;
      if (this.isClosed) return;
      this.pressurePen?.applyPenOptions(preferences);
    } catch (error) {
      // The editor is fully usable on the library's defaults.
      console.error('Could not restore the pen preferences:', error);
    }
  }
}
