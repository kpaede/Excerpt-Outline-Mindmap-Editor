import { App, TFile } from 'obsidian';
import { NodeOptions } from './node-options-menu';
import { LayoutOptions } from './mindmapView';

export interface ExcerptOutlineMindmapData {
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
  acyciler?: 'greedy';
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
  spacingFactor?: number;
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
    const result: ExcerptOutlineMindmapData = {};
    
    if (!str || typeof str !== 'string') return result;
    
    const parts = str.split(';');
    
    parts.forEach(part => {
      const [key, value] = part.split(':');
      if (key && value !== undefined) {
        const trimmedKey = key.trim();
        const trimmedValue = value.trim();
        
        // Parse numbers
        if (trimmedKey === 'nodeWidth' || trimmedKey === 'nodeSep' || 
            trimmedKey === 'edgeSep' || trimmedKey === 'rankSep' || 
            trimmedKey === 'marginx' || trimmedKey === 'marginy' || 
            trimmedKey === 'spacingFactor') {
          const numValue = parseFloat(trimmedValue);
          if (!isNaN(numValue)) {
            (result as any)[trimmedKey] = numValue;
          }
        } else {
          // String values
          (result as any)[trimmedKey] = trimmedValue;
        }
      }
    });
    
    return result;
  }

  async saveMindmapData(file: TFile, data: ExcerptOutlineMindmapData): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        // Check if there's any data to save
        const hasData = Object.keys(data).some(key => data[key as keyof ExcerptOutlineMindmapData] !== undefined);
        
        if (hasData) {
          // Save as compact string
          frontmatter['excerpt-outline-mindmap'] = this.encodeToString(data);
        } else {
          delete frontmatter['excerpt-outline-mindmap'];
        }
      });
    } catch (error) {
      console.error('Failed to save mindmap data to frontmatter:', error);
    }
  }

  async loadMindmapData(file: TFile): Promise<ExcerptOutlineMindmapData> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    
    if (!frontmatter || !frontmatter['excerpt-outline-mindmap']) return {};
    
    const mindmapDataString = frontmatter['excerpt-outline-mindmap'];
    return this.parseFromString(mindmapDataString);
  }

  async updateNodeOptions(file: TFile, nodeOptions: NodeOptions): Promise<void> {
    const currentData = await this.loadMindmapData(file);
    currentData.nodeWidth = nodeOptions.nodeWidth;
    await this.saveMindmapData(file, currentData);
  }

  async updateLayoutOptions(file: TFile, layoutOptions: Partial<LayoutOptions>): Promise<void> {
    const currentData = await this.loadMindmapData(file);
    Object.keys(layoutOptions).forEach(key => {
      const value = layoutOptions[key as keyof LayoutOptions];
      if (value !== undefined) {
        (currentData as any)[key] = value;
      }
    });
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

  async updateCommandHistory(file: TFile, historyState: any): Promise<void> {
    // Command history is handled separately and doesn't need frontmatter storage
    // This method exists for compatibility but doesn't save to frontmatter
    // to avoid cluttering the frontmatter with large history data
  }
}
