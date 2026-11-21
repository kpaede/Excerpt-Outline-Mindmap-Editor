import { App, TFile, parseYaml } from 'obsidian';
import { commitDocument, readDocument } from './document-writer';
import { frontmatterEnd } from '../domain/outline-format';
import { NodeOptions } from '../ui/menus/node-options-menu';
import { LayoutOptions } from '../domain/layout-options';
import { GeneralSettings } from '../ui/menus/general-settings-menu';
import type { HeadingTreeLayout } from '../domain/layout-options';

export interface ExcerptOutlineMindmapData {
  // General options
  keyboardNavigation?: 'hierarchical' | 'spatial';
  showCheckboxesOnHover?: boolean;
  inheritParentListTypeForChildren?: boolean;
  nodeEditingMode?: GeneralSettings['nodeEditingMode'];

  // Node options
  nodeWidth?: number;
  
  // Layout options
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
  headingTreeLayout?: HeadingTreeLayout;
}

export class FrontmatterStorage {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private encodeToString(data: ExcerptOutlineMindmapData): string {
    const parts: string[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        parts.push(`${key}:${value}`);
      }
    });

    return parts.join(';');
  }

  private parseFromString(str: string): ExcerptOutlineMindmapData {
    const result: Partial<ExcerptOutlineMindmapData> = {};
    
    if (!str || typeof str !== 'string') return result;
    const typedResult = result as Record<string, unknown>;
    const parts = str.split(';');
    parts.forEach(part => {
      const [key, value] = part.split(':');
      if (!key || value === undefined) return;

      const trimmedKey = key.trim();
      let trimmedValue = value.trim();
      const normalizedKey = trimmedKey === 'acyciler' ? 'acyclicer' : trimmedKey;

      if (
        trimmedKey === 'nodeWidth' ||
        trimmedKey === 'nodeSep' ||
        trimmedKey === 'edgeSep' ||
        trimmedKey === 'rankSep' ||
        trimmedKey === 'marginx' ||
        trimmedKey === 'marginy' ||
        trimmedKey === 'spacingFactor' ||
        trimmedKey === 'zoomFactor'
      ) {
        const numValue = parseFloat(trimmedValue);
        if (!isNaN(numValue)) {
          typedResult[trimmedKey] = numValue;
        }
      } else {
        if (normalizedKey === 'align') {
          if (trimmedValue === 'DL') trimmedValue = 'UL';
          if (trimmedValue === 'DR') trimmedValue = 'UR';
        }
        if (trimmedValue === 'true' || trimmedValue === 'false') {
          typedResult[normalizedKey] = trimmedValue === 'true';
        } else {
          typedResult[normalizedKey] = trimmedValue;
        }
      }
    });

    return result;
  }

  private async saveMindmapData(
    file: TFile,
    data: ExcerptOutlineMindmapData,
    preserveEmptyMarker: boolean = false
  ): Promise<void> {
    const before = await readDocument(this.app, file);
    const newline = before.includes('\r\n') ? '\r\n' : '\n';
    const lines = before.split(/\r?\n/);
    const end = frontmatterEnd(lines);
    const hasData = Object.values(data).some(value => value !== undefined);
    const property = hasData ? `excerpt-outline-mindmap: ${this.encodeToString(data)}` : 'excerpt-outline-mindmap:';
    if (end) {
      const matches = lines.map((line, i) => i > 0 && i < end - 1 && /^(?:excerpt-outline-mindmap|"excerpt-outline-mindmap"|'excerpt-outline-mindmap')\s*:/.test(line) ? i : -1).filter(i => i >= 0);
      if (matches.length > 1) throw new Error('Duplicate mindmap settings property. Review frontmatter in Markdown first.');
      const index = matches[0] ?? -1;
      if (index >= 0) {
        let propertyEnd = index + 1;
        while (propertyEnd < end - 1 && /^[ \t]+\S/.test(lines[propertyEnd])) propertyEnd++;
        lines.splice(index, propertyEnd - index, ...(hasData || preserveEmptyMarker ? [property] : []));
      }
      else if (hasData || preserveEmptyMarker) lines.splice(end - 1, 0, property);
    } else if (hasData || preserveEmptyMarker) lines.unshift('---', property, '---');
    const after = lines.join(newline);
    if (after !== before) await commitDocument(this.app, file, before, after);
  }

  async loadMindmapData(file: TFile): Promise<ExcerptOutlineMindmapData> {
    // The metadata cache may still describe the preceding write. Read the
    // committed settings so consecutive changes cannot erase one another.
    const lines = (await this.app.vault.read(file)).split(/\r?\n/);
    const end = frontmatterEnd(lines);
    const frontmatter = end ? parseYaml(lines.slice(1, end - 1).join('\n')) as Record<string, unknown> | null : null;

    if (!frontmatter || !frontmatter['excerpt-outline-mindmap']) return {};

    const mindmapData: unknown = frontmatter['excerpt-outline-mindmap'];
    return this.parseFromString(typeof mindmapData === 'string' ? mindmapData : '');
  }

  async updateNodeOptions(file: TFile, nodeOptions: NodeOptions): Promise<void> {
    const currentData = await this.loadMindmapData(file);
    currentData.nodeWidth = nodeOptions.nodeWidth;
    await this.saveMindmapData(file, currentData);
  }

  async updateLayoutOptions(file: TFile, layoutOptions: Partial<LayoutOptions>): Promise<void> {
    const currentData: Partial<ExcerptOutlineMindmapData> = await this.loadMindmapData(file);
    const typedData = currentData as Record<string, unknown>;

    Object.keys(layoutOptions).forEach((key) => {
      const value = layoutOptions[key as keyof LayoutOptions];
      if (value !== undefined) {
        typedData[key] = value;
      }
    });

    await this.saveMindmapData(file, currentData);
  }

  async resetLayoutOptions(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const hadMindmapMarker = !!cache?.frontmatter &&
      Object.prototype.hasOwnProperty.call(cache.frontmatter, 'excerpt-outline-mindmap');
    const currentData = await this.loadMindmapData(file);

    delete currentData.rankDir;
    delete currentData.align;
    delete currentData.nodeSep;
    delete currentData.edgeSep;
    delete currentData.rankSep;
    delete currentData.marginx;
    delete currentData.marginy;
    delete currentData.acyclicer;
    delete currentData.ranker;
    delete currentData.spacingFactor;
    delete currentData.headingTreeLayout;

    await this.saveMindmapData(file, currentData, hadMindmapMarker);
  }

  async updateGeneralSettings(file: TFile, generalSettings: GeneralSettings): Promise<void> {
    const currentData = await this.loadMindmapData(file);

    if (generalSettings.nodeEditingMode === 'single-line' || generalSettings.nodeEditingMode === 'multiline') {
      currentData.nodeEditingMode = generalSettings.nodeEditingMode;
    }

    if (generalSettings.keyboardNavigation) {
      currentData.keyboardNavigation = generalSettings.keyboardNavigation;
    }

    if (typeof generalSettings.showCheckboxesOnHover === 'boolean') {
      currentData.showCheckboxesOnHover = generalSettings.showCheckboxesOnHover;
    }

    if (typeof generalSettings.inheritParentListTypeForChildren === 'boolean') {
      currentData.inheritParentListTypeForChildren = generalSettings.inheritParentListTypeForChildren;
    }

    await this.saveMindmapData(file, currentData);
  }

  async saveNodeWidth(file: TFile, nodeWidth: number): Promise<void> {
    const currentData = await this.loadMindmapData(file);
    currentData.nodeWidth = nodeWidth;
    await this.saveMindmapData(file, currentData);
  }

  async saveLayoutOptions(file: TFile, layoutOptions: Partial<LayoutOptions>): Promise<void> {
    await this.updateLayoutOptions(file, layoutOptions);
  }

}
