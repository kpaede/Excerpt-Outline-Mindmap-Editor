// src/mindmapView.ts

import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  Menu,
  Notice,
} from 'obsidian';
import { Core, type NodeSingular } from 'cytoscape';

import './dnd-css';

import { parseOutline, OutlineNode, isOutlineCompatible, isEmptyContent } from './util';
import { VIEW_TYPE_MINDMAP } from './constants';
import MindmapPlugin from './main';
import {
  addChild,
  addSibling,
  writeNode,
  deleteNode,
  deleteMultipleNodes,
  deleteMultipleNodesKeepChildren,
  moveSubtree,
  addChildText,
  addMarkdownAsChildren,
  cutPasteMarkdownAsChildren,
  duplicateSubtree,
  deleteNodeKeepChildren,
  DocString,
} from './mindmap-file';
import { VerticalToolbar } from './vertical-toolbar';
import { draw as drawMindmap } from './draw';
import { updateOverlays as updateOverlaysFn, startNodeEditing } from './updateOverlays';
import { NodeOptions } from './node-options-menu';
import { DeleteNodeModal } from './delete-node-modal';
import { FrontmatterStorage } from './frontmatter-storage';
import { CommandHistory } from './command-history';
import { GeneralSettings } from './general-settings-menu';

export interface LayoutOptions {
  rankDir?: 'TB' | 'BT' | 'LR' | 'RL';
  align?: 'UL' | 'UR' | 'DL' | 'DR';
  nodeSep?: number;
  edgeSep?: number;
  rankSep?: number;
  marginx?: number;
  marginy?: number;
  acyclicer?: 'greedy';
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
  spacingFactor?: number;
  zoomFactor?: number;
}

export interface MindmapViewState {
  file?: string;
}

export function createDefaultLayoutOptions() {
  return {
    rankDir: 'TB' as 'TB' | 'BT' | 'LR' | 'RL',
    align: undefined as 'UL' | 'UR' | 'DL' | 'DR' | undefined,
    nodeSep: 50,
    edgeSep: 10,
    rankSep: 50,
    marginx: 0,
    marginy: 0,
    acyclicer: undefined as 'greedy' | undefined,
    ranker: 'network-simplex' as 'network-simplex' | 'tight-tree' | 'longest-path',
    nodeWidth: 100,
    nodeHeight: 40,
    edgeMinLen: 1,
    edgeWeight: 1,
    edgeWidth: 0,
    edgeHeight: 0,
    edgeLabelPos: 'r' as 'l' | 'c' | 'r',
    edgeLabelOffset: 10,
    spacingFactor: 1.0,
    zoomFactor: undefined as number | undefined,
  };
}

export class MindmapView extends TextFileView {
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

  // Box selection properties
  private selectionBoxEl: HTMLDivElement | null = null;
  private isBoxSelecting: boolean = false;
  private isBoxSelectionInitialized: boolean = false;
  private isViewportWheelInitialized: boolean = false;
  private hasDraggedSelectionBox: boolean = false;
  private suppressNextEmptyClick: boolean = false;
  private mindmapClipboardText: string | null = null;
  private pendingCutNodeLines: Set<number> = new Set();
  private zoomSaveTimeout: number | null = null;
  private boxStartX: number = 0;
  private boxStartY: number = 0;

  /**
   * Map von OutlineNode.line → gemessene Breite/Höhe (in px).
   * Wird von draw() gefüllt und später in updateOverlays() verwendet.
   */
  public sizeMap: Map<number, { w: number; h: number }> = new Map();
  public measurementCache: Map<string, { w: number; h: number; scaleFactor?: number }> = new Map();

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

  public prepareWrapper(): void {
    if (!this.wrapper) return;
    this.wrapper.tabIndex = 0;
    this.wrapper.onkeydown = this.handleWrapperKeydown;
    this.initBoxSelection();
    this.initViewportWheelControls();
  }

  private initBoxSelection(): void {
    if (this.isBoxSelectionInitialized) return;
    this.isBoxSelectionInitialized = true;

    this.wrapper.addEventListener('click', (e) => {
      if (this.suppressNextEmptyClick) {
        this.suppressNextEmptyClick = false;
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '.mindmap-overlay, .vertical-toolbar, button, a, input, select, textarea, [contenteditable="true"]'
        )
      ) {
        return;
      }

      this.clearSelection();
    });

    this.wrapper.addEventListener('contextmenu', (e) => {
      this.showNodeContextMenu(e);
    });

    this.wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '.mindmap-overlay, .vertical-toolbar, button, a, input, select, textarea, [contenteditable="true"]'
        )
      ) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();

      this.isBoxSelecting = true;
      this.hasDraggedSelectionBox = false;
      const rect = this.wrapper.getBoundingClientRect();
      this.boxStartX = e.clientX - rect.left;
      this.boxStartY = e.clientY - rect.top;

      if (!this.selectionBoxEl) {
        this.selectionBoxEl = document.createElement('div');
        this.selectionBoxEl.className = 'mindmap-selection-box';
        this.wrapper.appendChild(this.selectionBoxEl);
      }

      this.selectionBoxEl.style.display = 'block';
      this.selectionBoxEl.style.left = `${this.boxStartX}px`;
      this.selectionBoxEl.style.top = `${this.boxStartY}px`;
      this.selectionBoxEl.style.width = '0px';
      this.selectionBoxEl.style.height = '0px';
      
      // Make overlays unclickable during drag so they don't interfere
      this.wrapper.classList.add('is-box-selecting');
    }, { capture: true });

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

      this.selectionBoxEl.style.left = `${left}px`;
      this.selectionBoxEl.style.top = `${top}px`;
      this.selectionBoxEl.style.width = `${width}px`;
      this.selectionBoxEl.style.height = `${height}px`;
    });

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

        this.selectionBoxEl.style.display = 'none';
      }
    });
  }

  private initViewportWheelControls(): void {
    if (this.isViewportWheelInitialized) return;
    this.isViewportWheelInitialized = true;

    this.wrapper.addEventListener('wheel', (event) => {
      if (!this.cy) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          '.vertical-toolbar, input, textarea, select, pre, code, iframe, video, audio, [contenteditable="true"]'
        )
      ) {
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
    }, { capture: true, passive: false });
  }

  private showNodeContextMenu(event: MouseEvent): void {
    event.preventDefault();

    const target = event.target as HTMLElement | null;
    const overlay = target?.closest('.mindmap-overlay') as HTMLElement | null;
    const contextLine = overlay ? Number(overlay.dataset.nodeLine) : NaN;
    const contextNode = Number.isNaN(contextLine) ? null : this.getNodeByLine(contextLine);

    if (contextNode && !this.selectedNodeLines.has(contextNode.line)) {
      this.selectNode(contextNode.line);
    } else {
      this.wrapper?.focus();
    }

    const selectedNodes = this.getSelectedNodesForContext(contextNode);
    const copyCount = selectedNodes.length;
    const targetNode = contextNode ?? (this.selectedNodeLines.size === 1 ? selectedNodes[0] : null);
    const menu = new Menu();

    if (copyCount > 0) {
      menu.addItem((item) => {
        item
          .setTitle(copyCount > 1 ? `Copy ${copyCount} nodes` : 'Copy')
          .setIcon('copy')
          .onClick(() => void this.copyNodesToClipboard(selectedNodes));
      });

      menu.addItem((item) => {
        item
          .setTitle(copyCount > 1 ? `Cut ${copyCount} nodes` : 'Cut')
          .setIcon('scissors')
          .onClick(() => void this.cutNodesToClipboard(selectedNodes));
      });

      menu.addItem((item) => {
        item
          .setTitle(copyCount > 1 ? `Delete ${copyCount} nodes` : 'Delete')
          .setIcon('trash')
          .onClick(() => void this.deleteNodesWithConfirmation(selectedNodes));
      });
    }

    if (targetNode) {
      if (copyCount > 0) menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle('Add child')
          .setIcon('plus')
          .onClick(() => void this.executeAddChildCommand(targetNode));
      });

      menu.addItem((item) => {
        item
          .setTitle('Add sibling')
          .setIcon('git-pull-request-create')
          .onClick(() => void this.executeAddSiblingCommand(targetNode));
      });

      menu.addItem((item) => {
        item
          .setTitle('Edit node')
          .setIcon('edit-3')
          .onClick(() => void this.enterEditModeForNodeByLine(targetNode.line));
      });

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle('Paste')
          .setIcon('clipboard-paste')
          .onClick(() => void this.pasteClipboardAsChildren(targetNode));
      });

      menu.addItem((item) => {
        item
          .setTitle('Duplicate')
          .setIcon('copy-plus')
          .onClick(() => void this.executeDuplicateNodeCommand(targetNode));
      });
    }

    if (copyCount === 0 && !targetNode) {
      menu.addItem((item) => item.setTitle('No node selected').setDisabled(true));
    }

    menu.showAtMouseEvent(event);
  }

  private getSelectedNodesForContext(contextNode: OutlineNode | null): OutlineNode[] {
    const flat = this.getFlatNodes();
    const selected = flat
      .filter((node) => this.selectedNodeLines.has(node.line))
      .sort((a, b) => a.line - b.line);

    if (selected.length > 0 && (!contextNode || this.selectedNodeLines.has(contextNode.line))) {
      return selected;
    }

    return contextNode ? [contextNode] : [];
  }

  private getTopLevelNodes(nodes: OutlineNode[]): OutlineNode[] {
    return nodes.filter((node) => {
      return !nodes.some((other) => (
        other !== node &&
        node.line > other.line &&
        node.line <= other.endLine
      ));
    });
  }

  private getNodesAsMarkdown(nodes: OutlineNode[]): string {
    const lines = this.data.split(/\r?\n/);
    return this.getTopLevelNodes(nodes)
      .sort((a, b) => a.line - b.line)
      .map((node) => lines.slice(node.line, node.endLine + 1).join('\n'))
      .join('\n');
  }

  private async copyNodesToClipboard(nodes: OutlineNode[]): Promise<boolean> {
    const text = this.getNodesAsMarkdown(nodes);
    if (!text) return false;

    this.mindmapClipboardText = text;
    this.pendingCutNodeLines.clear();
    this.updateSelectionStyling();

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Copy failed:', error);
      new Notice('Copied inside mindmap.');
      return true;
    }
  }

  private async cutNodesToClipboard(nodes: OutlineNode[]): Promise<void> {
    const text = this.getNodesAsMarkdown(nodes);
    const topLevelNodes = this.getTopLevelNodes(nodes);
    if (!text || topLevelNodes.length === 0) return;

    this.mindmapClipboardText = text;
    this.pendingCutNodeLines = new Set(topLevelNodes.map((node) => node.line));
    this.updateSelectionStyling();

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Cut clipboard write failed:', error);
      new Notice('Cut saved inside mindmap.');
    }

    this.wrapper?.focus();
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

    const beforeState = this.data;
    const newDoc = await deleteMultipleNodesKeepChildren(this.app, this.file, nodes);

    if (newDoc === beforeState) return;

    const command: import('./command-history').MindmapCommand = {
      type: 'delete-node-keep-children',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]),
      metadata: { count: nodes.length }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command);
    this.selectedNodeLines.clear();
  }

  private async deleteNodesWithConfirmation(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const selectedLines = new Set(nodes.map((node) => node.line));
    const topLevelNodes = this.getTopLevelNodes(nodes);

    if (!this.hasUnselectedDescendants(topLevelNodes, selectedLines)) {
      await this.executeDeleteMultipleNodesCommand(topLevelNodes);
      return;
    }

    new DeleteNodeModal(this.app, async (result) => {
      if (!this.file) return;

      if (result === "full") {
        await this.executeDeleteMultipleNodesCommand(topLevelNodes);
      } else if (result === "single") {
        await this.deleteNodesKeepingChildren(nodes);
      }
    }).open();
  }

  private async pasteClipboardAsChildren(targetNode: OutlineNode): Promise<void> {
    try {
      let text = '';

      try {
        text = await navigator.clipboard.readText();
      } catch (error) {
        console.error('Paste clipboard read failed:', error);
      }

      if (!text.trim()) {
        text = this.mindmapClipboardText ?? '';
      }

      if (!text.trim()) return;

      const pendingCutNodes = this.getPendingCutNodes();
      if (pendingCutNodes.length > 0 && text === this.mindmapClipboardText) {
        await this.executeCutPasteNodesCommand(pendingCutNodes, targetNode, text);
        return;
      }

      await this.executePasteNodesCommand(targetNode, text);
    } catch (error) {
      console.error('Paste failed:', error);
      new Notice('Paste failed.');
    }
  }

  private getPendingCutNodes(): OutlineNode[] {
    if (this.pendingCutNodeLines.size === 0) return [];

    return this.getFlatNodes()
      .filter((node) => this.pendingCutNodeLines.has(node.line))
      .sort((a, b) => a.line - b.line);
  }

  private getNodeByLine(nodeLine: number): OutlineNode | null {
    return this.getFlatNodes().find((node) => node.line === nodeLine) ?? null;
  }

  private handleWrapperKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
      if (this.selectedNodeLines.size === 1) {
        event.preventDefault();
        const selectedNode = this.getNodeByLine(Array.from(this.selectedNodeLines)[0]);
        if (selectedNode) {
          if (event.shiftKey) {
            void this.executeAddSiblingCommand(selectedNode);
          } else {
            void this.executeAddChildCommand(selectedNode);
          }
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
    keyboardNavigation: 'hierarchical'
  };

  private nodeOptions: NodeOptions = {
    nodeWidth: 300
  };

  constructor(leaf: WorkspaceLeaf, _plugin: MindmapPlugin) {
    super(leaf);
    this.frontmatterStorage = new FrontmatterStorage(this.app);
    this.commandHistory = new CommandHistory(this.app);
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
    this.data = d || '';
    if (this.isLocalUpdate) {
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
    
    const newContent = this.data + (this.data.trim() === '' ? '' : '\n') + '- ';
    this.data = newContent;
    
    // Persist the change
    await this.app.vault.modify(this.file, newContent);
    
    // Redraw to show the new node
    await this.draw();
  }

  /** Show empty state UI */
  private showEmptyState(): void {
    this.contentEl.empty();
    
    const container = this.contentEl.createDiv({ cls: 'mindmap-empty-state' });

    const title = container.createEl('h2', { text: 'Start your mindmap' });
    title.addClass('mindmap-empty-title');

    const description = container.createEl('p', { text: 'Click the button below to create your first node' });
    description.addClass('mindmap-empty-description');

    const button = container.createEl('button', { text: 'Create First Node' });
    button.addClass('mindmap-empty-button');
    button.onclick = () => this.createFirstNode();
  }

  /** Show incompatible content warning */
  private showIncompatibleWarning(): void {
    this.contentEl.empty();
    
    const container = this.contentEl.createDiv({ cls: 'mindmap-warning-state' });

    const icon = container.createDiv({ cls: 'mindmap-warning-icon' });
    icon.innerHTML = '⚠️';

    const title = container.createEl('h2', { text: 'Incompatible Content' });
    title.addClass('mindmap-warning-title');

    const description = container.createDiv({ cls: 'mindmap-warning-description' });
    description.innerHTML = `
      <p>This file contains content that isn't compatible with the mindmap view.</p>
      <p>The mindmap requires an outline structure using list items:</p>
      <ul class="mindmap-warning-list">
        <li>like this
      </ul>
      <p>Please start with an empty file or the mentioned format.</p>
    `;

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
  public async applyDocIncrementalWithCommand(d: DocString, command?: import('./command-history').MindmapCommand): Promise<void> {
    this.isLocalUpdate = true;
    this.data = d;
    
    // Record command in history
    if (command) {
      this.commandHistory.executeCommand(command);
    }
    
    // Always use incremental update - no special cases
    await this.incrementalUpdate();
    
    // Force toolbar button update after command execution
    this.forceToolbarUpdate();

    // Reset local update flag after giving file watcher time to catch up
    setTimeout(() => {
      this.isLocalUpdate = false;
    }, 1000);
  }

  // Make this the standard method for all operations
  public applyDocWithCommand(d: DocString, command?: import('./command-history').MindmapCommand): void {
    void this.applyDocIncrementalWithCommand(d, command);
  }

  /** Incremental update that reuses existing measurements where possible */
  public async incrementalUpdate(): Promise<void> {
    // Document edits can shift line numbers, and nodes may contain rendered Markdown
    // whose dimensions are much larger than the source text. Reuse the full
    // measurement path so layout always uses current rendered node sizes.
    await this.draw();
  }

  /* ── Lifecycle ───────────────────────────── */
  async onOpen(): Promise<void> {
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

    this.toolbar = new VerticalToolbar(this);

    if (this.file) {
      this.data = await this.app.vault.read(this.file);
      await this.draw();
    }

    window.addEventListener('resize', this.updateOverlays);
  }

  async onClose(): Promise<void> {
    window.removeEventListener('resize', this.updateOverlays);
    this.cy?.destroy();
    
    // Clean up CSS when last mindmap view closes
    const mindmapViews = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
    if (mindmapViews.length <= 1) {
      const style = document.getElementById('mindmap-obsidian-css');
      if (style) style.remove();
    }
  }

  /* ── draw-Wrapper ────────────────────────── */
  private async draw(): Promise<void> {
    // Check content compatibility first
    if (isEmptyContent(this.data)) {
      this.showEmptyState();
      return;
    }
    
    if (!isOutlineCompatible(this.data)) {
      this.showIncompatibleWarning();
      return;
    }
    
    await drawMindmap(this);
  }

  /* ── relayout() ─────────────────────────── */
  public relayout(): void {
    if (!this.cy) return;

    const L = this.layoutOptions;
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

  async onLoadFile(file: TFile): Promise<void> {
    super.onLoadFile(file);
    
    if (this.frontmatterStorage && file) {
      const mindmapData = await this.frontmatterStorage.loadMindmapData(file);
      
      // Load general settings
      if (mindmapData.keyboardNavigation) {
        this.generalSettings.keyboardNavigation = mindmapData.keyboardNavigation;
      }

      // Load node width from frontmatter (flat structure)
      if (typeof mindmapData.nodeWidth === 'number') {
        this.nodeOptions.nodeWidth = mindmapData.nodeWidth;
        this.toolbar?.setNodeOptions(this.nodeOptions);
      }
      
      // Load layout options from frontmatter (flat structure)
      const layoutUpdates: Partial<LayoutOptions> = {};
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
      
      if (Object.keys(layoutUpdates).length > 0) {
        this.layoutOptions = { ...this.layoutOptions, ...layoutUpdates };
      }
    }
  }

  public async executeUndo(): Promise<void> {
    if (!this.file || !this.commandHistory.canUndo()) return;
    
    const newData = await this.commandHistory.undo(this.file);
    if (newData !== null) {
      this.data = newData;
      await this.draw();
      
      // Force toolbar update
      this.forceToolbarUpdate();
    }
  }

  public async executeRedo(): Promise<void> {
    if (!this.file || !this.commandHistory.canRedo()) return;
    
    const newData = await this.commandHistory.redo(this.file);
    if (newData !== null) {
      this.data = newData;
      await this.draw();
      
      // Force toolbar update
      this.forceToolbarUpdate();
    }
  }

  // New command execution methods that handle everything properly
  public async executeAddChildCommand(parentNode: OutlineNode): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newChildLine = parentNode.line + 1;
    const newDoc = await addChild(this.app, this.file, parentNode);
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-child',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode)
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
    this.scheduleEditModeForNodeByLine(newChildLine);
  }

  public async executeAddSiblingCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newSiblingLine = node.endLine + 1;
    const newDoc = await addSibling(this.app, this.file, node);
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
    this.scheduleEditModeForNodeByLine(newSiblingLine);
  }

  public async executeEditNodeCommand(node: OutlineNode, newText: string): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newDoc = await writeNode(this.app, this.file, node, newText);
    
    const command: import('./command-history').MindmapCommand = {
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
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executeDeleteNodeCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const newDoc = await deleteNode(this.app, this.file, node);

    const command: import('./command-history').MindmapCommand = {
      type: 'delete-node',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };

    await this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executeDeleteMultipleNodesCommand(nodes: OutlineNode[]): Promise<void> {
    if (!this.file || nodes.length === 0) return;

    const beforeState = this.data;
    const newDoc = await deleteMultipleNodes(this.app, this.file, nodes);

    const command: import('./command-history').MindmapCommand = {
      type: 'delete-node', // reusing the type for simplicity, or could add delete-multiple-nodes
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(nodes[0]) // just store info of first node
    };

    await this.applyDocIncrementalWithCommand(newDoc, command);
    this.selectedNodeLines.clear();
  }
  public async executeDeleteNodeKeepChildrenCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newDoc = await deleteNodeKeepChildren(this.app, this.file, node);
    
    const command: import('./command-history').MindmapCommand = {
      type: 'delete-node-keep-children',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executeMoveSubtreeCommand(sourceNode: OutlineNode, targetNode: OutlineNode, insertAsChild: boolean): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newDoc = await moveSubtree(this.app, this.file, sourceNode, targetNode, insertAsChild);
    
    if (newDoc === beforeState) {
      return; // No change
    }
    
    const command: import('./command-history').MindmapCommand = {
      type: 'move-subtree',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(sourceNode),
      targetInfo: CommandHistory.createNodeInfo(targetNode),
      metadata: { insertAsChild }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executeAddChildTextCommand(parentNode: OutlineNode, text: string): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newDoc = await addChildText(this.app, this.file, parentNode, text);
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-child-text',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { addedText: text.substring(0, 100) }
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executePasteNodesCommand(parentNode: OutlineNode, text: string): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const newDoc = await addMarkdownAsChildren(this.app, this.file, parentNode, text);

    if (newDoc === beforeState) return;

    const command: import('./command-history').MindmapCommand = {
      type: 'add-child-text',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { pastedText: text.substring(0, 100) }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executeCutPasteNodesCommand(sourceNodes: OutlineNode[], parentNode: OutlineNode, text: string): Promise<void> {
    if (!this.file || sourceNodes.length === 0) return;

    const beforeState = this.data;
    const newDoc = await cutPasteMarkdownAsChildren(this.app, this.file, sourceNodes, parentNode, text);

    if (newDoc === beforeState) {
      new Notice('Cannot paste cut nodes into themselves.');
      return;
    }

    const command: import('./command-history').MindmapCommand = {
      type: 'move-subtree',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(sourceNodes[0]),
      targetInfo: CommandHistory.createNodeInfo(parentNode),
      metadata: { count: sourceNodes.length, cutPaste: true }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command);
    this.pendingCutNodeLines.clear();
    this.selectedNodeLines.clear();
    this.updateSelectionStyling();
  }

  public async executeDuplicateNodeCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;

    const beforeState = this.data;
    const newDoc = await duplicateSubtree(this.app, this.file, node);

    if (newDoc === beforeState) return;

    const command: import('./command-history').MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node),
      metadata: { duplicated: true }
    };

    await this.applyDocIncrementalWithCommand(newDoc, command);
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
    
    // Clear size map to force remeasurement with new options
    this.sizeMap.clear();
    this.measurementCache.clear();
    // Trigger full redraw
    void this.draw();
  }

  public async updateLayoutOptions(newOptions: Partial<LayoutOptions>): Promise<void> {
    this.layoutOptions = { ...this.layoutOptions, ...newOptions };
    
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

    const nextZoom = Math.max(this.cy.minZoom(), Math.min(this.cy.maxZoom(), zoomFactor));
    const roundedZoom = Number(nextZoom.toFixed(3));

    if (renderedPosition) {
      this.cy.zoom({ level: roundedZoom, renderedPosition });
    } else {
      const containerRect = this.cy.container()?.getBoundingClientRect();
      this.cy.zoom({
        level: roundedZoom,
        renderedPosition: {
          x: containerRect ? containerRect.width / 2 : 0,
          y: containerRect ? containerRect.height / 2 : 0,
        },
      });
    }

    this.layoutOptions.zoomFactor = roundedZoom;
    this.toolbar?.setZoomFactor(roundedZoom);

    if (save) {
      this.queueZoomFactorSave(roundedZoom);
    }
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

    this.zoomSaveTimeout = window.setTimeout(async () => {
      this.zoomSaveTimeout = null;
      if (!this.file || !this.frontmatterStorage) return;

      try {
        await this.frontmatterStorage.updateLayoutOptions(this.file, { zoomFactor });
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
      requestAnimationFrame(() => {
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
    this.updateSelectionStyling();

    this.wrapper?.focus();
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
  private updateSelectionStyling(): void {
    if (!this.wrapper) return;

    this.wrapper.querySelectorAll('[data-overlay]').forEach((overlay) => {
      const line = Number((overlay as HTMLElement).dataset.nodeLine);
      overlay.classList.toggle('selected', this.selectedNodeLines.has(line));
      overlay.classList.toggle('cut-pending', this.pendingCutNodeLines.has(line));
    });
  }

  private getFlatNodes(): OutlineNode[] {
    const flat: OutlineNode[] = [];
    (function walk(arr: OutlineNode[]) {
      arr.forEach((node) => {
        flat.push(node);
        walk(node.children);
      });
    })(parseOutline(this.data));
    return flat;
  }

  private navigateSelection(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (this.generalSettings.keyboardNavigation === 'spatial') {
      this.navigateSpatial(direction);
      return;
    }

    const flat = this.getFlatNodes();
    if (flat.length === 0) return;

    const selectedArray = Array.from(this.selectedNodeLines);
    const lastSelectedLine = selectedArray.length > 0 ? selectedArray[selectedArray.length - 1] : null;

    if (lastSelectedLine === null) {
      this.selectNode(flat[0].line);
      return;
    }

    const current = flat.find(node => node.line === lastSelectedLine);
    if (!current) {
      this.selectNode(flat[0].line);
      return;
    }

    const parent = flat.find(node => node.children.some(child => child.line === current.line));

    if (direction === 'up') {
      if (parent) this.selectNode(parent.line);
      return;
    }

    if (direction === 'down') {
      if (current.children[0]) this.selectNode(current.children[0].line);
      return;
    }

    if (!parent) return;

    const siblingIndex = parent.children.findIndex(child => child.line === current.line);
    if (siblingIndex < 0) return;

    if (direction === 'left') {
      const previousSibling = parent.children[siblingIndex - 1];
      if (previousSibling) this.selectNode(previousSibling.line);
      return;
    }

    if (direction === 'right') {
      const nextSibling = parent.children[siblingIndex + 1];
      if (nextSibling) this.selectNode(nextSibling.line);
    }
  }

  private navigateSpatial(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (!this.cy) return;
    const nodes = this.cy.nodes();
    if (nodes.length === 0) return;

    const selectedArray = Array.from(this.selectedNodeLines);
    const lastSelectedLine = selectedArray.length > 0 ? selectedArray[selectedArray.length - 1] : null;

    if (lastSelectedLine === null) {
      const firstLine = nodes[0].data('node')?.line;
      if (firstLine !== undefined) this.selectNode(firstLine);
      return;
    }

    const currentCyNode = this.cy.getElementById(`n${lastSelectedLine}`);
    if (!currentCyNode || currentCyNode.empty()) {
      const firstLine = nodes[0].data('node')?.line;
      if (firstLine !== undefined) this.selectNode(firstLine);
      return;
    }

    const currentPos = currentCyNode.position();
    let bestNode: NodeSingular | null = null;
    let bestScore = Infinity;

    nodes.forEach(n => {
      const node = n as import('cytoscape').NodeSingular;
      if (!node.isNode?.() || node.id() === currentCyNode.id()) return;
      const pos = node.position();

      const dx = pos.x - currentPos.x;
      const dy = pos.y - currentPos.y;

      let distanceScore = Infinity;

      if (direction === 'right') {
        if (dx > 0) distanceScore = dx + Math.abs(dy) * 3;
      } else if (direction === 'left') {
        if (dx < 0) distanceScore = -dx + Math.abs(dy) * 3;
      } else if (direction === 'down') {
        if (dy > 0) distanceScore = dy + Math.abs(dx) * 3;
      } else if (direction === 'up') {
        if (dy < 0) distanceScore = -dy + Math.abs(dx) * 3;
      }

      if (distanceScore < bestScore) {
        bestScore = distanceScore;
        bestNode = node;
      }
    });

    if (bestNode) {
      const bestLine = (bestNode as unknown as import('cytoscape').NodeSingular).data('node')?.line;
      if (bestLine !== undefined) this.selectNode(bestLine);
    }
  }

  private centerSelectedNodeInView(): void {
    if (!this.cy || this.selectedNodeLines.size === 0) return;

    const selectedArray = Array.from(this.selectedNodeLines);
    const nodeLine = selectedArray[selectedArray.length - 1];
    const cyNode = this.cy.getElementById(`n${nodeLine}`);
    if (!cyNode || cyNode.empty()) return;

    requestAnimationFrame(() => {
      this.cy?.animate({
        center: { eles: cyNode },
        duration: 140,
      });
    });
  }

  public async enterEditModeForNodeByLine(nodeLine: number): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const overlay = this.wrapper?.querySelector(`[data-overlay][data-node-line="${nodeLine}"]`) as HTMLElement | null;
      if (overlay && !this.isUpdatingOverlays) {
        const node = this.getFlatNodes().find(candidate => candidate.line === nodeLine);
        if (!node) return;

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!overlay.isConnected || this.isUpdatingOverlays) continue;

        this.clearSelection();
        if (this.pendingEditNodeLine === nodeLine) {
          this.pendingEditNodeLine = null;
        }
        startNodeEditing(overlay, node, this);
        return;
      }

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    console.warn(`Overlay not found for line ${nodeLine} to start editing.`);
  }

  private scheduleEditModeForNodeByLine(nodeLine: number): void {
    let started = false;
    const startAfterOverlayUpdate = () => {
      if (started) return;
      started = true;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void this.enterEditModeForNodeByLine(nodeLine);
          });
        });
      });
    };

    this.cy?.one('layoutstop', startAfterOverlayUpdate);
    window.setTimeout(startAfterOverlayUpdate, 350);
  }
}
