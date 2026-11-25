import { describe, expect, it, vi } from 'vitest';
import { FrontmatterStorage } from '../src/storage/frontmatter-storage';
import { document, mockVault, thought } from './multiline-fixtures';

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('./obsidian-mock')>(),
  // Obsidian owns YAML parsing. These cases exercise the plugin's semicolon
  // settings format inside a plain YAML scalar, plus document preservation.
  parseYaml: (source: string) => ({
    'excerpt-outline-mindmap': source.match(/^excerpt-outline-mindmap: *(.*)$/m)?.[1],
  }),
}));

describe('per-file connection line settings', () => {
  it('persists and reloads either style without changing content or other settings', async () => {
    const original = document([thought('Thought\n\n# Content heading', [thought('Child')])]);
    const vault = mockVault(original);
    const storage = new FrontmatterStorage(vault.app);
    await storage.updateLayoutOptions(vault.file, { rankDir: 'RL', zoomFactor: 0.75 });
    const before = vault.getText();
    for (const edgeStyle of ['orthogonal', 'straight'] as const) {
      await storage.updateLayoutOptions(vault.file, { edgeStyle });
      expect(await new FrontmatterStorage(vault.app).loadMindmapData(vault.file)).toEqual({
        rankDir: 'RL', zoomFactor: 0.75, edgeStyle,
      });
      expect(vault.getText().replace(`;edgeStyle:${edgeStyle}`, '')).toBe(before);
    }
    const other = mockVault(original);
    expect(await new FrontmatterStorage(other.app).loadMindmapData(other.file)).toEqual({});
  });

  it('resets the line choice with layout settings, retaining node width and saved zoom', async () => {
    const vault = mockVault(document([thought('Thought')]));
    Object.assign(vault.app, { metadataCache: { getFileCache: () => ({ frontmatter: { 'excerpt-outline-mindmap': '' } }) } });
    const storage = new FrontmatterStorage(vault.app);
    await storage.updateLayoutOptions(vault.file, { edgeStyle: 'orthogonal', rankDir: 'LR', zoomFactor: 0.75 });
    await storage.saveNodeWidth(vault.file, 350);
    await storage.resetLayoutOptions(vault.file);
    expect(await storage.loadMindmapData(vault.file)).toEqual({ zoomFactor: 0.75, nodeWidth: 350 });
    expect(vault.getText()).not.toContain('edgeStyle');
    expect(vault.getText()).toContain('custom: keep me');
  });

  it('validates unknown styles and reads embed settings from the same source snapshot', async () => {
    const vault = mockVault('- Disk content');
    const read = vi.spyOn(vault.app.vault, 'read');
    const storage = new FrontmatterStorage(vault.app);
    for (const [value, expected] of [['unknown', 'straight'], ['orthogonal', 'orthogonal']]) {
      expect(await storage.loadMindmapData(vault.file, `---\nexcerpt-outline-mindmap: edgeStyle:${value}\n---\n- Snapshot`))
        .toEqual({ edgeStyle: expected });
    }
    expect(read).not.toHaveBeenCalled();
  });
});
