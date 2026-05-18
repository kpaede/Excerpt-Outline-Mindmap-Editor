import { App, TFile } from 'obsidian';
import { NodeOptions } from './node-options-menu';
import { LayoutOptions } from './mindmapView';
import { GeneralSettings } from './general-settings-menu';

export interface ExcerptOutlineMindmapData {
  // General options
  keyboardNavigation?: 'hierarchical' | 'spatial';

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
    
    if (!str || typeof str !== 'string') return result as ExcerptOutlineMindmapData;
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
        typedResult[normalizedKey] = trimmedValue;
      }
    });

    return result;
  }

  private async saveMindmapData(
    file: TFile,
    data: ExcerptOutlineMindmapData,
    preserveEmptyMarker: boolean = false
  ): Promise<void> {
    const fileManager = this.app.fileManager as {
      processFrontMatter?: (file: TFile, processor: (frontmatter: Record<string, unknown>) => void) => Promise<void>;
    } | null;

    const hasData = Object.values(data).some((value) => value !== undefined);

    try {
      if (fileManager?.processFrontMatter) {
        await fileManager.processFrontMatter(file, (frontmatter) => {
          if (hasData) {
            frontmatter['excerpt-outline-mindmap'] = this.encodeToString(data);
          } else if (preserveEmptyMarker) {
            frontmatter['excerpt-outline-mindmap'] = '';
          } else {
            delete frontmatter['excerpt-outline-mindmap'];
          }
        });
      } else {
        const contents = await this.app.vault.read(file);
        const fmMatch = contents.match(/^---\n([\s\S]*?)\n---\n?/);

        if (fmMatch) {
          let fmText = fmMatch[1];

          if (hasData) {
            if (/^excerpt-outline-mindmap:/m.test(fmText)) {
              fmText = fmText.replace(/^excerpt-outline-mindmap:.*(?:\n|$)/m, `excerpt-outline-mindmap: ${this.encodeToString(data)}\n`);
            } else {
              fmText = `${fmText}\nexcerpt-outline-mindmap: ${this.encodeToString(data)}\n`;
            }
          } else if (preserveEmptyMarker) {
            if (/^excerpt-outline-mindmap:/m.test(fmText)) {
              fmText = fmText.replace(/^excerpt-outline-mindmap:.*(?:\n|$)/m, 'excerpt-outline-mindmap:\n');
            } else {
              fmText = `${fmText}\nexcerpt-outline-mindmap:\n`;
            }
          } else {
            fmText = fmText.replace(/^excerpt-outline-mindmap:.*(?:\n|$)/m, '');
          }

          const newContents = contents.replace(fmMatch[0], `---\n${fmText}---\n`);
          await this.app.vault.modify(file, newContents);
        } else if (hasData || preserveEmptyMarker) {
          const value = hasData ? ` ${this.encodeToString(data)}` : '';
          const fm = `---\nexcerpt-outline-mindmap:${value}\n---\n\n`;
          await this.app.vault.modify(file, fm + contents);
        }
      }
    } catch (error) {
      console.error('Failed to save mindmap data to frontmatter:', error);
    }
  }

  async loadMindmapData(file: TFile): Promise<ExcerptOutlineMindmapData> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter || !frontmatter['excerpt-outline-mindmap']) return {};

    const mindmapDataString = frontmatter['excerpt-outline-mindmap'];
    return this.parseFromString(String(mindmapDataString));
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

    await this.saveMindmapData(file, currentData as ExcerptOutlineMindmapData);
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

    await this.saveMindmapData(file, currentData, hadMindmapMarker);
  }

  async updateGeneralSettings(file: TFile, generalSettings: GeneralSettings): Promise<void> {
    const currentData = await this.loadMindmapData(file);

    if (generalSettings.keyboardNavigation) {
      currentData.keyboardNavigation = generalSettings.keyboardNavigation;
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
