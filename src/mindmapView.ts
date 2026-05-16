// src/mindmapView.ts

import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  MarkdownRenderer,
  Component,
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
  moveSubtree,
  addChildText,
  deleteNodeKeepChildren,
  DocString,
} from './mindmap-file';
import { VerticalToolbar } from './vertical-toolbar';
import { draw as drawMindmap } from './draw';
import { updateOverlays as updateOverlaysFn, startNodeEditing } from './updateOverlays';
import { NodeOptions } from './node-options-menu';
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
  acyciler?: 'greedy';
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
  spacingFactor?: number;
}

export interface MindmapViewState {
  file?: string;
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

  /**
   * Map von OutlineNode.line → gemessene Breite/Höhe (in px).
   * Wird von draw() gefüllt und später in updateOverlays() verwendet.
   */
  public sizeMap: Map<number, { w: number; h: number }> = new Map();

  /**
   * Layout-Optionen, die sich über das Modal ändern lassen.
   */
  public layoutOptions = {
    rankDir: 'TB' as 'TB' | 'BT' | 'LR' | 'RL',
    align: undefined as 'UL' | 'UR' | 'DL' | 'DR' | undefined,
    nodeSep: 50,
    edgeSep: 10,
    rankSep: 50,
    marginx: 0,
    marginy: 0,
    acyciler: undefined as 'greedy' | undefined,
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
  };

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
  }

  private handleWrapperKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.navigateSelection(event.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right');
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (this.selectedNodeLines.size > 0) {
        const flat = this.getFlatNodes();
        const nodesToDelete = flat.filter(n => this.selectedNodeLines.has(n.line));
        
        import('./delete-node-modal').then(({ DeleteNodeModal }) => {
          new DeleteNodeModal(this.app, async (result) => {
            if (!this.file) return;
            if (result === "full") {
              await this.executeDeleteMultipleNodesCommand(nodesToDelete);
            } else if (result === "single") {
              // Work from bottom to top to avoid shifting line numbers for subsequent deletions
              const sortedNodes = [...nodesToDelete].sort((a, b) => b.line - a.line);
              for (const node of sortedNodes) {
                await this.executeDeleteNodeKeepChildrenCommand(node);
              }
              this.selectedNodeLines.clear();
            }
          }).open();
        });
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
      if (this.selectedNodeLines.size > 0) {
        event.preventDefault();
        const flat = this.getFlatNodes();
        const nodesToCopy = flat.filter(n => this.selectedNodeLines.has(n.line));
        nodesToCopy.sort((a, b) => a.line - b.line);
        
        const textToCopy = nodesToCopy.map(n => n.text).join('\n');
        navigator.clipboard.writeText(textToCopy);
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'v') {
      if (this.selectedNodeLines.size === 1) {
        event.preventDefault();
        navigator.clipboard.readText().then(async (text) => {
          if (text) {
            const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
            const line = Array.from(this.selectedNodeLines)[0];
            const flat = this.getFlatNodes();
            const targetNode = flat.find(n => n.line === line);
            
            if (targetNode) {
              // Add children from bottom to top so they appear in correct order
              for (let i = lines.length - 1; i >= 0; i--) {
                await this.executeAddChildTextCommand(targetNode, lines[i].trim());
              }
            }
          }
        });
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

  private saveDebounceTimer?: number;

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

  /** Apply document changes with full rebuild */
  private applyDoc(d: DocString): void {
    this.data = d;
    void this.draw();
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

  private debouncedSaveCommandHistory(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = window.setTimeout(() => {
      this.saveCommandHistoryToFrontmatter().catch(error => {
        console.warn('Failed to save command history to frontmatter:', error);
      });
    }, 500); // Save after 500ms of inactivity
  }

  private async saveCommandHistoryToFrontmatter(): Promise<void> {
    if (this.file && this.frontmatterStorage) {
      try {
        const historyState = this.commandHistory.getHistoryState();
        await this.frontmatterStorage.updateCommandHistory(this.file, historyState);
      } catch (error) {
        console.warn('Failed to save command history:', error);
        // Clear history if saving fails consistently
        this.commandHistory.clear();
      }
    }
  }

  // Make this the standard method for all operations
  public applyDocWithCommand(d: DocString, command?: import('./command-history').MindmapCommand): void {
    void this.applyDocIncrementalWithCommand(d, command);
  }

  /** Incremental update that reuses existing measurements where possible */
  public async incrementalUpdate(): Promise<void> {
    if (!this.cy || !this.file) {
      await this.draw();
      return;
    }

    try {
      // Parse new outline (now simplified for single-line content)
      const flat: OutlineNode[] = [];
      (function walk(arr: import('./util').OutlineNode[]) {
        arr.forEach((n) => {
          flat.push(n);
          walk(n.children);
        });
      })(parseOutline(this.data));

      // Only measure nodes that don't have cached dimensions
      const nodesToMeasure = flat.filter(n => !this.sizeMap.has(n.line));
      
      if (nodesToMeasure.length > 0) {
        const measureContainer = document.createElement('div');
        Object.assign(measureContainer.style, {
          position: 'absolute',
          visibility: 'hidden',
          top: '0',
          left: '0',
          pointerEvents: 'none',
          zIndex: '-1',
        } as CSSStyleDeclaration);
        document.body.appendChild(measureContainer);

        for (const n of nodesToMeasure) {
          const generalOptions = this.getNodeOptions();
          const targetWidth = generalOptions.nodeWidth;
          
          const tmpBox = document.createElement('div');
          Object.assign(tmpBox.style, {
            position: 'relative',
            padding: '6px 10px 22px',
            border: '1px solid transparent',
            borderRadius: '4px',
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: '16px',
            whiteSpace: 'nowrap', // Single line only
            overflow: 'hidden',
            maxWidth: `${targetWidth}px`,
            boxSizing: 'border-box',
          } as CSSStyleDeclaration);

          if (n.text.trim() === '') {
            tmpBox.innerHTML = '&nbsp;';
          } else {
            tmpBox.textContent = n.text; // Simple text only, no markdown rendering
          }

          measureContainer.appendChild(tmpBox);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

          const rect = tmpBox.getBoundingClientRect();
          let measuredW = rect.width || targetWidth;
          let measuredH = rect.height || 40;

          if (measuredW > targetWidth) {
            const scale = targetWidth / measuredW;
            n.scaleFactor = scale;
            measuredW = targetWidth;
            measuredH = measuredH * scale;
          } else {
            measuredW = targetWidth;
          }

          this.sizeMap.set(n.line, { w: measuredW, h: measuredH });
          measureContainer.removeChild(tmpBox);
        }

        document.body.removeChild(measureContainer);
      }

      // Update cytoscape elements
      const els: import('cytoscape').ElementDefinition[] = [];
      for (const n of flat) {
        const dims = this.sizeMap.get(n.line)!;
        els.push({
          data: {
            id: `n${n.line}`,
            node: n,
            width: dims.w,
            height: dims.h,
          },
        });
      }
      for (const p of flat) {
        p.children.forEach((c) => {
          els.push({
            data: {
              id: `e${p.line}-${c.line}`,
              source: `n${p.line}`,
              target: `n${c.line}`,
            },
          });
        });
      }

      // Update cytoscape elements
      this.cy.json({ elements: els });
      
      // We must relayout when nodes are added/removed/changed
      this.relayout();
      
    } catch (error) {
      console.error('Incremental update failed, falling back to full draw:', error);
      await this.draw();
    }
  }

  /** Optimized update specifically for move operations that preserves visual state */
  public async optimizedMoveUpdate(
    visualState: Map<
      number,
      {
        dims: { w: number; h: number };
        scaleFactor?: number;
        position?: { x: number; y: number };
      }
    >
  ): Promise<void> {
    if (!this.cy || !this.file) return;

    // Parse new outline
    const flat: OutlineNode[] = [];
    (function walk(arr: import('./util').OutlineNode[]) {
      arr.forEach((n) => {
        flat.push(n);
        walk(n.children);
      });
    })(parseOutline(this.data));

    // Only measure nodes that are actually new or have changed content
    const measureContainer = document.createElement('div');
    Object.assign(measureContainer.style, {
      position: 'absolute',
      visibility: 'hidden',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      zIndex: '-1',
    } as CSSStyleDeclaration);
    document.body.appendChild(measureContainer);

    // Restore preserved visual state where possible
    flat.forEach(n => {
      const preserved = visualState.get(n.line);
      if (preserved) {
        this.sizeMap.set(n.line, preserved.dims);
        if (preserved.scaleFactor) {
          n.scaleFactor = preserved.scaleFactor;
        }
      }
    });

    // Only measure nodes that don't have preserved dimensions
    const nodesToMeasure = flat.filter(n => !this.sizeMap.has(n.line));
    
    for (const n of nodesToMeasure) {
      const generalOptions = this.getNodeOptions();
      const targetWidth = generalOptions.nodeWidth;
      
      const tmpBox = document.createElement('div');
      Object.assign(tmpBox.style, {
        position: 'relative',
        padding: '6px 10px 22px',
        border: '1px solid transparent',
        borderRadius: '4px',
        background: 'transparent',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: '16px',
        whiteSpace: 'nowrap', // Single line only
        overflow: 'hidden',
        maxWidth: `${targetWidth}px`,
        boxSizing: 'border-box',
      } as CSSStyleDeclaration);

      if (n.text.trim() === '') {
        tmpBox.innerHTML = '&nbsp;';
      } else {
        tmpBox.textContent = n.text; // Simple text only, no markdown rendering
      }

      measureContainer.appendChild(tmpBox);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const rect = tmpBox.getBoundingClientRect();
      let measuredW = rect.width || targetWidth;
      let measuredH = rect.height || 40;

      if (measuredW > targetWidth) {
        const scale = targetWidth / measuredW;
        n.scaleFactor = scale;
        measuredW = targetWidth;
        measuredH = measuredH * scale;
      } else {
        measuredW = targetWidth;
      }

      this.sizeMap.set(n.line, { w: measuredW, h: measuredH });
      measureContainer.removeChild(tmpBox);
    }

    document.body.removeChild(measureContainer);

    // Update cytoscape elements with preserved state
    const els: import('cytoscape').ElementDefinition[] = [];
    for (const n of flat) {
      const dims = this.sizeMap.get(n.line)!;
      els.push({
        data: {
          id: `n${n.line}`,
          node: n,
          width: dims.w,
          height: dims.h,
        },
      });
    }
    for (const p of flat) {
      p.children.forEach((c) => {
        els.push({
          data: {
            id: `e${p.line}-${c.line}`,
            source: `n${p.line}`,
            target: `n${c.line}`,
          },
        });
      });
    }

    // Smart cytoscape update - preserve positions where possible
    this.cy.json({ elements: els });
    
    // Restore positions for nodes that still exist
    flat.forEach(n => {
      const preserved = visualState.get(n.line);
      if (preserved?.position) {
        const cyNode = this.cy!.getElementById(`n${n.line}`);
        if (cyNode.length > 0) {
          cyNode.position(preserved.position);
        }
      }
    });
    
    // Only do minimal relayout for new connections - fix the layout options
    const layout = this.cy.layout({
      name: 'preset',
      fit: false
    });
    
    layout.run();
    
    // Update overlays without full rebuild
    this.updateOverlays();
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
      acyciler: L.acyciler,
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
      if (mindmapData.acyciler) layoutUpdates.acyciler = mindmapData.acyciler;
      if (mindmapData.ranker) layoutUpdates.ranker = mindmapData.ranker;
      if (typeof mindmapData.spacingFactor === 'number') layoutUpdates.spacingFactor = mindmapData.spacingFactor;
      
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
    this.pendingEditNodeLine = newChildLine;
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-child',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode)
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
    await this.enterEditModeForNodeByLine(newChildLine);
  }

  public async executeAddSiblingCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newSiblingLine = node.endLine + 1;
    const newDoc = await addSibling(this.app, this.file, node);
    this.pendingEditNodeLine = newSiblingLine;
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };
    
    await this.applyDocIncrementalWithCommand(newDoc, command);
    await this.enterEditModeForNodeByLine(newSiblingLine);
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

  public selectNode(nodeLine: number, append: boolean = false, fromCy: boolean = false): void {
    if (!append) {
      this.selectedNodeLines.clear();
      if (this.cy && !fromCy) this.cy.nodes().unselect();
    }
    this.selectedNodeLines.add(nodeLine);
    this.updateSelectionStyling();
    
    if (!fromCy) {
      this.wrapper?.focus();
    }

    if (this.cy && !fromCy) {
      const cyNode = this.cy.getElementById(`n${nodeLine}`);
      if (cyNode && !cyNode.selected()) cyNode.select();
    }
  }

  public deselectNode(nodeLine: number, fromCy: boolean = false): void {
    this.selectedNodeLines.delete(nodeLine);
    this.updateSelectionStyling();

    if (this.cy && !fromCy) {
      const cyNode = this.cy.getElementById(`n${nodeLine}`);
      if (cyNode && cyNode.selected()) cyNode.unselect();
    }
  }

  public clearSelection(): void {
    if (this.selectedNodeLines.size === 0) return;
    this.selectedNodeLines.clear();
    this.updateSelectionStyling();
    if (this.cy) this.cy.nodes().unselect();
  }

  private updateSelectionStyling(): void {
    if (!this.wrapper) return;

    this.wrapper.querySelectorAll('[data-overlay]').forEach((overlay) => {
      const line = Number((overlay as HTMLElement).dataset.nodeLine);
      overlay.classList.toggle('selected', this.selectedNodeLines.has(line));
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

  public async enterEditModeForNodeByLine(nodeLine: number): Promise<void> {
    for (let i = 0; i < 12; i++) {
      const overlay = this.wrapper?.querySelector(`[data-overlay][data-node-line="${nodeLine}"]`) as HTMLElement | null;
      if (overlay && !this.isUpdatingOverlays) {
        const node = this.getFlatNodes().find(candidate => candidate.line === nodeLine);
        if (!node) return;

        this.clearSelection();
        const css = getComputedStyle(document.documentElement);
        const font = css.getPropertyValue('--font-family').trim() || 'inherit';
        const txt = css.getPropertyValue('--text-normal').trim() || '#000';
        startNodeEditing(overlay, node, this, font, txt);
        return;
      }

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    console.warn(`Overlay not found for line ${nodeLine} to start editing.`);
  }
}
