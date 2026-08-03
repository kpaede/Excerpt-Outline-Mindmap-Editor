import type { Plugin } from 'obsidian';
import { PEN_DEFAULT_SIZE, PEN_SIZE_RANGE } from './pen-stroke-options';

export interface PenPreferences {
  size: number;
  color: string;
}

export const DEFAULT_PEN_PREFERENCES: PenPreferences = {
  size: PEN_DEFAULT_SIZE,
  color: '#000000',
};

/** Key under which these live inside the plugin's single data.json object. */
const DATA_KEY = 'pen';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function readSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PEN_PREFERENCES.size;
  return Math.min(PEN_SIZE_RANGE.max, Math.max(PEN_SIZE_RANGE.min, Math.round(value)));
}

function readColor(value: unknown): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : DEFAULT_PEN_PREFERENCES.color;
}

/**
 * Persists the pen's size and colour across sessions in the plugin's own
 * data.json, rather than in a mindmap's frontmatter: they are preferences for
 * the drawing tool itself, not properties of any one mindmap.
 *
 * Both values are validated on read - the colour ends up in generated SVG
 * markup, and the size in geometry maths, so neither may be taken on trust
 * from a hand-edited or older data file.
 */
export class PenPreferenceStore {
  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<PenPreferences> {
    const data = (await this.plugin.loadData()) as Record<string, unknown> | null;
    const stored = data?.[DATA_KEY] as Record<string, unknown> | undefined;
    return {
      size: readSize(stored?.size),
      color: readColor(stored?.color),
    };
  }

  /**
   * Re-reads before writing so this only ever replaces its own key, leaving
   * any other plugin data intact.
   */
  async save(preferences: PenPreferences): Promise<void> {
    const data = ((await this.plugin.loadData()) as Record<string, unknown> | null) ?? {};
    data[DATA_KEY] = {
      size: readSize(preferences.size),
      color: readColor(preferences.color),
    };
    await this.plugin.saveData(data);
  }
}
