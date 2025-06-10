// src/layout-options-modal.ts

import {
  App,
  Modal,
  Setting,
  TextComponent,
  DropdownComponent,
} from 'obsidian';
import type { MindmapView } from './mindmapView';
import { FrontmatterStorage } from './frontmatter-storage';

/**
 * LayoutOptionsModal zeigt alle Dagre-Parameter in einem modernen Dialog an,
 * der direkt neben dem angeklickten Zahnrad-Button positioniert wird.
 */
export class LayoutOptionsModal extends Modal {
  private view: MindmapView;
  private anchorEl: HTMLElement;

  /**
   * @param app        Die Obsidian-App-Instanz
   * @param view       Die referenzierte MindmapView, um layoutOptions zu ändern
   * @param anchorEl   Das HTML-Element des Buttons, neben dem das Modal erscheinen soll
   */
  constructor(app: App, view: MindmapView, anchorEl: HTMLElement) {
    super(app);
    this.view = view;
    this.anchorEl = anchorEl;
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    // 1) Zuerst modal normal öffnen, damit DOM-Elemente existieren
    //    (Modal.open() wurde bereits durch vertical-toolbar.ts aufgerufen)
    //    Jetzt positionieren wir modalEl relativ zum anchorEl.
    const rect = this.anchorEl.getBoundingClientRect();
    // modalEl ist standardmäßig in der Mitte; wir setzen transform und top/left neu:
    modalEl.style.position = 'absolute';
    modalEl.style.transform = 'none';
    // Positioniere den Dialog links vom Icon (maxWidth=320px + 8px Abstand)
    modalEl.style.left = `${rect.left + window.scrollX - 328}px`;
    modalEl.style.top = `${rect.top + window.scrollY}px`;

    // Max-Breite, damit es nicht zu breit überlappt
    modalEl.style.maxWidth = '320px';

    // 2) Inhalt des Modals neu aufbauen
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Layout Options' });

    const opts = this.view.layoutOptions;

    // ──────────── 1) Rank Direction ────────────
    new Setting(contentEl)
      .setName('Rank Direction')
      .setDesc('Direction for rank nodes (TB, BT, LR, RL)')
      .addDropdown((dropdown: DropdownComponent) => {
        const choices: Record<string, string> = {
          TB: 'TB (Top → Bottom)',
          BT: 'BT (Bottom → Top)',
          LR: 'LR (Left → Right)',
          RL: 'RL (Right → Left)',
        };
        Object.entries(choices).forEach(([key, label]) => {
          dropdown.addOption(key, label);
        });
        dropdown.setValue(opts.rankDir);
        dropdown.onChange((value) => {
          opts.rankDir = value as 'TB' | 'BT' | 'LR' | 'RL';
          this.view.relayout();
          this.saveLayoutOptions();
        });
      });

    // ──────────── 2) Alignment ────────────
    new Setting(contentEl)
      .setName('Alignment')
      .setDesc('Alignment for rank nodes (UL, UR, DL, DR, none)')
      .addDropdown((dropdown: DropdownComponent) => {
        const choices: Record<string, string> = {
          none: 'none',
          UL: 'UL (Up-Left)',
          UR: 'UR (Up-Right)',
          DL: 'DL (Down-Left)',
          DR: 'DR (Down-Right)',
        };
        Object.entries(choices).forEach(([key, label]) => {
          dropdown.addOption(key, label);
        });
        // Standardwert auf UL setzen, falls undefined
        dropdown.setValue(opts.align ?? 'UL');
        dropdown.onChange((value) => {
          opts.align = value === 'none' ? undefined : (value as 'UL' | 'UR' | 'DL' | 'DR');
          this.view.relayout();
          this.saveLayoutOptions();
        });
      });

    // ──────────── 3) Acyclicer ────────────
    new Setting(contentEl)
      .setName('Acyclicer')
      .setDesc('Use greedy heuristic to remove cycles (or none)')
      .addDropdown((dropdown: DropdownComponent) => {
        const choices: Record<string, string> = {
          none: 'none',
          greedy: 'greedy',
        };
        Object.entries(choices).forEach(([key, label]) => {
          dropdown.addOption(key, label);
        });
        dropdown.setValue(opts.acyciler ?? 'none');
        dropdown.onChange((value) => {
          opts.acyciler = value === 'none' ? undefined : 'greedy';
          this.view.relayout();
          this.saveLayoutOptions();
        });
      });

    // ──────────── 4) Ranker ────────────
    new Setting(contentEl)
      .setName('Ranker')
      .setDesc('Algorithm for assigning ranks (network-simplex, tight-tree, longest-path)')
      .addDropdown((dropdown: DropdownComponent) => {
        const choices: Record<string, string> = {
          'network-simplex': 'network-simplex',
          'tight-tree': 'tight-tree',
          'longest-path': 'longest-path',
        };
        Object.entries(choices).forEach(([key, label]) => {
          dropdown.addOption(key, label);
        });
        // Standardwert auf tight-tree setzen, falls undefined
        dropdown.setValue(opts.ranker ?? 'tight-tree');
        dropdown.onChange((value) => {
          opts.ranker = value as 'network-simplex' | 'tight-tree' | 'longest-path';
          this.view.relayout();
          this.saveLayoutOptions();
        });
      });

    // ───────────────────────────────────────────────────────────────────
    // Funktion, um einen Slider mit Beschriftung zu erstellen
    const addSliderSetting = (
      container: HTMLElement,
      label: string,
      desc: string,
      min: number,
      max: number,
      step: number,
      getValue: () => number,
      setValue: (v: number) => void
    ) => {
      const setting = new Setting(container).setName(label).setDesc(desc);
      // Slider-Input
      const slider = setting.controlEl.createEl('input', { attr: { type: 'range' } }) as HTMLInputElement;
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.value = String(getValue());
      slider.style.marginRight = '8px';
      // Wert-Anzeige
      const valueEl = setting.controlEl.createEl('span', { text: ` ${getValue()}` });
      slider.oninput = () => {
        const newVal = Number(slider.value);
        setValue(newVal);
        valueEl.setText(` ${newVal}`);
        this.view.relayout();
        this.saveLayoutOptions();
      };
    };

    // ──────────── 5) Node Separation ────────────
    addSliderSetting(
      contentEl,
      'Node Separation',
      'Number of pixels between adjacent nodes horizontally',
      0,
      300,
      10,
      () => opts.nodeSep,
      (v) => (opts.nodeSep = v)
    );

    // ──────────── 6) Edge Separation ────────────
    addSliderSetting(
      contentEl,
      'Edge Separation',
      'Number of pixels between edges horizontally',
      0,
      200,
      5,
      () => opts.edgeSep,
      (v) => (opts.edgeSep = v)
    );

    // ──────────── 7) Rank Separation ────────────
    addSliderSetting(
      contentEl,
      'Rank Separation',
      'Number of pixels between ranks vertically',
      0,
      300,
      10,
      () => opts.rankSep,
      (v) => (opts.rankSep = v)
    );

    // ──────────── 8) Margin X ────────────
    addSliderSetting(
      contentEl,
      'Margin X',
      'Pixels of margin left/right of the graph',
      0,
      100,
      5,
      () => opts.marginx,
      (v) => (opts.marginx = v)
    );

    // ──────────── 9) Margin Y ────────────
    addSliderSetting(
      contentEl,
      'Margin Y',
      'Pixels of margin top/bottom of the graph',
      0,
      100,
      5,
      () => opts.marginy,
      (v) => (opts.marginy = v)
    );

    // ──────────── 10) Node Width ────────────
    addSliderSetting(
      contentEl,
      'Node Width',
      'Width of node in pixels (for custom styling)',
      0,
      300,
      5,
      () => opts.nodeWidth,
      (v) => (opts.nodeWidth = v)
    );

    // ──────────── 11) Node Height ────────────
    addSliderSetting(
      contentEl,
      'Node Height',
      'Height of node in pixels (for custom styling)',
      0,
      300,
      5,
      () => opts.nodeHeight,
      (v) => (opts.nodeHeight = v)
    );

    // ──────────── 12) Edge Min Length ────────────
    addSliderSetting(
      contentEl,
      'Edge Min Length',
      'Number of ranks to keep between source and target of an edge',
      1,
      10,
      1,
      () => opts.edgeMinLen,
      (v) => (opts.edgeMinLen = v)
    );

    // ──────────── 13) Edge Weight ────────────
    addSliderSetting(
      contentEl,
      'Edge Weight',
      'Weight of edges for layout (higher = straighter)',
      1,
      10,
      1,
      () => opts.edgeWeight,
      (v) => (opts.edgeWeight = v)
    );

    // ──────────── 14) Edge Width ────────────
    addSliderSetting(
      contentEl,
      'Edge Width',
      'Width of edge label in pixels',
      0,
      100,
      1,
      () => opts.edgeWidth,
      (v) => (opts.edgeWidth = v)
    );

    // ──────────── 15) Edge Height ────────────
    addSliderSetting(
      contentEl,
      'Edge Height',
      'Height of edge label in pixels',
      0,
      100,
      1,
      () => opts.edgeHeight,
      (v) => (opts.edgeHeight = v)
    );

    // ──────────── 16) Edge Label Position ────────────
    new Setting(contentEl)
      .setName('Edge Label Position')
      .setDesc('Where to place the label relative to the edge (l, c, r)')
      .addDropdown((dropdown: DropdownComponent) => {
        const choices: Record<string, string> = {
          l: 'Left',
          c: 'Center',
          r: 'Right',
        };
        Object.entries(choices).forEach(([key, label]) => {
          dropdown.addOption(key, label);
        });
        dropdown.setValue(opts.edgeLabelPos);
        dropdown.onChange((value) => {
          opts.edgeLabelPos = value as 'l' | 'c' | 'r';
          this.view.relayout();
          this.saveLayoutOptions();
        });
      });

    // ──────────── 17) Edge Label Offset ────────────
    addSliderSetting(
      contentEl,
      'Edge Label Offset',
      'Pixels to move label away from edge (when l or r)',
      0,
      100,
      2,
      () => opts.edgeLabelOffset,
      (v) => (opts.edgeLabelOffset = v)
    );

    // ───────────────────────────────────────────────────────────────────
    // Ganz unten: Close-Button
    // ───────────────────────────────────────────────────────────────────
    const closeBtn = contentEl.createEl('button', { text: 'Close' });
    Object.assign(closeBtn.style, {
      marginTop: '12px',
      padding: '6px 12px',
      borderRadius: '4px',
      border: 'none',
      backgroundColor: 'var(--interactive-accent)',
      color: 'var(--text-on-accent)',
      cursor: 'pointer',
      width: '100%',
      fontSize: 'var(--font-size-sm)',
    });
    closeBtn.addEventListener('click', () => this.close());
  }

  private async saveLayoutOptions(): Promise<void> {
    if (this.view.file && this.view.frontmatterStorage) {
      try {
        await this.view.frontmatterStorage.saveLayoutOptions(this.view.file, this.view.layoutOptions);
      } catch (error) {
        console.error('Failed to save layout options to frontmatter:', error);
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
