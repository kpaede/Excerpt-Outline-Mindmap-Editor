// src/mindmapView.ts

import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  MarkdownRenderer,
  Component,
} from 'obsidian';
import { Core } from 'cytoscape';

import './dnd-css';

import { parseOutline, OutlineNode, isOutlineCompatible, isEmptyContent } from './util';
import { VIEW_TYPE_MINDMAP } from './constants';
import MindmapPlugin from './main';
import {
  addChild,
  addSibling,
  writeNode,
  deleteNode,
  moveSubtree,
  addChildText,
  deleteNodeKeepChildren,
  DocString,
} from './mindmap-file';
import { VerticalToolbar } from './vertical-toolbar';
import { draw as drawMindmap } from './draw';
import { updateOverlays as updateOverlaysFn } from './updateOverlays';
import { NodeOptions } from './node-options-menu';
import { FrontmatterStorage } from './frontmatter-storage';
import { CommandHistory } from './command-history';

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

export class MindmapView extends TextFileView {
  public file: TFile | null = null;
  public cy?: Core;
  public wrapper!: HTMLDivElement;
  public firstFitDone = false;
  public toolbar?: VerticalToolbar;
  public isUpdatingOverlays = false;
  public frontmatterStorage: FrontmatterStorage;
  public commandHistory: CommandHistory;

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

  setViewData(d: string): void {
    this.data = d;
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
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '16px',
      padding: '40px',
      textAlign: 'center',
    });
    

    const title = container.createEl('h2', { text: 'Start your mindmap' });
    Object.assign(title.style, {
      margin: '0',
      opacity: '0.8',
    });
    
    const description = container.createEl('p', { text: 'Click the button below to create your first node' });
    Object.assign(description.style, {
      margin: '0 0 16px 0',
      opacity: '0.6',
    });
    
    const button = container.createEl('button', { text: 'Create First Node' });
    Object.assign(button.style, {
      padding: '12px 24px',
      fontSize: '16px',
      cursor: 'pointer',
      borderRadius: '6px',
      border: '1px solid var(--interactive-accent)',
      background: 'var(--interactive-accent)',
      color: 'var(--text-on-accent)',
    });
    
    button.onclick = () => this.createFirstNode();
  }

  /** Show incompatible content warning */
  private showIncompatibleWarning(): void {
    this.contentEl.empty();
    
    const container = this.contentEl.createDiv({ cls: 'mindmap-warning-state' });
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '16px',
      padding: '40px',
      textAlign: 'center',
    });
    
    const icon = container.createDiv();
    icon.innerHTML = '⚠️';
    Object.assign(icon.style, {
      fontSize: '48px',
      opacity: '0.6',
    });
    
    const title = container.createEl('h2', { text: 'Incompatible Content' });
    Object.assign(title.style, {
      margin: '0',
      color: 'var(--text-error)',
    });
    
    const description = container.createDiv();
    description.innerHTML = `
      <p>This file contains content that isn't compatible with the mindmap view.</p>
      <p>The mindmap requires an outline structure using list items:</p>
      <ul style="text-align: left; display: inline-block;">
        <li>like this
      </ul>
      <p>Please start with an empty file or the mentioned format.</p>
    `;
    Object.assign(description.style, {
      margin: '0',
      opacity: '0.8',
      maxWidth: '500px',
    });

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
  public applyDocIncrementalWithCommand(d: DocString, command?: import('./command-history').MindmapCommand): void {
    this.data = d;
    
    // Record command in history
    if (command) {
      this.commandHistory.executeCommand(command);
    }
    
    // Always use incremental update - no special cases
    void this.incrementalUpdate();
    
    // Force toolbar button update after command execution
    this.forceToolbarUpdate();
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
    this.applyDocIncrementalWithCommand(d, command);
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

      // Update cytoscape without full relayout
      this.cy.json({ elements: els });
      
      // Only trigger overlay update, no layout changes
      this.updateOverlays();
      
    } catch (error) {
      console.error('Incremental update failed, falling back to full draw:', error);
      await this.draw();
    }
  }

  /** Optimized update specifically for move operations that preserves visual state */
  public async optimizedMoveUpdate(visualState: Map<number, any>): Promise<void> {
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
      if (preserved) {
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
    const st = this.leaf.getViewState().state as any;
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
    Object.assign(this.wrapper.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
    });

    // Add CSS for better Obsidian content rendering
    if (!document.getElementById('mindmap-obsidian-css')) {
      const style = document.createElement('style');
      style.id = 'mindmap-obsidian-css';
      style.textContent = `
        .mindmap-wrapper .markdown-rendered {
          font-size: inherit;
          line-height: 1.4;
        }
        .mindmap-wrapper .markdown-rendered img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
        }
        .mindmap-wrapper .markdown-rendered a.internal-link {
          color: var(--link-color);
          text-decoration: none;
        }
        .mindmap-wrapper .markdown-rendered a.internal-link:hover {
          color: var(--link-color-hover);
          text-decoration: underline;
        }
        .mindmap-wrapper .markdown-rendered code {
          background: var(--code-background);
          padding: 2px 4px;
          border-radius: 2px;
          font-size: 0.9em;
        }
        .mindmap-wrapper .markdown-rendered pre {
          background: var(--code-background);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
        }
        .mindmap-wrapper .markdown-rendered blockquote {
          border-left: 3px solid var(--quote-opening-modifier);
          padding-left: 12px;
          margin: 8px 0;
          opacity: 0.8;
        }
      `;
      document.head.appendChild(style);
    }

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
    } as any;

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
    const newDoc = await addChild(this.app, this.file, parentNode);
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-child',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(parentNode)
    };
    
    this.applyDocIncrementalWithCommand(newDoc, command);
  }

  public async executeAddSiblingCommand(node: OutlineNode): Promise<void> {
    if (!this.file) return;
    
    const beforeState = this.data;
    const newDoc = await addSibling(this.app, this.file, node);
    
    const command: import('./command-history').MindmapCommand = {
      type: 'add-sibling',
      timestamp: Date.now(),
      beforeState,
      afterState: newDoc,
      nodeInfo: CommandHistory.createNodeInfo(node)
    };
    
    this.applyDocIncrementalWithCommand(newDoc, command);
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
    
    this.applyDocIncrementalWithCommand(newDoc, command);
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
    
    this.applyDocIncrementalWithCommand(newDoc, command);
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
    
    this.applyDocIncrementalWithCommand(newDoc, command);
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
    
    this.applyDocIncrementalWithCommand(newDoc, command);
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
    
    this.applyDocIncrementalWithCommand(newDoc, command);
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
}
