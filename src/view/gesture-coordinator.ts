import { Notice } from 'obsidian';
import { isMoveTargetInsideSourceSubtree } from '../domain/mindmap-file';
import { startNodeEditing } from '../editor/node-editing';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import { clearDropPreview, DropIntent, updateDropPreview } from './overlay-dnd';
import {
  CompletedDirectTapTracker,
  DirectPointerKind,
  directPointerKind,
  DIRECT_GESTURE_CONFIG,
  directPointerLongPressDelay,
  directPointerMovementThreshold,
  directPointerTapTolerance,
} from './pointer-gestures';

export type MindmapGestureMode =
  | 'idle'
  | 'pressed'
  | 'menu'
  | 'drag'
  | 'pan'
  | 'pinch'
  | 'edit';

interface DirectContact {
  id: number;
  kind: DirectPointerKind;
  startX: number;
  startY: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  nodeLine: number | null;
  headingLine: number | null;
  controlOwned: boolean;
  nativeDragBox: HTMLElement | null;
  downEvent: PointerEvent;
}

interface DragSession {
  pointerId: number;
  sourceLine: number;
  sourceBox: HTMLElement;
  ghost: HTMLElement;
  targetBox: HTMLElement | null;
  intent: DropIntent | null;
}

interface CompatibilitySuppression {
  x: number;
  y: number;
  until: number;
  click: boolean;
  contextMenu: boolean;
}

const INTERACTIVE_SELECTOR = [
  '.vertical-toolbar',
  '.layout-options-menu',
  '.node-options-menu',
  '.general-settings-menu',
  '.zoom-options-menu',
  '.node-editor',
  '.cm-editor',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'iframe',
  'video',
  'audio',
  '[contenteditable="true"]',
].join(', ');

// Controls inside the rendered viewport retain their native single-contact
// activation, but are tracked passively so a second direct contact can promote
// both contacts into a pinch. Editors and toolbar controls deliberately stay
// outside this set and continue to own their interaction in isolation.
const VIEWPORT_CONTROL_SELECTOR = [
  '.mindmap-overlay button',
  '.mindmap-overlay a',
  '.mindmap-heading-frame button',
].join(', ');

const MODE_CLASSES = [
  'is-touch-panning',
  'is-touch-pinching',
  'is-touch-dragging',
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * The single owner of direct-input gestures for one mindmap view.
 *
 * Mouse and trackpad input never enters this coordinator and therefore keeps
 * the browser/Obsidian click, dblclick, contextmenu and HTML DnD paths. Touch
 * and Pencil contacts are classified once on pointerdown; later events are
 * matched by pointerId rather than reclassified by WebKit.
 */
export class MindmapGestureCoordinator {
  private readonly abortController = new AbortController();
  private readonly contacts = new Map<number, DirectContact>();
  private readonly completedTaps = new CompletedDirectTapTracker<string>();
  private readonly ownerWindow: Window;
  private mode: MindmapGestureMode = 'idle';
  private primaryPointerId: number | null = null;
  private holdTimer: number | null = null;
  private drag: DragSession | null = null;
  private readonly nativeDragDisableCounts = new Map<HTMLElement, number>();
  private pinchDistance: number | null = null;
  private pinchCenter: { x: number; y: number } | null = null;
  private pinchZoomTarget: number | null = null;
  private compatibilitySuppression: CompatibilitySuppression | null = null;

  constructor(
    private readonly view: MindmapView,
    readonly wrapper: HTMLElement
  ) {
    this.ownerWindow = wrapper.ownerDocument.defaultView ?? window;
    const signal = this.abortController.signal;

    wrapper.addEventListener('pointerdown', this.handlePointerDown, {
      capture: true,
      passive: false,
      signal,
    });
    this.ownerWindow.addEventListener('pointermove', this.handlePointerMove, {
      capture: true,
      passive: false,
      signal,
    });
    this.ownerWindow.addEventListener('pointerup', this.handlePointerEnd, {
      capture: true,
      passive: false,
      signal,
    });
    this.ownerWindow.addEventListener('pointercancel', this.handlePointerEnd, {
      capture: true,
      passive: false,
      signal,
    });
    wrapper.addEventListener('click', this.handleCompatibilityClick, {
      capture: true,
      signal,
    });
    wrapper.addEventListener('contextmenu', this.handleCompatibilityContextMenu, {
      capture: true,
      signal,
    });
    this.ownerWindow.addEventListener('blur', this.handleWindowReset, { signal });
    this.ownerWindow.addEventListener('pagehide', this.handleWindowReset, { signal });
  }

  getMode(): MindmapGestureMode {
    return this.mode;
  }

  isViewportGestureActive(): boolean {
    return this.mode === 'pan' || this.mode === 'pinch';
  }

  isNodeDragActive(): boolean {
    return this.mode === 'drag';
  }

  blocksNodeClick(): boolean {
    return this.mode === 'menu' || this.mode === 'drag' || this.mode === 'pan' || this.mode === 'pinch';
  }

  reset(): void {
    this.clearHoldTimer();
    this.cancelDrag();
    this.releaseAllPointers();
    this.restoreAllNativeDrags();
    this.contacts.clear();
    this.primaryPointerId = null;
    this.pinchDistance = null;
    this.pinchCenter = null;
    this.pinchZoomTarget = null;
    this.completedTaps.cancel();
    this.transition('idle');
  }

  destroy(): void {
    this.reset();
    this.abortController.abort();
  }

  private transition(next: MindmapGestureMode): void {
    this.mode = next;
    this.wrapper.classList.remove(...MODE_CLASSES);
    if (next === 'pan') this.wrapper.classList.add('is-touch-panning');
    if (next === 'pinch') this.wrapper.classList.add('is-touch-pinching');
    if (next === 'drag') this.wrapper.classList.add('is-touch-dragging');
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const kind = directPointerKind(event.pointerType);
    if (!kind || event.button !== 0) return;

    // A new physical contact is an unambiguous sequence boundary. Any delayed
    // compatibility event from the preceding sequence must not consume the
    // native click belonging to this one (notably on an actual checkbox).
    this.compatibilitySuppression = null;

    // A fresh direct contact always closes whatever context menu is open,
    // regardless of pointer kind. This is redundant with the document-level
    // dismiss listener in MindmapView for mouse and Pencil, but a finger tap
    // was observed not reliably reaching that listener's effect (likely
    // Obsidian's own touch backdrop handling the event differently than it
    // does for pen); dismissNodeContextMenu() is a no-op when nothing is open.
    this.view.dismissNodeContextMenu();

    const target = event.target && typeof (event.target as Element).closest === 'function'
      ? event.target as Element
      : null;
    const headingTitle = target?.closest('.mindmap-heading-frame-title') as HTMLElement | null;
    const headingFrame = headingTitle?.closest('[data-heading-frame][data-heading-line]') as HTMLElement | null;
    const parsedHeadingLine = Number(headingFrame?.dataset.headingLine);
    const headingLine = headingFrame && Number.isFinite(parsedHeadingLine) ? parsedHeadingLine : null;
    const interactive = target?.closest(INTERACTIVE_SELECTOR);
    const controlOwned = this.contacts.size === 0 && Boolean(target?.closest(VIEWPORT_CONTROL_SELECTOR));

    // Generic controls (toolbar, editors, modal UI) own an isolated first
    // contact completely. Viewport controls are registered passively below so
    // control-first + second-contact is still a deterministic pinch.
    if (this.contacts.size === 0 && interactive) {
      this.completedTaps.cancel();
      if (!controlOwned) return;
    }
    // Claim only this real touch/Pencil contact. Native mouse and trackpad
    // events never reach this branch and retain their browser behaviours.
    if (!controlOwned) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (this.mode === 'edit' && !this.wrapper.querySelector('.node-editor, .mindmap-heading-editor')) {
      this.transition('idle');
    }

    const box = target?.closest('.mindmap-overlay') as HTMLElement | null;
    const parsedLine = Number(box?.dataset.nodeLine);
    const nodeLine = box && !Number.isNaN(parsedLine) ? parsedLine : null;
    const contact: DirectContact = {
      id: event.pointerId,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      nodeLine,
      headingLine,
      controlOwned,
      nativeDragBox: box,
      downEvent: event,
    };

    if (box && !controlOwned) this.disableNativeDrag(box);
    this.contacts.set(event.pointerId, contact);
    if (this.primaryPointerId === null) this.primaryPointerId = event.pointerId;

    if (this.contacts.size >= 2) {
      this.completedTaps.cancel();
      this.clearHoldTimer();
      this.cancelDrag();
      this.beginPinch();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (controlOwned) {
      // Do not prevent, capture, transition or arm a hold. The semantic control
      // receives its ordinary pointer/click sequence unless a second contact
      // promotes this passive contact into a viewport pinch.
      return;
    }

    this.transition('pressed');
    if (nodeLine !== null) this.armLongPress(contact);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const contact = this.contacts.get(event.pointerId);
    if (!contact) return;

    contact.lastX = contact.x;
    contact.lastY = contact.y;
    contact.x = event.clientX;
    contact.y = event.clientY;

    if (contact.controlOwned && this.mode === 'idle' && this.contacts.size === 1) {
      return;
    }

    // Once pointerdown assigned this ID to an active coordinator gesture, keep
    // the complete sequence on this path. Passive single-control contacts are
    // the only exception handled immediately above.
    event.preventDefault();
    event.stopPropagation();

    if (this.mode === 'pinch') {
      this.updatePinch(event);
      return;
    }

    if (this.mode === 'drag' && this.drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      this.moveDrag(event.clientX, event.clientY);
      return;
    }

    if (event.pointerId !== this.primaryPointerId) return;

    const distance = Math.hypot(contact.x - contact.startX, contact.y - contact.startY);
    const threshold = directPointerMovementThreshold(contact.kind);

    if (this.mode === 'menu') {
      if (distance > threshold && contact.nodeLine !== null) {
        this.beginDrag(contact);
        this.moveDrag(event.clientX, event.clientY);
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (this.mode === 'pressed' && distance > threshold) {
      this.clearHoldTimer();
      this.completedTaps.cancel();
      this.view.dismissNodeContextMenu();
      this.capturePointer(contact.id);
      this.transition('pan');
    }

    if (this.mode !== 'pan') return;

    event.preventDefault();
    event.stopPropagation();
    if (this.view.cy) {
      this.view.cy.panBy({
        x: contact.x - contact.lastX,
        y: contact.y - contact.lastY,
      });
    }
  };

  private handlePointerEnd = (event: PointerEvent): void => {
    const contact = this.contacts.get(event.pointerId);
    if (!contact) return;

    const isIsolatedControlContact = contact.controlOwned && this.mode === 'idle' && this.contacts.size === 1;
    contact.x = event.clientX;
    contact.y = event.clientY;
    if (isIsolatedControlContact) {
      this.contacts.delete(event.pointerId);
      this.primaryPointerId = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const wasCancelled = event.type === 'pointercancel';

    if (wasCancelled) {
      this.completedTaps.cancel();
    }

    if (this.mode === 'drag' && this.drag?.pointerId === event.pointerId) {
      this.suppressCompatibilityEvents(contact.x, contact.y);
      if (wasCancelled) {
        this.cancelDrag();
      } else {
        void this.completeDrag();
      }
    } else if (this.mode === 'pressed' && event.pointerId === this.primaryPointerId) {
      this.clearHoldTimer();
      if (!wasCancelled) this.completeTap(contact, event);
    } else if (this.mode === 'menu' && event.pointerId === this.primaryPointerId) {
      this.suppressCompatibilityEvents(contact.x, contact.y);
      event.preventDefault();
      event.stopPropagation();
      this.transition('idle');
    } else if (this.mode === 'pan' || this.mode === 'pinch') {
      this.suppressCompatibilityEvents(contact.x, contact.y);
      event.preventDefault();
      event.stopPropagation();
    }

    this.releasePointer(event.pointerId);
    this.restoreNativeDrag(contact.nativeDragBox);
    this.contacts.delete(event.pointerId);

    if (this.contacts.size === 0) {
      const wasViewportGesture = this.mode === 'pan' || this.mode === 'pinch';
      this.clearHoldTimer();
      this.primaryPointerId = null;
      this.pinchDistance = null;
      this.pinchCenter = null;
      this.pinchZoomTarget = null;
      if (this.mode !== 'edit') this.transition('idle');
      if (wasViewportGesture) this.ownerWindow.requestAnimationFrame(() => this.view.updateOverlayGeometry());
      return;
    }

    if (this.mode === 'pinch') {
      if (this.contacts.size >= 2) {
        const state = this.getPinchState();
        const firstRemaining = this.contacts.values().next().value;
        this.primaryPointerId = firstRemaining?.id ?? null;
        this.pinchDistance = state?.distance ?? null;
        this.pinchCenter = state?.center ?? null;
        return;
      }

      const remaining = this.contacts.values().next().value;
      this.primaryPointerId = remaining?.id ?? null;
      this.pinchDistance = null;
      this.pinchCenter = null;
      this.pinchZoomTarget = null;
      if (remaining) {
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.lastX = remaining.x;
        remaining.lastY = remaining.y;
        this.transition('pan');
      }
    }
  };

  private completeTap(contact: DirectContact, event: PointerEvent): void {
    const distance = Math.hypot(contact.x - contact.startX, contact.y - contact.startY);
    if (distance > directPointerTapTolerance(contact.kind)) {
      this.completedTaps.cancel();
      return;
    }

    this.suppressCompatibilityEvents(contact.x, contact.y);
    event.preventDefault();
    event.stopPropagation();

    if (contact.headingLine !== null) {
      const isDoubleTap = this.completedTaps.completeTap({
        target: `heading:${contact.headingLine}`,
        kind: contact.kind,
        x: contact.x,
        y: contact.y,
        at: Date.now(),
      });
      if (!isDoubleTap) return;

      this.view.clearSelection();
      this.view.dismissNodeContextMenu();
      void this.view.enterEditModeForHeadingByLine(contact.headingLine);
      this.transition('edit');
      return;
    }

    if (contact.nodeLine === null) {
      this.completedTaps.cancel();
      this.view.clearSelection();
      return;
    }

    const node = this.view.getNodeByLine(contact.nodeLine);
    const box = this.findOverlay(contact.nodeLine);
    if (!node || !box) {
      this.completedTaps.cancel();
      return;
    }

    const checkbox = box.querySelector<HTMLElement>('.checkbox-toggle');
    if (box.classList.contains('has-checkbox') && checkbox) {
      const rect = checkbox.getBoundingClientRect();
      // The 24px control plus 10px on each side yields a conventional ~44px
      // direct-input target without consuming ordinary taps in the node body.
      const padding = 10;
      if (
        contact.x >= rect.left - padding &&
        contact.x <= rect.right + padding &&
        contact.y >= rect.top - padding &&
        contact.y <= rect.bottom + padding
      ) {
        this.completedTaps.cancel();
        void this.view.toggleNodeCheckbox(node);
        return;
      }
    }

    const isDoubleTap = this.completedTaps.completeTap({
      target: `node:${contact.nodeLine}`,
      kind: contact.kind,
      x: contact.x,
      y: contact.y,
      at: Date.now(),
    });

    if (!isDoubleTap) {
      this.view.selectNode(contact.nodeLine, event.shiftKey || event.metaKey || event.ctrlKey);
      return;
    }

    this.view.clearSelection();
    this.view.dismissNodeContextMenu();
    const editor = startNodeEditing(box, node, this.view);
    if (!editor) return;
    this.transition('edit');
  }

  private armLongPress(contact: DirectContact): void {
    this.clearHoldTimer();
    this.holdTimer = this.ownerWindow.setTimeout(() => {
      this.holdTimer = null;
      if (
        this.mode !== 'pressed' ||
        this.primaryPointerId !== contact.id ||
        !this.contacts.has(contact.id) ||
        contact.nodeLine === null
      ) {
        return;
      }

      const distance = Math.hypot(contact.x - contact.startX, contact.y - contact.startY);
      if (distance > directPointerMovementThreshold(contact.kind)) return;

      this.completedTaps.cancel();
      this.suppressCompatibilityEvents(contact.x, contact.y);
      this.view.selectNode(contact.nodeLine);
      this.transition('menu');
      this.view.showNodeContextMenu(contact.downEvent, contact.nodeLine);
    }, directPointerLongPressDelay(contact.kind));
  }

  private clearHoldTimer(): void {
    if (this.holdTimer === null) return;
    this.ownerWindow.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private beginPinch(): void {
    this.view.dismissNodeContextMenu();
    this.transition('pinch');
    for (const contact of this.contacts.values()) this.capturePointer(contact.id);
    const state = this.getPinchState();
    this.pinchDistance = state?.distance ?? null;
    this.pinchCenter = state?.center ?? null;
    this.pinchZoomTarget = this.view.cy?.zoom() ?? null;
  }

  private updatePinch(event: PointerEvent): void {
    const state = this.getPinchState();
    if (!state || state.distance <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    if (this.view.cy && this.pinchDistance && this.pinchCenter) {
      const rect = this.view.cy.container()?.getBoundingClientRect();
      // Accumulate against the unrounded gesture target. Reading a rounded
      // runtime/display value on every move would discard slow sub-0.01 deltas.
      const currentTarget = this.pinchZoomTarget ?? this.view.cy.zoom();
      const unboundedZoom = currentTarget * (state.distance / this.pinchDistance);
      const nextZoom = Math.max(
        this.view.cy.minZoom(),
        Math.min(this.view.cy.maxZoom(), unboundedZoom)
      );
      this.pinchZoomTarget = nextZoom;
      this.view.setZoomFactor(nextZoom, true, {
        x: rect ? state.center.x - rect.left : state.center.x,
        y: rect ? state.center.y - rect.top : state.center.y,
      });
      this.view.cy.panBy({
        x: state.center.x - this.pinchCenter.x,
        y: state.center.y - this.pinchCenter.y,
      });
    }

    this.pinchDistance = state.distance;
    this.pinchCenter = state.center;
  }

  private getPinchState(): { distance: number; center: { x: number; y: number } } | null {
    const [first, second] = Array.from(this.contacts.values());
    if (!first || !second) return null;
    return {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      center: {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      },
    };
  }

  private beginDrag(contact: DirectContact): void {
    if (contact.nodeLine === null) return;
    const sourceBox = this.findOverlay(contact.nodeLine);
    if (!sourceBox) return;

    this.view.dismissNodeContextMenu();
    this.clearHoldTimer();
    this.completedTaps.cancel();
    this.capturePointer(contact.id);
    this.view.selectNode(contact.nodeLine);

    const ghost = sourceBox.ownerDocument.createElement('div');
    ghost.className = 'mindmap-touch-drag-ghost';
    const content = sourceBox.querySelector('.markdown-rendered')?.cloneNode(true) as HTMLElement | undefined;
    if (content) {
      content.classList.add('mindmap-touch-drag-ghost-content');
      content.style.removeProperty('--mindmap-scale');
      ghost.appendChild(content);
    }
    sourceBox.ownerDocument.body.appendChild(ghost);

    const rect = sourceBox.getBoundingClientRect();
    ghost.setCssProps({
      '--touch-drag-width': `${Math.max(80, Math.round(rect.width * 0.92))}px`,
      '--touch-drag-height': `${Math.max(40, Math.round(rect.height * 0.92))}px`,
    });
    sourceBox.classList.add('mm-src');
    this.drag = {
      pointerId: contact.id,
      sourceLine: contact.nodeLine,
      sourceBox,
      ghost,
      targetBox: null,
      intent: null,
    };
    this.transition('drag');
  }

  private moveDrag(clientX: number, clientY: number): void {
    if (!this.drag) return;
    this.drag.ghost.setCssProps({
      '--touch-drag-left': `${clientX}px`,
      '--touch-drag-top': `${clientY}px`,
    });

    const target = this.getDropTargetAtPoint(clientX, clientY);
    if (target !== this.drag.targetBox) {
      this.clearDragTarget();
      this.drag.targetBox = target;
      target?.classList.add('mm-tgt');
    }

    if (!target) return;
    const source = this.view.getNodeByLine(this.drag.sourceLine);
    if (target.classList.contains('mindmap-empty-heading-drop-target')) {
      target.classList.remove('mm-tgt-invalid');
      this.drag.intent = { kind: 'child', childInsertPosition: 'last' };
      this.drag.ghost.classList.add('is-over-target');
      return;
    }

    const targetLine = Number(target.dataset.nodeLine);
    const targetNode = Number.isNaN(targetLine) ? null : this.view.getNodeByLine(targetLine);
    if (
      !source ||
      !targetNode ||
      targetNode.line === source.line ||
      isMoveTargetInsideSourceSubtree(source, targetNode)
    ) {
      clearDropPreview(target);
      target.classList.add('mm-tgt-invalid');
      this.drag.intent = null;
      this.drag.ghost.classList.remove('is-over-target');
      return;
    }

    target.classList.remove('mm-tgt-invalid');
    this.drag.intent = updateDropPreview({ clientX, clientY }, target, {
      targetHasChildren: targetNode.children.length > 0,
    });
    this.drag.ghost.classList.add('is-over-target');
  }

  private async completeDrag(): Promise<void> {
    const drag = this.drag;
    if (!drag) return;
    const targetBox = drag.targetBox;
    const intent = drag.intent;
    const sourceLine = drag.sourceLine;
    this.finishDragPresentation();

    if (!this.view.file || !targetBox) return;
    const source = this.view.getNodeByLine(sourceLine);
    if (!source) return;

    try {
      if (targetBox.classList.contains('mindmap-empty-heading-drop-target')) {
        const headingLine = Number(targetBox.dataset.headingLine);
        if (!Number.isNaN(headingLine)) {
          await this.view.executeMoveSubtreeToEmptyHeadingCommand(source, headingLine);
        }
        return;
      }

      const targetLine = Number(targetBox.dataset.nodeLine);
      const target = Number.isNaN(targetLine) ? null : this.view.getNodeByLine(targetLine);
      if (
        !target ||
        !intent ||
        target.line === source.line ||
        isMoveTargetInsideSourceSubtree(source, target)
      ) return;
      await this.view.executeMoveSubtreeCommand(
        source,
        target,
        intent.kind === 'child',
        intent.kind === 'child' ? intent.childInsertPosition : 'last',
        intent.kind === 'sibling' ? intent.siblingInsertPosition : 'after'
      );
    } catch (error) {
      console.error('Direct-input move subtree failed:', error);
      new Notice('Move failed: ' + errorMessage(error));
    }
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    this.finishDragPresentation();
  }

  private finishDragPresentation(): void {
    if (!this.drag) return;
    this.clearDragTarget();
    this.drag.sourceBox.classList.remove('mm-src');
    this.drag.ghost.remove();
    this.drag = null;
    this.transition('idle');
  }

  private clearDragTarget(): void {
    const target = this.drag?.targetBox;
    if (!target) return;
    target.classList.remove('mm-tgt');
    clearDropPreview(target);
    this.drag?.ghost.classList.remove('is-over-target');
    if (this.drag) {
      this.drag.targetBox = null;
      this.drag.intent = null;
    }
  }

  private getDropTargetAtPoint(clientX: number, clientY: number): HTMLElement | null {
    const doc = this.wrapper.ownerDocument;
    const candidates = typeof doc.elementsFromPoint === 'function'
      ? doc.elementsFromPoint(clientX, clientY)
      : [doc.elementFromPoint(clientX, clientY)].filter((element): element is Element => Boolean(element));

    for (const candidate of candidates) {
      const target = candidate.closest<HTMLElement>('.mindmap-overlay, .mindmap-empty-heading-drop-target');
      if (target && this.wrapper.contains(target)) return target;
    }
    return null;
  }

  private findOverlay(nodeLine: number): HTMLElement | null {
    return this.wrapper.querySelector<HTMLElement>(`.mindmap-overlay[data-node-line="${nodeLine}"]`);
  }

  private capturePointer(pointerId: number): void {
    try {
      if (!this.wrapper.hasPointerCapture(pointerId)) this.wrapper.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is an optimization; ownerWindow listeners remain the
      // authoritative completion path in iOS WebViews and Obsidian pop-outs.
    }
  }

  private releasePointer(pointerId: number): void {
    try {
      if (this.wrapper.hasPointerCapture(pointerId)) this.wrapper.releasePointerCapture(pointerId);
    } catch {
      // A cancelled pointer may already have lost capture.
    }
  }

  private releaseAllPointers(): void {
    for (const pointerId of this.contacts.keys()) this.releasePointer(pointerId);
  }

  private disableNativeDrag(box: HTMLElement): void {
    const count = this.nativeDragDisableCounts.get(box) ?? 0;
    this.nativeDragDisableCounts.set(box, count + 1);
    box.draggable = false;
  }

  private restoreNativeDrag(box: HTMLElement | null): void {
    if (!box) return;
    const count = this.nativeDragDisableCounts.get(box);
    if (!count) return;
    if (count > 1) {
      this.nativeDragDisableCounts.set(box, count - 1);
      return;
    }
    this.nativeDragDisableCounts.delete(box);
    if (box.isConnected && !box.classList.contains('editing')) box.draggable = true;
  }

  private restoreAllNativeDrags(): void {
    for (const box of this.nativeDragDisableCounts.keys()) {
      if (box.isConnected && !box.classList.contains('editing')) box.draggable = true;
    }
    this.nativeDragDisableCounts.clear();
  }

  private suppressCompatibilityEvents(x: number, y: number): void {
    this.compatibilitySuppression = {
      x,
      y,
      until: Date.now() + DIRECT_GESTURE_CONFIG.compatibilityMouseMs,
      click: true,
      contextMenu: true,
    };
  }

  private handleCompatibilityClick = (event: MouseEvent): void => {
    const suppression = this.compatibilitySuppression;
    if (!suppression?.click || !this.matchesCompatibilityEvent(event, suppression)) return;
    suppression.click = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private handleCompatibilityContextMenu = (event: MouseEvent): void => {
    const suppression = this.compatibilitySuppression;
    if (!suppression?.contextMenu || !this.matchesCompatibilityEvent(event, suppression)) return;
    suppression.contextMenu = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private matchesCompatibilityEvent(event: MouseEvent, suppression: CompatibilitySuppression): boolean {
    const pointerType = 'pointerType' in event ? String(event.pointerType) : '';
    if (pointerType === 'mouse') return false;
    if (Date.now() > suppression.until) return false;
    return Math.hypot(event.clientX - suppression.x, event.clientY - suppression.y) <=
      DIRECT_GESTURE_CONFIG.compatibilityMouseDistancePx;
  }

  private handleWindowReset = (): void => {
    this.view.dismissNodeContextMenu();
    this.reset();
  };
}
