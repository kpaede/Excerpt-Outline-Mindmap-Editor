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
  DocString,
} from './mindmap-file';
import { VerticalToolbar } from './vertical-toolbar';
import { draw as drawMindmap } from './draw';
import { updateOverlays as updateOverlaysFn } from './updateOverlays';

export class MindmapView extends TextFileView {
  public file: TFile | null = null;
  public cy?: Core;
  public wrapper!: HTMLDivElement;
  public firstFitDone = false;
  public toolbar?: VerticalToolbar;

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

  constructor(leaf: WorkspaceLeaf, _plugin: MindmapPlugin) {
    super(leaf);
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

  /** Incremental update that preserves existing overlays when possible */
  private async incrementalUpdate(): Promise<void> {
    if (!this.cy || !this.file) return;

    // Parse new outline
    const flat: OutlineNode[] = [];
    (function walk(arr: import('./util').OutlineNode[]) {
      arr.forEach((n) => {
        flat.push(n);
        walk(n.children);
      });
    })(parseOutline(this.data));

    // Get current nodes for comparison
    const currentNodes = new Set(this.cy.nodes().map(n => n.id()));
    const newNodes = new Set(flat.map(n => `n${n.line}`));

    // Only do full rebuild if structure changed significantly
    const nodesAdded = [...newNodes].filter(id => !currentNodes.has(id));
    const nodesRemoved = [...currentNodes].filter(id => !newNodes.has(id));

    if (nodesAdded.length > 1 || nodesRemoved.length > 1) {
      // Significant structural change, do full rebuild
      await this.draw();
      return;
    }

    // Measure container for all nodes that need measurement
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

    // Measure ALL nodes to ensure sizeMap is complete
    for (const n of flat) {
      const nodeId = `n${n.line}`;
      const existingNode = this.cy.getElementById(nodeId);
      
      // Always measure if size is missing or node text changed
      if (!this.sizeMap.has(n.line) || !existingNode.length || existingNode.data('node')?.text !== n.text) {
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
          whiteSpace: 'normal',
          wordWrap: 'break-word',
          maxWidth: '260px',
          boxSizing: 'border-box',
        } as CSSStyleDeclaration);

        if (n.text.trim() === '') {
          tmpBox.innerHTML = '&nbsp;';
        } else {
          await MarkdownRenderer.renderMarkdown(
            n.text,
            tmpBox,
            this.file.path,
            (this as unknown) as Component
          );
        }

        measureContainer.appendChild(tmpBox);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        const rect = tmpBox.getBoundingClientRect();
        let measuredW = rect.width;
        const measuredH = rect.height;

        if (measuredW < 80) {
          measuredW = 80;
        }

        this.sizeMap.set(n.line, { w: measuredW, h: measuredH });
        measureContainer.removeChild(tmpBox);
      }
    }

    document.body.removeChild(measureContainer);

    // Verify all dimensions exist before proceeding
    const missingDimensions = flat.filter(n => !this.sizeMap.has(n.line));
    if (missingDimensions.length > 0) {
      console.warn('Missing dimensions for nodes, falling back to full rebuild');
      await this.draw();
      return;
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

    // Update cytoscape with new elements
    this.cy.json({ elements: els });
    
    // CRITICAL FIX: Update node data in existing cytoscape nodes
    // This ensures that overlay event handlers use the correct line numbers
    flat.forEach(newNode => {
      const cyNode = this.cy!.getElementById(`n${newNode.line}`);
      if (cyNode.length > 0) {
        cyNode.data('node', newNode);
      }
    });
    
    // Relayout only if structure changed
    if (nodesAdded.length > 0 || nodesRemoved.length > 0) {
      this.relayout();
    } else {
      // Just update overlays for text changes
      this.updateOverlays();
    }
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
}

export default MindmapView;
