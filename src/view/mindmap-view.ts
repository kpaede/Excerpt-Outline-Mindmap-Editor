// src/view/mindmap-view.ts

import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  Notice,
  Platform,
  Menu,
  type EventRef,
  type TAbstractFile,
} from 'obsidian';
import { Core } from 'cytoscape';

import '../styles/dnd-css';

import { parseOutline, OutlineNode, isOutlineCompatible, isEmptyContent } from '../utils/outline';
import { HeadingSection, parseHeadingSections } from '../utils/heading-sections';
import { VIEW_TYPE_MINDMAP } from '../constants';
import MindmapPlugin from '../main';
import {
  addChild,
  addSibling,
  addEmptyNodeToHeading,
  writeNode,
  setNodesCheckbox,
  deleteNode,
  deleteMultipleNodes,
  deleteMultipleNodesKeepChildren,
  moveSubtree,
  moveSubtreeToEmptyHeading,
  addChildText,
  addSiblingText,
  addMarkdownAsChildren,
  addHeadingBeforeNode,
  cutPasteMarkdownAsChildren,
  duplicateSubtree,
  deleteNodeKeepChildren,
  deleteHeading,
  writeHeading,
  DocString,
  ChildInsertPosition,
  SiblingInsertPosition,
  isMoveTargetInsideSourceSubtree,
} from '../domain/mindmap-file';
import { VerticalToolbar } from '../ui/toolbar/vertical-toolbar';
import { draw as drawMindmap } from './draw';
import { initializeViewport } from './initial-viewport';
import { updateTaskOverlays } from './task-overlay-update';
import { NodeRenderResources } from './node-render-resources';
import { MeasurementCache } from './measurement-cache';
import { commandNodeIdentities, type CommandContext } from './command-identities';
import {
  updateOverlayGeometry as updateOverlayGeometryFn,
  updateOverlays as updateOverlaysFn,
  startNodeEditing,
} from './update-overlays';
import { NodeOptions } from '../ui/menus/node-options-menu';
import { DeleteNodeModal } from '../ui/modals/delete-node-modal';
import { FrontmatterStorage } from '../storage/frontmatter-storage';
import { commitDocument } from '../storage/document-writer';
import { OutlineSession } from '../domain/outline-session';
import { FORMAT_KEY, outlineVersion } from '../domain/outline-format';
import { CommandHistory, MindmapCommand } from '../history/command-history';
import { PenPreferenceStore } from '../drawing/pen-preferences';
import { extractEmbedLinks } from '../drawing/drawing-link';
import { AttachmentVersions, embeddedAttachments } from './attachment-versions';

// Long enough to collapse an autosave burst into one redraw, short enough
// that a finished drawing appears to update as soon as it is saved.
const ATTACHMENT_REFRESH_DELAY_MS = 250;
// Covers the window in which another plugin's own handler for the activation
// event is still writing the file it was asked to save.
const ACTIVATION_RECHECK_DELAY_MS = 600;
import { GeneralSettings } from '../ui/menus/general-settings-menu';
import { createDefaultLayoutOptions, LayoutOptions, normalizeEdgeStyle } from '../domain/layout-options';
import { MindmapViewState, SelectionSnapshot } from './view-state';
import { sortByMarkdownOrder } from '../utils/cytoscape';
import { resetToolbarPlacement } from '../ui/toolbar/toolbar-placement';
import { showNodeContextMenu as showNodeContextMenuFn } from './context-menu';
import { navigateSelection as navigateSelectionFn, NavigationDirection } from './navigation';
import { startHeadingEditing } from './heading-frames';
import {
  copyNodesToClipboard as copyNodesToClipboardFn,
  cutNodesToClipboard as cutNodesToClipboardFn,
  getTopLevelNodes as getTopLevelNodesFn,
  pasteClipboardAsChildren as pasteClipboardAsChildrenFn,
} from './clipboard';
import { eventPathContainsSelector, eventTargetsObsidianMenu } from './menu-dismissal';
import { MindmapGestureCoordinator } from './gesture-coordinator';
import { AnimationFrameHost, RenderLifecycle } from './render-lifecycle';
import { refreshMindmapTheme } from './theme';
import { applyEdgeRouting } from './edge-routing';

export type { LayoutOptions, MindmapViewState };

export class MindmapView extends TextFileView {
  /** Host capability; standalone views keep structural heading commands. */
  public supportsStructuralHeadings = true;
  public file: TFile | null = null;
  public cy?: Core;
  public wrapper!: HTMLDivElement;
  public firstFitDone = false;
  public toolbar?: VerticalToolbar;
  public isUpdatingOverlays = false;
  public frontmatterStorage: FrontmatterStorage;
  public commandHistory: CommandHistory;
  public selectedNodeLines: Set<number> = new Set();
  public pendingEditNodeLine: number | null = null;
  private activeNodeContextMenu: Menu | null = null;
  private interactionDocument: Document | null = null;
  private gestureCoordinator: MindmapGestureCoordinator | null = null;
  private transientClosers = new Set<() => void>();
  private readonly renderLifecycle = new RenderLifecycle();
  public readonly nodeRenderResources = new NodeRenderResources(this);
  private isViewClosed = false;
  private attachmentRefreshTimeout: number | null = null;
  private activationRecheckTimeout: number | null = null;
  private vaultModifyRef: EventRef | null = null;
  private activeLeafChangeRef: EventRef | null = null;
  private themeChangeRef: EventRef | null = null;
  public readonly attachmentVersions = new AttachmentVersions();
  private embeddedPathsCache: { data: string; paths: Set<string> } | null = null;

  // Box selection properties
  private selectionBoxEl: HTMLDivElement | null = null;
  private isBoxSelecting: boolean = false;
  private isBoxSelectionInitialized: boolean = false;
  private isViewportWheelInitialized: boolean = false;
  private isMiddleMousePanning: boolean = false;
  private hasDraggedSelectionBox: boolean = false;
  private suppressNextEmptyClick: boolean = false;
  public mindmapClipboardText: string | null = null;
  public pendingCutNodeLines: Set<number> = new Set();
  private selectionHistory: SelectionSnapshot[] = [];
  private zoomSaveTimeout: number | null = null;
  private boxStartX: number = 0;
  private boxStartY: number = 0;
  private middlePanLastX: number = 0;
  private middlePanLastY: number = 0;
  private mobileToolbarPlacementTimeouts: number[] = [];
  private orientationMediaQuery: MediaQueryList | null = null;
  private screenOrientation: ScreenOrientation | null = null;
  private viewEventController: AbortController | null = null;
  private zoomingClassTimeout: number | null = null;
  private handleMenuDismissPointerDown = (event: Event): void => {
    if (!eventTargetsObsidianMenu(event)) {
      this.dismissNodeContextMenu();
    }
    if (
      eventPathContainsSelector(
        event,
        '.vertical-toolbar, .layout-options-menu, .node-options-menu, .general-settings-menu, .zoom-options-menu'
      )
    ) {
      return;
    }

    this.toolbar?.closeMenus();
  };
  public setActiveNodeContextMenu(menu: Menu): void {
    this.activeNodeContextMenu?.hide();
    this.activeNodeContextMenu = menu;
    menu.onHide(() => {
      if (this.activeNodeContextMenu === menu) {
        this.activeNodeContextMenu = null;
      }
    });
  }

  public dismissNodeContextMenu(): void {
    // onHide is the sole owner of clearing this reference. Obsidian can defer
    // DOM-menu dismissal on iPad; retaining it lets subsequent outside events
    // retry instead of leaving an orphaned, no-longer-addressable menu open.
    this.activeNodeContextMenu?.hide();
  }

  private readonly isTouchDevice: boolean =
    Platform.isMobile ||
    Platform.isMobileApp ||
    Platform.isPhone ||
    Platform.isTablet ||
    typeof navigator !== 'undefined' && (
      navigator.maxTouchPoints > 0 ||
      window.matchMedia?.('(pointer: coarse)').matches
    );

  /**
   * Map von OutlineNode.line → gemessene Breite/Höhe (in px).
   * Wird von draw() gefüllt und später in updateOverlays() verwendet.
   */
  public sizeMap: Map<number, { w: number; h: number }> = new Map();
  public measurementCache = new MeasurementCache<{ w: number; h: number; scaleFactor?: number }>();

  /**
   * Layout-Optionen, die sich über das Modal ändern lassen.
   */
  public layoutOptions = createDefaultLayoutOptions();

  /**
   * Diese Methode wrappers die freie Funktion aus updateOverlays.ts
   * und bindet sie an die aktuelle Instanz.
   */
  public updateOverlays = (): void => {
    updateOverlaysFn(this);
  };

  public updateOverlayGeometry = (): boolean => {
    return updateOverlayGeometryFn(this);
  };

  public isRenderGenerationCurrent(generation: number): boolean {
    return !this.isViewClosed && this.renderLifecycle.isCurrent(generation);
  }

  public isRenderContextCurrent(generation: number, cy: Core): boolean {
    return this.isRenderGenerationCurrent(generation) &&
      this.cy === cy &&
      !cy.destroyed() &&
      !!this.wrapper?.isConnected;
  }

  public requestOverlayUpdateFrame(callback: () => void): boolean {
    return this.requestRenderFrame('overlay-update', callback, () => {
      this.isUpdatingOverlays = false;
    });
  }

  public requestOverlayGeometryFrame(callback: () => void): boolean {
    return this.requestRenderFrame('overlay-geometry', callback);
  }

  public requestPostOverlayFrame(callback: () => void): boolean {
    return this.requestRenderFrame('post-overlay', callback);
  }

  public cancelScheduledRenderFrames(): void {
    this.renderLifecycle.cancelFrames();
    this.isUpdatingOverlays = false;
  }

  private requestRenderFrame(
    key: string,
    callback: () => void,
    onDiscard?: () => void
  ): boolean {
    const cy = this.cy;
    const wrapper = this.wrapper;
    const frameHost = wrapper?.ownerDocument.defaultView as AnimationFrameHost | null | undefined;
    if (!cy || !wrapper || !frameHost || !this.isRenderContextCurrent(this.renderLifecycle.currentGeneration(), cy)) {
      onDiscard?.();
      return false;
    }

    const generation = this.renderLifecycle.currentGeneration();
    return this.renderLifecycle.scheduleFrame(
      key,
      frameHost,
      generation,
      () => this.wrapper === wrapper && this.isRenderContextCurrent(generation, cy),
      callback,
      onDiscard
    );
  }

  public isDirectViewportGestureActive(): boolean {
    return this.gestureCoordinator?.isViewportGestureActive() ?? false;
  }

  public isDirectNodeDragActive(): boolean {
    return this.gestureCoordinator?.isNodeDragActive() ?? false;
  }

  public isDirectGestureBlockingNodeClick(): boolean {
    return this.gestureCoordinator?.blocksNodeClick() ?? false;
  }

  public resetDirectGestures(): void {
    this.gestureCoordinator?.reset();
  }

  public prepareWrapper(): void {
    if (!this.wrapper) return;
    if (!this.viewEventController) {
      this.viewEventController = new AbortController();
    }
    this.wrapper.tabIndex = 0;
    this.wrapper.classList.toggle('is-touch-device', this.isTouchDevice);
    this.updateMobileToolbarPlacement();
    this.wrapper.onkeydown = this.handleWrapperKeydown;
    this.initBoxSelection();
    this.initViewportWheelControls();
    if (!this.gestureCoordinator || this.gestureCoordinator.wrapper !== this.wrapper) {
      this.gestureCoordinator?.destroy();
      this.gestureCoordinator = new MindmapGestureCoordinator(this, this.wrapper);
    }
  }

  private updateMobileToolbarPlacement = (): void => {
    if (!this.wrapper) return;
    resetToolbarPlacement(this.wrapper);
  };

  public refreshMobileToolbarPlacement(): void {
    this.scheduleMobileToolbarPlacementUpdate();
  }

  private scheduleMobileToolbarPlacementUpdate = (): void => {
    this.updateMobileToolbarPlacement();
    this.mobileToolbarPlacementTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    this.mobileToolbarPlacementTimeouts = [80, 250, 600].map((delay) =>
      window.setTimeout(this.updateMobileToolbarPlacement, delay)
    );
  };

  private initBoxSelection(): void {
    if (this.isBoxSelectionInitialized) return;
    this.isBoxSelectionInitialized = true;
    const signal = this.viewEventController?.signal;

    this.wrapper.addEventListener('click', (e) => {
      if (this.suppressNextEmptyClick) {
        this.suppressNextEmptyClick = false;
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '.mindmap-overlay, .mindmap-heading-frame, .mindmap-heading-editor, .vertical-toolbar, .node-editor, .cm-editor, button, a, input, select, textarea, [contenteditable="true"]'
        )
      ) {
        return;
      }

      this.clearSelection();
    }, { signal });

    this.wrapper.addEventListener('contextmenu', (e) => {
      if (this.isDirectNodeDragActive()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      this.showNodeContextMenu(e);
    }, { signal });

    this.wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      if (
        !target?.closest(
          '.vertical-toolbar, .layout-options-menu, .node-options-menu, .general-settings-menu, .zoom-options-menu'
        )
      ) {
        this.toolbar?.closeMenus();
      }

      if (
        target?.closest(
          '.mindmap-overlay, .mindmap-heading-frame, .mindmap-heading-editor, .vertical-toolbar, .node-editor, .cm-editor, button, a, input, select, textarea, [contenteditable="true"]'
        )
      ) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      this.dismissNodeContextMenu();

      this.isBoxSelecting = true;
      this.hasDraggedSelectionBox = false;
      const rect = this.wrapper.getBoundingClientRect();
      this.boxStartX = e.clientX - rect.left;
      this.boxStartY = e.clientY - rect.top;

      if (!this.selectionBoxEl) {
        this.selectionBoxEl = createDiv();
        this.selectionBoxEl.className = 'mindmap-selection-box';
        this.wrapper.appendChild(this.selectionBoxEl);
      }

      this.selectionBoxEl.setCssStyles({
        display: 'block',
        left: `${this.boxStartX}px`,
        top: `${this.boxStartY}px`,
        width: '0px',
        height: '0px',
      });
      
      // Make overlays unclickable during drag so they don't interfere
      this.wrapper.classList.add('is-box-selecting');
    }, { capture: true, signal });

    window.addEventListener('mousemove', (e) => {
      if (!this.isBoxSelecting || !this.selectionBoxEl) return;
      e.preventDefault();

      const rect = this.wrapper.getBoundingClientRect();
      let currentX = e.clientX - rect.left;
      let currentY = e.clientY - rect.top;

      // Constrain visually within wrapper
      currentX = Math.max(0, Math.min(currentX, rect.width));
      currentY = Math.max(0, Math.min(currentY, rect.height));

      const left = Math.min(this.boxStartX, currentX);
      const top = Math.min(this.boxStartY, currentY);
      const width = Math.abs(currentX - this.boxStartX);
      const height = Math.abs(currentY - this.boxStartY);
      this.hasDraggedSelectionBox = width > 3 || height > 3;

      this.selectionBoxEl.setCssStyles({
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    }, { signal });

    window.addEventListener('mouseup', (e) => {
      if (!this.isBoxSelecting) return;
      e.preventDefault();
      e.stopPropagation();
      this.isBoxSelecting = false;
      this.suppressNextEmptyClick = this.hasDraggedSelectionBox;
      this.wrapper.classList.remove('is-box-selecting');

      if (this.selectionBoxEl) {
        const boxRect = this.selectionBoxEl.getBoundingClientRect();
        const overlays = this.wrapper.querySelectorAll('.mindmap-overlay');
        const newlySelected = new Set<number>();
        
        overlays.forEach((overlay) => {
          const nodeRect = overlay.getBoundingClientRect();
          // Check for intersection
          if (
            boxRect.left < nodeRect.right &&
            boxRect.right > nodeRect.left &&
            boxRect.top < nodeRect.bottom &&
            boxRect.bottom > nodeRect.top
          ) {
            const line = Number((overlay as HTMLElement).dataset.nodeLine);
            if (!isNaN(line)) newlySelected.add(line);
          }
        });

        if (!e.shiftKey) {
          this.selectedNodeLines.clear();
        }

        newlySelected.forEach(line => this.selectedNodeLines.add(line));
        this.updateSelectionStyling();
        this.wrapper?.focus();

        this.selectionBoxEl.setCssStyles({ display: 'none' });
      }
    }, { signal });
  }

  private initViewportWheelControls(): void {
    if (this.isViewportWheelInitialized) return;
    this.isViewportWheelInitialized = true;
    const signal = this.viewEventController?.signal;

    this.wrapper.addEventListener('mousedown', (event) => {
      if (event.button !== 1 || !this.cy) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          '.vertical-toolbar, .node-editor, .cm-editor, button, a, input, textarea, select, pre, code, iframe, video, audio, [contenteditable="true"]'
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      this.isMiddleMousePanning = true;
      this.middlePanLastX = event.clientX;
      this.middlePanLastY = event.clientY;
      this.wrapper.classList.add('is-middle-mouse-panning');
      this.wrapper.focus();
    }, { capture: true, signal });

    this.wrapper.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true, signal });

    window.addEventListener('mousemove', (event) => {
      if (!this.isMiddleMousePanning || !this.cy) return;

      event.preventDefault();
      event.stopPropagation();

      this.cy.panBy({
        x: event.clientX - this.middlePanLastX,
        y: event.clientY - this.middlePanLastY,
      });

      this.middlePanLastX = event.clientX;
      this.middlePanLastY = event.clientY;
    }, { capture: true, signal });

    window.addEventListener('mouseup', (event) => {
      if (!this.isMiddleMousePanning || event.button !== 1) return;

      event.preventDefault();
      event.stopPropagation();

      this.isMiddleMousePanning = false;
      this.wrapper.classList.remove('is-middle-mouse-panning');
    }, { capture: true, signal });

    this.wrapper.addEventListener('wheel', (event) => {
      if (!this.cy) return;
      this.dismissNodeContextMenu();

      const scrollTarget = event.target as HTMLElement | null;
      if (scrollTarget?.closest('.node-editor, .cm-editor') && scrollTarget.closest('.cm-scroller')) return;

      if (this.wrapper.querySelector('.node-editor, .mindmap-heading-editor')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          '.vertical-toolbar, .node-editor, .cm-editor, input, textarea, select, pre, code, iframe, video, audio, [contenteditable="true"]'
        )
      ) {
        if (target.closest('.node-editor, .cm-editor')) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.ctrlKey) {
        const currentZoom = this.cy.zoom();
        const zoomFactor = Math.exp(-event.deltaY * 0.006);
        const nextZoom = Math.max(this.cy.minZoom(), Math.min(this.cy.maxZoom(), currentZoom * zoomFactor));
        const containerRect = this.cy.container()?.getBoundingClientRect();

        this.setZoomFactor(nextZoom, true, {
          x: containerRect ? event.clientX - containerRect.left : event.clientX,
          y: containerRect ? event.clientY - containerRect.top : event.clientY,
        });
        return;
      }

      this.cy.panBy({
        x: -event.deltaX,
        y: -event.deltaY,
      });
    }, { capture: true, passive: false, signal });
  }

  public showNodeContextMenu(event: MouseEvent, explicitNodeLine?: number): void {
    showNodeContextMenuFn(this, event, explicitNodeLine);
  }

  private getTopLevelNodes(nodes: OutlineNode[]): OutlineNode[] {
    return getTopLevelNodesFn(nodes);
  }

  public async copyNodesToClipboard(nodes: OutlineNode[]): Promise<boolean> {
    return copyNodesToClipboardFn(this, nodes);
  }

  public async copySelectionAsMarkdown(): Promise<boolean> {
    const nodes = this.getSelectedNodes();
    if (nodes.length === 0) {
      new Notice('No nodes selected.');
      return false;
    }

    const copied = await this.copyNodesToClipboard(nodes);
    if (copied) {
      new Notice('Copied selection as Markdown.');
    }
    return copied;
  }

  public async cutNodesToClipboard(nodes: OutlineNode[]): Promise<void> {
    await cutNodesToClipboardFn(this, nodes);
  }

  private hasUnselectedDescendants(nodes: OutlineNode[], selectedLines: Set<number>): boolean {
    const hasUnselectedDescendant = (node: OutlineNode): boolean => {
      for (const child of node.children) {
        if (!selectedLines.has(child.line)) return true;
        if (hasUnselectedDescendant(child)) return true;
      }

      return false;
    };

    return nodes.some(hasUnselectedDescendant);
  }

  private async deleteNodesKeepingChildren(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const restoreSelection = this.getSelectionRestoreCandidate(new Set(nodes.map((node) => node.line)));
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await deleteMultipleNodesKeepChildren(this.app, this.file, nodes);

    if (newDoc === beforeState) return;

    const command: MindmapCommand = {
      type: 'delete-node-keep-children',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]),
      metadata: { count: nodes.length, sourceLines: nodes.map(node => node.line) }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.selectedNodeLines.clear();
    this.restoreSelectionAfterDeletion(restoreSelection);
  }

  public async deleteNodesWithConfirmation(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const selectedLines = new Set(nodes.map((node) => node.line));
    const topLevelNodes = this.getTopLevelNodes(nodes);

    if (!this.hasUnselectedDescendants(topLevelNodes, selectedLines)) {
      await this.executeDeleteMultipleNodesCommand(topLevelNodes);
      return;
    }

    new DeleteNodeModal(this.app, (result) => {
      void (async () => {
        if (!this.file) return;

        if (result === "full") {
          await this.executeDeleteMultipleNodesCommand(topLevelNodes);
        } else if (result === "single") {
          await this.deleteNodesKeepingChildren(nodes);
        }
    
      })();
    }).open();
  }

  public async pasteClipboardAsChildren(targetNode: OutlineNode): Promise<void> {
    await pasteClipboardAsChildrenFn(this, targetNode);
  }

  public getNodeByLine(nodeLine: number): OutlineNode | null {
    return this.getFlatNodes().find((node) => node.line === nodeLine) ?? null;
  }

  public getSelectedNodes(): OutlineNode[] {
    return this.getFlatNodes()
      .filter((node) => this.selectedNodeLines.has(node.line))
      .sort((a, b) => a.line - b.line);
  }

  private outlineSession = new OutlineSession();
  public getOutlineNodes(source = this.data): OutlineNode[] { return this.outlineSession.parse(source ?? ''); }

  public normalizeNodeText(text: string, _notice: boolean = true): string {
    return text.replace(/\r\n/g, '\n');
  }

  private handleWrapperKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.node-editor, .cm-editor, input, textarea, select, [contenteditable="true"]')) return;

    if ((event.metaKey || event.ctrlKey) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (this.selectedNodeLines.size === 1) {
        event.preventDefault();
        const selectedNode = this.getNodeByLine(Array.from(this.selectedNodeLines)[0]);
        if (selectedNode) {
          void this.executeAddSiblingCommand(selectedNode, event.key === 'ArrowLeft' ? 'before' : 'after');
        }
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
      if (this.selectedNodeLines.size === 1) {
        event.preventDefault();
        const selectedNode = this.getNodeByLine(Array.from(this.selectedNodeLines)[0]);
        if (selectedNode) {
          void this.executeAddChildCommand(selectedNode, 'last');
        }
      }
      return;
    }

    if (event.key === 'Enter') {
      if (this.selectedNodeLines.size === 1) {
        event.preventDefault();
        const selectedNodeLine = Array.from(this.selectedNodeLines)[0];
        void this.enterEditModeForNodeByLine(selectedNodeLine);
      }
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.navigateSelection(event.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right');
      this.centerSelectedNodeInView();
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (this.selectedNodeLines.size > 0) {
        const flat = this.getFlatNodes();
        const nodesToDelete = flat.filter(n => this.selectedNodeLines.has(n.line));
        void this.deleteNodesWithConfirmation(nodesToDelete);
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
      if (this.selectedNodeLines.size > 0) {
        event.preventDefault();
        const flat = this.getFlatNodes();
        const nodesToCopy = flat.filter(n => this.selectedNodeLines.has(n.line));
        void this.copyNodesToClipboard(nodesToCopy);
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'x') {
      if (this.selectedNodeLines.size > 0) {
        event.preventDefault();
        const flat = this.getFlatNodes();
        const nodesToCut = flat.filter(n => this.selectedNodeLines.has(n.line));
        void this.cutNodesToClipboard(nodesToCut);
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'v') {
      if (this.selectedNodeLines.size === 1) {
        event.preventDefault();
        const targetNode = this.getNodeByLine(Array.from(this.selectedNodeLines)[0]);
        if (targetNode) void this.pasteClipboardAsChildren(targetNode);
      }
      return;
    }
  };

  public generalSettings: GeneralSettings = {
    keyboardNavigation: 'hierarchical',
    showCheckboxesOnHover: false,
    inheritParentListTypeForChildren: false,
  };

  private nodeOptions: NodeOptions = {
    nodeWidth: 300
  };

  /** Pen size and colour, persisted in the plugin's data.json across sessions. */
  public readonly penPreferences: PenPreferenceStore;

  constructor(leaf: WorkspaceLeaf, plugin: MindmapPlugin) {
    super(leaf);
    this.frontmatterStorage = new FrontmatterStorage(this.app);
    this.commandHistory = new CommandHistory(this.app);
    this.penPreferences = new PenPreferenceStore(plugin);
  }

  getViewType(): string {
    return VIEW_TYPE_MINDMAP;
  }

  getDisplayText(): string {
    return this.file ? `Mindmap: ${this.file.name}` : 'Mindmap';
  }

  getViewData(): string {
    return this.data;
  }

  public isLocalUpdate: boolean = false;

  setViewData(d: string): void {
    const next = d || '';
    const unchanged = next === this.data;
    this.data = next;
    if (this.isLocalUpdate && unchanged) {
      return;
    }
    void this.draw();
  }

  clear(): void {
    this.data = '';
    void this.draw();
  }

  /** Create first node in empty file */
  private async createFirstNode(): Promise<void> {
    if (!this.file) return;
    
    const before = this.data;
    const versioned = outlineVersion(before) === 2 ? before : before.startsWith('---\n')
      ? before.replace('---\n', `---\n${FORMAT_KEY}: 2\n`)
      : before.startsWith('---\r\n') ? before.replace('---\r\n', `---\r\n${FORMAT_KEY}: 2\r\n`)
      : `---\n${FORMAT_KEY}: 2\n---\n${before}`;
    const newContent = versioned + (versioned.endsWith('\n') ? '' : '\n') + '- ';
    await commitDocument(this.app, this.file, before, newContent);
    this.data = newContent;
    
    // Redraw to show the new node
    await this.draw();
  }

  public ensureMindmapWrapper(): void {
    if (this.wrapper && this.contentEl.contains(this.wrapper)) {
      return;
    }

    this.contentEl.empty();
    this.wrapper = this.contentEl.createDiv({ cls: 'mindmap-wrapper' });
    this.prepareWrapper();
  }

  private resetRenderedMindmap(): void {
    this.cancelScheduledRenderFrames();
    this.nodeRenderResources.clear();
    this.dismissNodeContextMenu();
    this.gestureCoordinator?.reset();
    const cy = this.cy;
    this.cy = undefined;
    cy?.destroy();
    this.toolbar?.closeMenus();
    this.toolbar = undefined;
    this.firstFitDone = false;
    this.isUpdatingOverlays = false;
    this.sizeMap = new Map();
    this.selectionBoxEl = null;
    this.ensureMindmapWrapper();
    this.wrapper.empty();
  }

  /** Show empty state UI */
  private showEmptyState(): void {
    this.resetRenderedMindmap();
    
    const container = this.wrapper.createDiv({ cls: 'mindmap-empty-state' });

    const title = container.createEl('h2', { text: 'Start your mindmap' });
    title.addClass('mindmap-empty-title');

    const description = container.createEl('p', { text: 'Click the button below to create your first node' });
    description.addClass('mindmap-empty-description');

    const button = container.createEl('button', { text: 'Create first node' });
    button.addClass('mindmap-empty-button');
    button.onclick = () => this.createFirstNode();
  }

  /** Show incompatible content warning */
  private showIncompatibleWarning(): void {
    this.resetRenderedMindmap();
    
    const container = this.wrapper.createDiv({ cls: 'mindmap-warning-state' });

    const icon = container.createDiv({ cls: 'mindmap-warning-icon' });
    icon.setText('⚠️');

    const title = container.createEl('h2', { text: 'Incompatible content' });
    title.addClass('mindmap-warning-title');

    const description = container.createDiv({ cls: 'mindmap-warning-description' });
    description.createEl('p', {
      text: "This file contains content that isn't compatible with the mindmap view.",
    });
    description.createEl('p', { text: 'The mindmap requires an outline structure using list items:' });
    description
      .createEl('ul', { cls: 'mindmap-warning-list' })
      .createEl('li', { text: 'Like this' });
    try { parseOutline(this.data); } catch (error) {
      description.createEl('p', { text: error instanceof Error ? error.message : 'Unsupported format.' });
    }
    description.createEl('p', { text: 'The original text has been retained. Review it in Markdown. Legacy files can use the preview migration to multiline outline command.' });

  }

  /** Reload file data with incremental update for external changes */
  async reloadDataIncremental(): Promise<void> {
    if (!this.file) return;
    
    const newData = await this.app.vault.read(this.file);
    if (newData !== this.data) {
      this.data = newData;
      await this.incrementalUpdate();
    }
  }

  /** Reload file data, wenn sie extern geändert wurde */
  async reloadData(): Promise<void> {
    if (!this.file) return;
    
    this.data = await this.app.vault.read(this.file);
    // Use full draw() for external changes to avoid conflicts
    await this.draw();
  }

  /** Apply document changes with incremental update */
  public applyDocIncremental(d: DocString): void {
    this.data = d;
    void this.incrementalUpdate();
  }

  // Enhanced applyDocIncremental with command tracking - now the primary method
  private captureCommandContext(): CommandContext {
    const nodes = this.getFlatNodes().map(node => ({ ...node }));
    return {
      nodes,
      filePath: this.file?.path,
      selectedIds: new Set(nodes.filter(node => this.selectedNodeLines.has(node.line)).map(node => node.id)),
      cutIds: new Set(nodes.filter(node => this.pendingCutNodeLines.has(node.line)).map(node => node.id)),
    };
  }

  public async applyDocIncrementalWithCommand(d: DocString, command?: MindmapCommand, context = this.captureCommandContext()): Promise<void> {
    if (context.filePath && context.filePath !== this.file?.path) return;
    this.isLocalUpdate = true;
    this.data = d;
    if (command && command.beforeState !== command.afterState) this.outlineSession.parse(d, commandNodeIdentities(command, context.nodes));
    const current = this.getFlatNodes();
    this.selectedNodeLines = new Set(current.filter(node => context.selectedIds.has(node.id)).map(node => node.line));
    this.pendingCutNodeLines = new Set(current.filter(node => context.cutIds.has(node.id)).map(node => node.line));

    // Record command in history
    if (command && command.beforeState !== command.afterState) {
      this.commandHistory.executeCommand(command);
    }
    
    // Always use incremental update - no special cases
    await this.incrementalUpdate();
    
    // Force toolbar button update after command execution
    this.forceToolbarUpdate();

    // Reset local update flag after giving file watcher time to catch up
    window.setTimeout(() => {
      this.isLocalUpdate = false;
    }, 1000);
  }

  // Make this the standard method for all operations
  public applyDocWithCommand(d: DocString, command?: MindmapCommand): void {
    void this.applyDocIncrementalWithCommand(d, command);
  }

  /** Incremental update that reuses existing measurements where possible */
  public async incrementalUpdate(): Promise<void> {
    if (updateTaskOverlays(this)) {
      this.renderLifecycle.invalidate();
      this.cy?.scratch('_mindmapRenderGeneration', this.renderLifecycle.currentGeneration());
      this.cy?.scratch('_mindmapRoots', this.getOutlineNodes());
      return;
    }
    // Document edits can shift line numbers, and nodes may contain rendered Markdown
    // whose dimensions are much larger than the source text. Reuse the full
    // measurement path so layout always uses current rendered node sizes.
    await this.draw();
  }

  /* ── Lifecycle ───────────────────────────── */
  async onOpen(): Promise<void> {
    this.isViewClosed = false;
    this.ensureViewListeners();

    const st = this.leaf.getViewState().state as MindmapViewState | undefined;
    if (!st?.file) {
      return;
    }

    const af = this.app.vault.getAbstractFileByPath(st.file);
    if (af instanceof TFile && af.extension === 'md') {
      this.file = af;
    } else {
      this.contentEl.setText('Error: Invalid Markdown file.');
      return;
    }

    this.contentEl.empty();

    this.wrapper = this.contentEl.createDiv({ cls: 'mindmap-wrapper' });
    this.prepareWrapper();

    // Styling for markdown-rendered content moved to `styles.css` for proper theming.

    if (this.file) {
      this.data = await this.app.vault.read(this.file);
      await this.draw();
    }

    this.scheduleMobileToolbarPlacementUpdate();
  }

  /**
   * Every subscription that has to live as long as the view, in one
   * idempotent place called from each entry point that can bring a file in.
   *
   * None of this may sit at the end of onOpen. Obsidian renders this view
   * through setViewData(), which does not depend on onOpen finishing - and
   * onOpen returns early when the leaf state carries no file, which is the
   * normal case when the view is created before its state is applied. The
   * interaction machinery survives that because prepareWrapper() runs from
   * the draw path, but these listeners had no second home and were simply
   * absent from a view that looked perfectly healthy.
   *
   * Re-registering is safe: addEventListener ignores a repeat of the same
   * type, callback and capture flag, and every callback here is a stable
   * instance property rather than a fresh closure.
   */
  private ensureViewListeners(): void {
    if (!this.themeChangeRef) {
      this.themeChangeRef = this.app.workspace.on('css-change', this.handleThemeChange);
      this.registerEvent(this.themeChangeRef);
    }
    if (!this.vaultModifyRef) {
      this.vaultModifyRef = this.app.vault.on('modify', this.handleEmbeddedDrawingModified);
    }
    if (!this.activeLeafChangeRef) {
      this.activeLeafChangeRef = this.app.workspace.on('active-leaf-change', this.handleActiveLeafChange);
    }

    window.addEventListener('resize', this.updateOverlays);
    window.addEventListener('resize', this.scheduleMobileToolbarPlacementUpdate);
    window.addEventListener('orientationchange', this.scheduleMobileToolbarPlacementUpdate);
    window.visualViewport?.addEventListener('resize', this.scheduleMobileToolbarPlacementUpdate);
    window.visualViewport?.addEventListener('scroll', this.scheduleMobileToolbarPlacementUpdate);

    this.orientationMediaQuery = window.matchMedia?.('(orientation: landscape)') ?? null;
    if (this.orientationMediaQuery) {
      this.orientationMediaQuery.addEventListener('change', this.scheduleMobileToolbarPlacementUpdate);
    }
    this.screenOrientation = window.screen.orientation ?? null;
    this.screenOrientation?.addEventListener?.('change', this.scheduleMobileToolbarPlacementUpdate);

    // contentEl rather than wrapper.ownerDocument: the wrapper is created by
    // the draw path and need not exist yet, while the document is the same one
    // either way - and in a pop-out window it must be that window's document.
    this.interactionDocument = this.contentEl.ownerDocument;
    this.interactionDocument.addEventListener('pointerdown', this.handleMenuDismissPointerDown, true);
  }

  private readonly handleThemeChange = (): void => {
    if (!this.isViewClosed && this.wrapper && this.cy) {
      refreshMindmapTheme(this.wrapper, this.cy);
    }
  };

  /**
   * Drawings are written by whoever edits them - Excalidraw in its own tab,
   * or this plugin's own editor - so nothing else tells this view that an
   * embedded image changed on disk.
   *
   * Only the nodes embedding that one file are re-measured, which is what
   * makes an immediate redraw affordable. The delay just collapses a burst of
   * writes (Excalidraw autosaves while drawing) into a single redraw.
   */
  private readonly handleEmbeddedDrawingModified = (file: TAbstractFile): void => {
    if (this.isViewClosed || !(file instanceof TFile)) return;
    if (!this.embedsFile(file) || !this.attachmentVersions.markCurrent(file)) return;

    this.invalidateMeasurementsFor(file);
    this.scheduleAttachmentRedraw();
  };

  /**
   * The vault event is not a reliable trigger on its own: an editor in another
   * tab decides when it writes, and Excalidraw in particular saves on blur and
   * on its own interval. Whenever this view is looked at again, the mtime the
   * nodes were rendered with is compared against what is on disk, so a write
   * that happened while this view was inactive is caught regardless of when
   * its event arrived.
   */
  private readonly handleActiveLeafChange = (leaf: WorkspaceLeaf | null): void => {
    if (this.isViewClosed || leaf !== this.leaf) return;
    this.cy?.resize();
    initializeViewport(this);
    this.refreshStaleAttachments();

    // Excalidraw saves the drawing you are leaving from inside its own handler
    // for this same event, and awaits that write. At this point the file on
    // disk can therefore still be the pre-edit one, and the mtime comparison
    // above would conclude that nothing changed. Look again once the write
    // has had a chance to land.
    if (this.activationRecheckTimeout !== null) {
      window.clearTimeout(this.activationRecheckTimeout);
    }
    this.activationRecheckTimeout = window.setTimeout(() => {
      this.activationRecheckTimeout = null;
      if (!this.isViewClosed) this.refreshStaleAttachments();
    }, ACTIVATION_RECHECK_DELAY_MS);
  };

  /**
   * The attachments this mindmap embeds, taken from the resolved-link index
   * and from resolving the outline's own embeds. Neither source alone is
   * enough - see embedsFile.
   */
  private collectEmbeddedAttachments(): TFile[] {
    const sourcePath = this.file?.path;
    if (!sourcePath) return [];

    const byPath = new Map<string, TFile>();
    for (const attachment of embeddedAttachments(this.app, sourcePath)) {
      byPath.set(attachment.path, attachment);
    }
    for (const node of this.getFlatNodes()) {
      for (const link of extractEmbedLinks(node.text)) {
        const target = this.app.metadataCache.getFirstLinkpathDest(link.split('#')[0], sourcePath);
        if (target) byPath.set(target.path, target);
      }
    }
    return Array.from(byPath.values());
  }

  private refreshStaleAttachments(): void {
    const sourcePath = this.file?.path;
    if (!sourcePath) return;

    let staleCount = 0;
    for (const attachment of this.collectEmbeddedAttachments()) {
      if (!this.attachmentVersions.isStale(attachment)) {
        this.attachmentVersions.adopt(attachment);
        continue;
      }
      this.attachmentVersions.markCurrent(attachment);
      this.invalidateMeasurementsFor(attachment);
      staleCount++;
    }

    if (staleCount === 0) return;
    this.scheduleAttachmentRedraw();
  }

  private scheduleAttachmentRedraw(): void {
    if (this.attachmentRefreshTimeout !== null) {
      window.clearTimeout(this.attachmentRefreshTimeout);
    }
    this.attachmentRefreshTimeout = window.setTimeout(() => {
      this.attachmentRefreshTimeout = null;
      if (this.isViewClosed) return;
        void this.draw();
    }, ATTACHMENT_REFRESH_DELAY_MS);
  }

  /**
   * Checks the resolved-link index first because this runs on every write in
   * the whole vault, then falls back to resolving the embeds in the outline.
   *
   * The fallback matters: the index and the resolver can disagree. An
   * Excalidraw drawing is linked as `X.excalidraw` while the file on disk is
   * `X.excalidraw.md`, and it is getFirstLinkpathDest - not the index - that
   * decided what actually got rendered into the node.
   */
  private embedsFile(file: TFile): boolean {
    const sourcePath = this.file?.path;
    if (!sourcePath) return false;

    const links = this.app.metadataCache.resolvedLinks?.[sourcePath];
    if (links && file.path in links) return true;

    return this.embeddedPaths().has(file.path);
  }

  /**
   * Memoised against the document it was derived from. This is consulted for
   * every write anywhere in the vault, and resolving the outline's embeds
   * means parsing the whole document - work that only changes when the
   * document does.
   */
  private embeddedPaths(): Set<string> {
    if (this.embeddedPathsCache?.data === this.data) return this.embeddedPathsCache.paths;

    const paths = new Set(this.collectEmbeddedAttachments().map((file) => file.path));
    this.embeddedPathsCache = { data: this.data, paths };
    return paths;
  }

  async onClose(): Promise<void> {
    this.isViewClosed = true;
    this.renderLifecycle.invalidate();
    this.nodeRenderResources.clear();
    this.isUpdatingOverlays = false;
    this.toolbar?.closeMenus();
    if (this.zoomSaveTimeout !== null) {
      window.clearTimeout(this.zoomSaveTimeout);
      this.zoomSaveTimeout = null;
    }
    for (const close of Array.from(this.transientClosers)) close();
    this.transientClosers.clear();
    this.activeNodeContextMenu?.hide();
    this.activeNodeContextMenu = null;
    this.viewEventController?.abort();
    this.viewEventController = null;
    this.isBoxSelectionInitialized = false;
    this.isViewportWheelInitialized = false;
    this.isBoxSelecting = false;
    this.isMiddleMousePanning = false;
    this.gestureCoordinator?.destroy();
    this.gestureCoordinator = null;
    if (this.attachmentRefreshTimeout !== null) {
      window.clearTimeout(this.attachmentRefreshTimeout);
      this.attachmentRefreshTimeout = null;
    }
    if (this.activationRecheckTimeout !== null) {
      window.clearTimeout(this.activationRecheckTimeout);
      this.activationRecheckTimeout = null;
    }
    if (this.vaultModifyRef) {
      this.app.vault.offref(this.vaultModifyRef);
      this.vaultModifyRef = null;
    }
    if (this.activeLeafChangeRef) {
      this.app.workspace.offref(this.activeLeafChangeRef);
      this.activeLeafChangeRef = null;
    }
    if (this.themeChangeRef) {
      this.app.workspace.offref(this.themeChangeRef);
      this.themeChangeRef = null;
    }
    this.attachmentVersions.clear();
    window.removeEventListener('resize', this.updateOverlays);
    window.removeEventListener('resize', this.scheduleMobileToolbarPlacementUpdate);
    window.removeEventListener('orientationchange', this.scheduleMobileToolbarPlacementUpdate);
    window.visualViewport?.removeEventListener('resize', this.scheduleMobileToolbarPlacementUpdate);
    window.visualViewport?.removeEventListener('scroll', this.scheduleMobileToolbarPlacementUpdate);
    if (this.orientationMediaQuery) {
      this.orientationMediaQuery.removeEventListener('change', this.scheduleMobileToolbarPlacementUpdate);
      this.orientationMediaQuery = null;
    }
    this.screenOrientation?.removeEventListener?.('change', this.scheduleMobileToolbarPlacementUpdate);
    this.screenOrientation = null;
    this.interactionDocument?.removeEventListener('pointerdown', this.handleMenuDismissPointerDown, true);
    this.interactionDocument = null;
    if (this.zoomingClassTimeout !== null) {
      window.clearTimeout(this.zoomingClassTimeout);
      this.zoomingClassTimeout = null;
    }
    this.mobileToolbarPlacementTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    this.mobileToolbarPlacementTimeouts = [];
    if (this.wrapper) resetToolbarPlacement(this.wrapper);
    const cy = this.cy;
    this.cy = undefined;
    cy?.destroy();
    
    // Clean up CSS when last mindmap view closes
    const mindmapViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
    if (mindmapViews.length <= 1) {
      const style = document.getElementById('mindmap-obsidian-css');
      if (style) style.remove();
    }
  }

  /* ── draw-Wrapper ────────────────────────── */
  private async draw(): Promise<void> {
    const data = this.data;
    await this.renderLifecycle.enqueueLatest(async (render) => {
      if (!render.isCurrent() || this.isViewClosed) return;

      if (isEmptyContent(data) && isOutlineCompatible(data)) {
        this.showEmptyState();
        return;
      }

      if (!isOutlineCompatible(data)) {
        this.showIncompatibleWarning();
        return;
      }

      await drawMindmap(this, {
        generation: render.generation,
        data,
        isCurrent: () => render.isCurrent() && !this.isViewClosed,
      });
    });
  }

  /* ── relayout() ─────────────────────────── */
  public relayout(): void {
    if (!this.cy) return;

    const L = this.layoutOptions;
    applyEdgeRouting(this.cy, L);
    const layoutObj = {
      name: 'dagre',
      rankDir: L.rankDir,
      align: L.align,
      nodeSep: L.nodeSep,
      edgeSep: L.edgeSep,
      rankSep: L.rankSep,
      marginx: L.marginx,
      marginy: L.marginy,
      acyclicer: L.acyclicer,
      ranker: L.ranker,
      fit: false,
      padding: 30,
      nodeDimensionsIncludeLabels: false,
      spacingFactor: L.spacingFactor,
      sort: sortByMarkdownOrder,
    } as unknown as import('cytoscape').LayoutOptions;

    // Don't reset firstFitDone - preserve current zoom level
    this.cy.layout(layoutObj).run();
  }

  /* ── Manual fit method for toolbar ─────── */
  public fitToView(): void {
    if (!this.cy) return;
    this.cy.fit(this.cy.elements(), 50);
    this.cy.center(this.cy.elements());
    this.rememberCurrentZoom(true);
  }

  private historyFilePath: string | null = null;
  async onLoadFile(file: TFile): Promise<void> {
    this.ensureViewListeners();
    if (this.historyFilePath !== file.path) {
      this.isLocalUpdate = false;
      this.commandHistory.clear();
      this.outlineSession = new OutlineSession();
      this.flatNodesCache = null;
      this.measurementCache.clear();
      this.selectedNodeLines.clear();
      this.pendingCutNodeLines.clear();
      this.pendingEditNodeLine = null;
      this.selectionHistory = [];
      this.generalSettings = { keyboardNavigation: 'hierarchical', showCheckboxesOnHover: false, inheritParentListTypeForChildren: false };
      this.nodeOptions = { nodeWidth: 300 };
      this.layoutOptions = createDefaultLayoutOptions();
      this.firstFitDone = false;
      this.historyFilePath = file.path;
    }
    if (this.frontmatterStorage && file) {
      const mindmapData = await this.frontmatterStorage.loadMindmapData(file);
      if (this.file?.path !== file.path) return;
      
      // Load general settings
      if (mindmapData.keyboardNavigation) {
        this.generalSettings.keyboardNavigation = mindmapData.keyboardNavigation;
      }

      if (mindmapData.nodeEditingMode === 'single-line' || mindmapData.nodeEditingMode === 'multiline') {
        this.generalSettings.nodeEditingMode = mindmapData.nodeEditingMode;
      }

      if (typeof mindmapData.showCheckboxesOnHover === 'boolean') {
        this.generalSettings.showCheckboxesOnHover = mindmapData.showCheckboxesOnHover;
      }

      if (typeof mindmapData.inheritParentListTypeForChildren === 'boolean') {
        this.generalSettings.inheritParentListTypeForChildren = mindmapData.inheritParentListTypeForChildren;
      }

      // Load node width from frontmatter (flat structure)
      if (typeof mindmapData.nodeWidth === 'number') {
        this.nodeOptions.nodeWidth = mindmapData.nodeWidth;
        this.toolbar?.setNodeOptions(this.nodeOptions);
      }
      
      // Load layout options from frontmatter (flat structure)
      const layoutUpdates: Partial<LayoutOptions> = {};
      layoutUpdates.edgeStyle = normalizeEdgeStyle(mindmapData.edgeStyle);
      if (mindmapData.rankDir) layoutUpdates.rankDir = mindmapData.rankDir;
      if (mindmapData.align) layoutUpdates.align = mindmapData.align;
      if (typeof mindmapData.nodeSep === 'number') layoutUpdates.nodeSep = mindmapData.nodeSep;
      if (typeof mindmapData.edgeSep === 'number') layoutUpdates.edgeSep = mindmapData.edgeSep;
      if (typeof mindmapData.rankSep === 'number') layoutUpdates.rankSep = mindmapData.rankSep;
      if (typeof mindmapData.marginx === 'number') layoutUpdates.marginx = mindmapData.marginx;
      if (typeof mindmapData.marginy === 'number') layoutUpdates.marginy = mindmapData.marginy;
      if (mindmapData.acyclicer) layoutUpdates.acyclicer = mindmapData.acyclicer;
      if (mindmapData.ranker) layoutUpdates.ranker = mindmapData.ranker;
      if (typeof mindmapData.spacingFactor === 'number') layoutUpdates.spacingFactor = mindmapData.spacingFactor;
      if (typeof mindmapData.zoomFactor === 'number') layoutUpdates.zoomFactor = mindmapData.zoomFactor;
      if (mindmapData.headingTreeLayout) layoutUpdates.headingTreeLayout = mindmapData.headingTreeLayout;
      
      if (Object.keys(layoutUpdates).length > 0) {
        this.layoutOptions = { ...this.layoutOptions, ...layoutUpdates };
      }
    }
    if (this.file?.path === file.path) await super.onLoadFile(file);
  }

  public async executeUndo(): Promise<void> {
    if (!this.file || !this.commandHistory.canUndo()) return;
    
    const context = this.captureCommandContext();
    const newData = await this.commandHistory.undo(this.file);
    if (newData !== null) {
      await this.applyDocIncrementalWithCommand(newData, undefined, context);
      
      // Force toolbar update
      this.forceToolbarUpdate();
    }
  }

  public async executeRedo(): Promise<void> {
    if (!this.file || !this.commandHistory.canRedo()) return;
    
    const context = this.captureCommandContext();
    const newData = await this.commandHistory.redo(this.file);
    if (newData !== null) {
      await this.applyDocIncrementalWithCommand(newData, undefined, context);
      
      // Force toolbar update
      this.forceToolbarUpdate();
    }
  }

  // New command execution methods that handle everything properly
  public async executeAddChildCommand(
    parentNode: OutlineNode,
    childInsertPosition: ChildInsertPosition = 'last'
  ): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newChildLine = childInsertPosition === 'first' ? (parentNode.ownEnd ?? parentNode.line + 1) : parentNode.endLine + 1;
    const newDoc = await addChild(this.app, this.file, parentNode, childInsertPosition, {
      inheritParentListType: this.generalSettings.inheritParentListTypeForChildren ?? false,
    });
    
    const command: MindmapCommand = {
      type: 'add-child',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { childInsertPosition }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.scheduleEditModeForNodeByLine(newChildLine);
  }

  public async executeAddSiblingCommand(
    node: OutlineNode,
    siblingInsertPosition: SiblingInsertPosition = 'after'
  ): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newSiblingLine = siblingInsertPosition === 'before' ? node.line : node.endLine + 1;
    const newDoc = await addSibling(this.app, this.file, node, siblingInsertPosition);
    
    const command: MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: { siblingInsertPosition }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.scheduleEditModeForNodeByLine(newSiblingLine);
  }

  private getHeadingInsertionNodeForNode(node: OutlineNode): OutlineNode {
    const roots = this.getOutlineNodes();
    const root = roots.find((candidate) => node.line >= candidate.line && node.line <= candidate.endLine);
    return root ?? node;
  }

  public async executeAddHeadingCommand(node: OutlineNode): Promise<void> {
    if (!this.file || !this.supportsStructuralHeadings) return;

    const rootNode = this.getHeadingInsertionNodeForNode(node);
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await addHeadingBeforeNode(this.app, this.file, rootNode, '# Heading');

    const command: MindmapCommand = {
      type: 'add-heading',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(rootNode),
      metadata: {
        headingLine: rootNode.line,
        headingText: '# Heading',
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.scheduleEditModeForHeadingByLine(rootNode.line);
  }

  public async executeEditHeadingCommand(section: HeadingSection, newText: string, expectedDoc = this.data): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const isDeletingHeading = newText.trim() === '';
    const newDoc = isDeletingHeading
      ? await deleteHeading(this.app, this.file, section.line, expectedDoc)
      : await writeHeading(this.app, this.file, section.line, newText, expectedDoc);

    const command: MindmapCommand = {
      type: isDeletingHeading ? 'delete-heading' : 'edit-heading',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: {
        line: section.line,
        text: section.rawText.substring(0, 50),
        indent: '',
        marker: '#',
      },
      metadata: {
        oldText: section.rawText.substring(0, 100),
        newText: newText.substring(0, 100),
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async toggleNodeCheckbox(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    let desiredText = node.text;
    if (node.checkbox === 'checked') {
      desiredText = `[ ] ${node.text}`;
    } else if (node.checkbox === 'unchecked') {
      desiredText = `[x] ${node.text}`;
    } else {
      desiredText = `[x] ${node.text}`;
    }

    desiredText = this.normalizeNodeText(desiredText, false);
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await setNodesCheckbox(this.app, this.file, [node], node.checkbox === 'checked' ? 'unchecked' : 'checked');

    const command: MindmapCommand = {
      type: 'toggle-checkbox',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: {
        text: desiredText,
        checkboxBefore: node.checkbox,
        checkboxAfter: node.checkbox === 'checked' ? 'unchecked' : 'checked',
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async convertNodeToTask(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    const desiredText = this.normalizeNodeText(`[ ] ${node.text}`, false);
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await setNodesCheckbox(this.app, this.file, [node], 'unchecked');

    const command: MindmapCommand = {
      type: 'edit-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: {
        oldText: node.text.substring(0, 100),
        newText: desiredText.substring(0, 100),
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async convertNodeToCheckedTask(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    const desiredText = this.normalizeNodeText(`[x] ${node.text}`, false);
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await setNodesCheckbox(this.app, this.file, [node], 'checked');

    const command: MindmapCommand = {
      type: 'edit-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: {
        oldText: node.text.substring(0, 100),
        newText: desiredText.substring(0, 100),
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async convertNodesToTask(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await setNodesCheckbox(this.app, this.file, nodes, 'unchecked');

    const command: MindmapCommand = {
      type: 'edit-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]),
      metadata: {
        oldText: nodes.map((node) => node.text.substring(0, 50)).join(' | '),
        newText: nodes.map((node) => `[ ] ${node.text}`.substring(0, 50)).join(' | '),
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async convertNodesToCheckedTask(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await setNodesCheckbox(this.app, this.file, nodes, 'checked');

    const command: MindmapCommand = {
      type: 'edit-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]),
      metadata: {
        oldText: nodes.map((node) => node.text.substring(0, 50)).join(' | '),
        newText: nodes.map((node) => `[x] ${node.text}`.substring(0, 50)).join(' | '),
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async convertNodesToBulletPoint(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await setNodesCheckbox(this.app, this.file, nodes, 'none');

    const command: MindmapCommand = {
      type: 'edit-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]),
      metadata: {
        oldText: nodes.map((node) => {
          const prefix = node.checkbox === 'checked' ? '[x] ' : node.checkbox === 'unchecked' ? '[ ] ' : '';
          return `${prefix}${node.text}`.substring(0, 50);
        }).join(' | '),
        newText: nodes.map((node) => node.text.substring(0, 50)).join(' | '),
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executeEditNodeCommand(node: OutlineNode, newText: string): Promise<void> {
    if (!this.file) return;
    
    newText = this.normalizeNodeText(newText);
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await writeNode(this.app, this.file, node, newText);
    
    const command: MindmapCommand = {
      type: 'edit-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: { 
        oldText: node.text.substring(0, 100),
        newText: newText.substring(0, 100)
      }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executeDeleteNodeCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    const restoreSelection = this.getSelectionRestoreCandidate(new Set([node.line]));
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await deleteNode(this.app, this.file, node);

    const command: MindmapCommand = {
      type: 'delete-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.selectedNodeLines.clear();
    this.restoreSelectionAfterDeletion(restoreSelection);
  }

  public async executeDeleteMultipleNodesCommand(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const restoreSelection = this.getSelectionRestoreCandidate(new Set(nodes.map((node) => node.line)));
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await deleteMultipleNodes(this.app, this.file, nodes);

    const command: MindmapCommand = {
      type: 'delete-node', // reusing the type for simplicity, or could add delete-multiple-nodes
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]),
      metadata: { sourceLines: nodes.map(node => node.line) }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.selectedNodeLines.clear();
    this.restoreSelectionAfterDeletion(restoreSelection);
  }
  public async executeDeleteNodeKeepChildrenCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;
    
    const restoreSelection = this.getSelectionRestoreCandidate(new Set([node.line]));
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await deleteNodeKeepChildren(this.app, this.file, node);
    
    const command: MindmapCommand = {
      type: 'delete-node-keep-children',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.selectedNodeLines.clear();
    this.restoreSelectionAfterDeletion(restoreSelection);
  }

  public async executeMoveSubtreeCommand(
    sourceNode: OutlineNode,
    targetNode: OutlineNode,
    insertAsChild: boolean,
    childInsertPosition: ChildInsertPosition = 'first',
    siblingInsertPosition: SiblingInsertPosition = 'after'
  ): Promise<void> {
    if (!this.file) return;

    if (isMoveTargetInsideSourceSubtree(sourceNode, targetNode)) {
      new Notice('Cannot move a node into its own children.');
      return;
    }
    
    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await moveSubtree(
      this.app,
      this.file,
      sourceNode,
      targetNode,
      insertAsChild,
      childInsertPosition,
      siblingInsertPosition
    );
    
    if (newDoc === beforeState) {
      return; // No change
    }
    
    const command: MindmapCommand = {
      type: 'move-subtree',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(sourceNode),
      targetInfo: CommandHistory.createNodeInfo(targetNode),
      metadata: { insertAsChild, childInsertPosition, siblingInsertPosition }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executeMoveSubtreeToEmptyHeadingCommand(
    sourceNode: OutlineNode,
    headingLine: number
  ): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await moveSubtreeToEmptyHeading(this.app, this.file, sourceNode, headingLine, this.data);

    if (newDoc === beforeState) return;

    const command: MindmapCommand = {
      type: 'move-subtree',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(sourceNode),
      metadata: {
        targetHeadingLine: headingLine,
        dropIntent: 'empty-heading-child',
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executeCreateNodeInEmptyHeadingCommand(headingLine: number): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await addEmptyNodeToHeading(this.app, this.file, headingLine, this.data);

    if (newDoc === beforeState) return;

    const command: MindmapCommand = {
      type: 'add-child-text',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: {
        line: headingLine,
        text: 'Heading',
        indent: '',
        marker: '#',
      },
      metadata: {
        targetHeadingLine: headingLine,
        addedText: '',
      }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.scheduleEditModeForNodeByLine(headingLine + 1);
  }

  public async executeAddChildTextCommand(
    parentNode: OutlineNode,
    text: string,
    childInsertPosition: ChildInsertPosition = 'last'
  ): Promise<void> {
    if (!this.file) return;
    
    text = this.normalizeNodeText(text);
    if (!text) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await addChildText(this.app, this.file, parentNode, text, childInsertPosition, {
      inheritParentListType: this.generalSettings.inheritParentListTypeForChildren ?? false,
    });
    
    const command: MindmapCommand = {
      type: 'add-child-text',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { addedText: text.substring(0, 100), childInsertPosition }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executeAddSiblingTextCommand(
    targetNode: OutlineNode,
    text: string,
    siblingInsertPosition: SiblingInsertPosition = 'after'
  ): Promise<void> {
    if (!this.file) return;

    text = this.normalizeNodeText(text);
    if (!text) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await addSiblingText(this.app, this.file, targetNode, text, siblingInsertPosition);

    if (newDoc === beforeState) return;

    const command: MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(targetNode),
      metadata: { addedText: text.substring(0, 100), dropIntent: 'sibling', siblingInsertPosition }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executePasteNodesCommand(parentNode: OutlineNode, text: string, sourceFormat?: 1 | 2): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await addMarkdownAsChildren(this.app, this.file, parentNode, text, sourceFormat);

    if (newDoc === beforeState) return;

    const command: MindmapCommand = {
      type: 'add-child-text',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { pastedText: text.substring(0, 100) }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public async executeCutPasteNodesCommand(sourceNodes: OutlineNode[], parentNode: OutlineNode, text: string): Promise<void> {
    if (!this.file || sourceNodes.length === 0) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await cutPasteMarkdownAsChildren(this.app, this.file, sourceNodes, parentNode, text);

    if (newDoc === beforeState) {
      new Notice('Cannot paste cut nodes into themselves.');
      return;
    }

    const command: MindmapCommand = {
      type: 'move-subtree',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(sourceNodes[0]),
      targetInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { count: sourceNodes.length, cutPaste: true, sourceLines: sourceNodes.map(node => node.line) }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
    this.pendingCutNodeLines.clear();
    this.selectedNodeLines.clear();
    this.updateSelectionStyling();
  }

  public async executeDuplicateNodeCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const context = this.captureCommandContext();
    const newDoc = await duplicateSubtree(this.app, this.file, node);

    if (newDoc === beforeState) return;

    const command: MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: { duplicated: true }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command, context);
  }

  public getNodeOptions(): NodeOptions {
    return { ...this.nodeOptions };
  }

  public async updateRenderingOptions(newOptions: NodeOptions): Promise<void> {
    this.nodeOptions = { ...newOptions };
    
    // Save to frontmatter
    if (this.file) {
      try {
        await this.frontmatterStorage.updateNodeOptions(this.file, newOptions);
      } catch (error) {
        console.error('Failed to save node options to frontmatter:', error);
      }
    }
    
    // Keep the currently displayed dimensions intact until the replacement
    // measurement pass commits its complete map atomically.
    this.measurementCache.clear();
    // Trigger full redraw
    void this.draw();
  }

  /**
   * Redraws after an attachment changed on disk.
   *
   * Naming the changed file matters for how fast this feels: every node whose
   * measurement is dropped has to be rendered and measured again, so clearing
   * the whole cache makes a single edited drawing cost a full re-measurement
   * of the map. Without a file the caller cannot say what changed and the
   * conservative full clear stands.
   */
  public refreshRenderedAttachments(changed?: TFile): Promise<void> {
    // A caller that redraws explicitly has already seen the write, so the
    // debounced redraw the vault event queued for the same edit is redundant.
    if (this.attachmentRefreshTimeout !== null) {
      window.clearTimeout(this.attachmentRefreshTimeout);
      this.attachmentRefreshTimeout = null;
    }
    // The old graph remains internally consistent while the fresh attachment
    // measurements are prepared in a render-local map.
    if (changed) {
      this.invalidateMeasurementsFor(changed);
    } else {
      this.measurementCache.clear();
    }
    return this.draw();
  }

  private invalidateMeasurementsFor(changed: TFile): void {
    const sourcePath = this.file?.path;
    if (!sourcePath) {
      this.measurementCache.clear();
      return;
    }

    const affectedTexts = new Set(
      this.getFlatNodes()
        .filter((node) => this.nodeEmbedsFile(node.text, changed, sourcePath))
        .map((node) => node.text)
    );
    if (affectedTexts.size === 0) return;

    for (const key of Array.from(this.measurementCache.keys())) {
      // Keys are `${targetWidth}\u0000${nodeText}`, and node text cannot
      // contain a NUL, so the first separator always ends the width.
      if (affectedTexts.has(key.slice(key.indexOf('\u0000') + 1))) {
        this.measurementCache.delete(key);
      }
    }
  }

  private nodeEmbedsFile(text: string, changed: TFile, sourcePath: string): boolean {
    return extractEmbedLinks(text).some((link) => {
      const target = this.app.metadataCache.getFirstLinkpathDest(link.split('#')[0], sourcePath);
      return target?.path === changed.path;
    });
  }

  public registerTransientCloser(close: () => void): () => void {
    this.transientClosers.add(close);
    return () => this.transientClosers.delete(close);
  }

  public async updateLayoutOptions(newOptions: Partial<LayoutOptions>): Promise<void> {
    // Open layout menus retain this object for their sliders and dropdowns.
    Object.assign(this.layoutOptions, newOptions);
    
    // Save to frontmatter
    if (this.file) {
      try {
        await this.frontmatterStorage.updateLayoutOptions(this.file, newOptions);
      } catch (error) {
        console.error('Failed to save layout options to frontmatter:', error);
      }
    }
    
    this.relayout();
  }

  public async resetLayoutOptions(): Promise<void> {
    const zoomFactor = this.layoutOptions.zoomFactor;
    this.layoutOptions = {
      ...createDefaultLayoutOptions(),
      zoomFactor,
    };

    if (this.file) {
      try {
        await this.frontmatterStorage.resetLayoutOptions(this.file);
      } catch (error) {
        console.error('Failed to reset layout options in frontmatter:', error);
      }
    }

    this.relayout();
  }

  public setZoomFactor(
    zoomFactor: number,
    save: boolean = true,
    renderedPosition?: { x: number; y: number }
  ): void {
    if (!this.cy) return;
    this.markViewportZooming();

    const nextZoom = Math.max(this.cy.minZoom(), Math.min(this.cy.maxZoom(), zoomFactor));
    const displayedZoom = this.isTouchDevice
      ? Number((Math.round(nextZoom * 100) / 100).toFixed(2))
      : Number(nextZoom.toFixed(3));

    if (renderedPosition) {
      this.cy.zoom({ level: nextZoom, renderedPosition });
    } else {
      const containerRect = this.cy.container()?.getBoundingClientRect();
      this.cy.zoom({
        level: nextZoom,
        renderedPosition: {
          x: containerRect ? containerRect.width / 2 : 0,
          y: containerRect ? containerRect.height / 2 : 0,
        },
      });
    }

    // Cytoscape keeps the exact gesture target. Only the visible and persisted
    // value is rounded, so repeated tiny Pinch deltas remain cumulative.
    this.layoutOptions.zoomFactor = displayedZoom;
    this.toolbar?.setZoomFactor(displayedZoom);

    if (save) {
      this.queueZoomFactorSave(displayedZoom);
    }
  }

  private markViewportZooming(): void {
    this.wrapper?.classList.add('is-viewport-zooming');

    if (this.zoomingClassTimeout !== null) {
      window.clearTimeout(this.zoomingClassTimeout);
    }

    this.zoomingClassTimeout = window.setTimeout(() => {
      this.wrapper?.classList.remove('is-viewport-zooming');
      // Refresh only positions and CSS variables. This prompts a final crisp
      // paint without rebuilding Markdown renderers or node overlays.
      this.updateOverlayGeometry();
      this.zoomingClassTimeout = null;
    }, 180);
  }

  public rememberCurrentZoom(save: boolean = false): void {
    if (!this.cy) return;

    const zoomFactor = Number(this.cy.zoom().toFixed(3));
    this.layoutOptions.zoomFactor = zoomFactor;
    this.toolbar?.setZoomFactor(zoomFactor);

    if (save) {
      this.queueZoomFactorSave(zoomFactor);
    }
  }

  private queueZoomFactorSave(zoomFactor: number): void {
    if (this.zoomSaveTimeout !== null) {
      window.clearTimeout(this.zoomSaveTimeout);
    }

    const file = this.file;
    if (!file) return;
    this.zoomSaveTimeout = window.setTimeout(async () => {
      this.zoomSaveTimeout = null;
      if (this.isViewClosed || !this.frontmatterStorage) return;

      try {
        await this.frontmatterStorage.updateLayoutOptions(file, { zoomFactor });
        if (this.file?.path !== file.path) return;
        this.commandHistory.retainSavedZoom(zoomFactor);
        this.outlineSession.retainSavedZoom(zoomFactor);
        await this.reloadDataIncremental();
      } catch (error) {
        console.error('Failed to save zoom factor to frontmatter:', error);
      }
    }, 350);
  }

  public setNodeOptions(options: NodeOptions) {
    this.nodeOptions = { ...options };
  }

  public forceToolbarUpdate(): void {
    if (this.toolbar) {
      // Use requestAnimationFrame for immediate update
      window.requestAnimationFrame(() => {
        if (this.toolbar) {
          this.toolbar.updateUndoRedoButtons();
        }
      });
    }
  }

  public selectNode(nodeLine: number, append: boolean = false): void {
    if (!append) {
      this.selectedNodeLines.clear();
    }
    this.selectedNodeLines.add(nodeLine);
    this.rememberSelectedNode(nodeLine);
    this.updateSelectionStyling();

    this.wrapper?.focus();
  }

  private rememberSelectedNode(nodeLine: number): void {
    const node = this.getNodeByLine(nodeLine);
    if (!node) return;

    const last = this.selectionHistory[this.selectionHistory.length - 1];
    if (last?.line === node.line && last.text === node.text) return;

    this.selectionHistory.push({ line: node.line, text: node.text });
    if (this.selectionHistory.length > 30) {
      this.selectionHistory.shift();
    }
  }

  private getSelectionRestoreCandidate(excludedLines: Set<number>): SelectionSnapshot | null {
    for (let i = this.selectionHistory.length - 1; i >= 0; i--) {
      const candidate = this.selectionHistory[i];
      if (!excludedLines.has(candidate.line)) {
        return candidate;
      }
    }

    return null;
  }

  private restoreSelectionAfterDeletion(candidate: SelectionSnapshot | null): void {
    if (!candidate) return;

    window.requestAnimationFrame(() => {
      const nodes = this.getFlatNodes();
      const exact = nodes.find((node) => node.line === candidate.line && node.text === candidate.text);
      const sameText = nodes.find((node) => node.text === candidate.text);
      const previousByLine = [...nodes].reverse().find((node) => node.line <= candidate.line);
      const fallback = nodes[0];
      const nodeToSelect = exact ?? sameText ?? previousByLine ?? fallback;

      if (nodeToSelect) {
        this.selectNode(nodeToSelect.line);
      }
    });
  }

  public deselectNode(nodeLine: number): void {
    this.selectedNodeLines.delete(nodeLine);
    this.updateSelectionStyling();
  }

  public clearSelection(): void {
    if (this.selectedNodeLines.size === 0) return;
    this.selectedNodeLines.clear();
    this.updateSelectionStyling();
  }
  public updateSelectionStyling(): void {
    if (!this.wrapper) return;

    this.wrapper.querySelectorAll('[data-overlay]').forEach((overlay) => {
      const line = Number((overlay as HTMLElement).dataset.nodeLine);
      overlay.classList.toggle('selected', this.selectedNodeLines.has(line));
      overlay.classList.toggle('cut-pending', this.pendingCutNodeLines.has(line));
    });
  }

  private flatNodesCache: { roots: OutlineNode[]; flat: OutlineNode[] } | null = null;
  public getFlatNodes(): OutlineNode[] {
    const roots = this.getOutlineNodes();
    if (this.flatNodesCache?.roots === roots) return this.flatNodesCache.flat;
    const flat: OutlineNode[] = [];
    (function walk(arr: OutlineNode[]) {
      arr.forEach((node) => {
        flat.push(node);
        walk(node.children);
      });
    })(roots);
    this.flatNodesCache = { roots, flat };
    return flat;
  }

  private navigateSelection(direction: NavigationDirection): void {
    navigateSelectionFn(this, direction);
  }

  private centerSelectedNodeInView(): void {
    if (!this.cy || this.selectedNodeLines.size === 0) return;

    const selectedArray = Array.from(this.selectedNodeLines);
    const nodeLine = selectedArray[selectedArray.length - 1];
    const cyNode = this.cy.getElementById(`n${nodeLine}`);
    if (!cyNode || cyNode.empty()) return;

    window.requestAnimationFrame(() => {
      this.cy?.animate({
        center: { eles: cyNode },
        duration: 140,
      });
    });
  }

  public async enterEditModeForNodeByLine(nodeLine: number, isNewNode: boolean = false): Promise<void> {
    this.dismissNodeContextMenu();
    for (let i = 0; i < 60; i++) {
      const overlay = this.wrapper?.querySelector<HTMLElement>(`[data-overlay][data-node-line="${nodeLine}"]`);
      if (overlay && !this.isUpdatingOverlays) {
        const node = this.getFlatNodes().find(candidate => candidate.line === nodeLine);
        if (!node) return;

        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (!overlay.isConnected || this.isUpdatingOverlays) continue;

        this.clearSelection();
        if (this.pendingEditNodeLine === nodeLine) {
          this.pendingEditNodeLine = null;
        }
        startNodeEditing(overlay, node, this, { isNewNode });
        return;
      }

      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    console.warn(`Overlay not found for line ${nodeLine} to start editing.`);
  }

  private scheduleEditModeForNodeByLine(nodeLine: number): void {
    let started = false;
    const startAfterOverlayUpdate = () => {
      if (started) return;
      started = true;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            void this.enterEditModeForNodeByLine(nodeLine, true);
          });
        });
      });
    };

    this.cy?.one('layoutstop', startAfterOverlayUpdate);
    window.setTimeout(startAfterOverlayUpdate, 350);
  }

  public async enterEditModeForHeadingByLine(
    headingLine: number,
    selectHeadingTextOnly: boolean = false
  ): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const frame = this.wrapper?.querySelector<HTMLElement>(`[data-heading-frame][data-heading-line="${headingLine}"]`);
      if (frame && !this.isUpdatingOverlays) {
        const section = parseHeadingSections(this.data).find(candidate => candidate.line === headingLine);
        if (!section) return;

        startHeadingEditing(frame, section, this, { selectHeadingTextOnly });
        return;
      }

      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    console.warn(`Heading frame not found for line ${headingLine} to start editing.`);
  }

  private scheduleEditModeForHeadingByLine(headingLine: number): void {
    let started = false;
    const startAfterOverlayUpdate = () => {
      if (started) return;
      started = true;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            void this.enterEditModeForHeadingByLine(headingLine, true);
          });
        });
      });
    };

    this.cy?.one('layoutstop', startAfterOverlayUpdate);
    window.setTimeout(startAfterOverlayUpdate, 350);
  }
}
