import { App, TFile, normalizePath } from 'obsidian';
import { extractEmbedLink } from './drawing-link';

export const EXCALIDRAW_PLUGIN_ID = 'obsidian-excalidraw-plugin';

interface ExcalidrawSettings {
  folder?: string;
  compatibilityMode?: boolean;
  useExcalidrawExtension?: boolean;
}

interface ExcalidrawAutomate {
  create(params: {
    filename?: string;
    foldername?: string;
    templatePath?: string;
    onNewPane?: boolean;
    silent?: boolean;
  }): Promise<string>;
}

interface ExcalidrawAutomateFactory extends Partial<ExcalidrawAutomate> {
  getAPI?: (view?: unknown) => ExcalidrawAutomate;
}

interface ExcalidrawPlugin {
  settings?: ExcalidrawSettings;
  ea?: Partial<ExcalidrawAutomate>;
  isExcalidrawFile(file: TFile): boolean;
}

interface AppWithPlugins {
  plugins?: { plugins?: Record<string, unknown> };
}

/**
 * Resolves the Excalidraw plugin, or null when it is not installed or not
 * enabled.
 *
 * Excalidraw is an optional third-party dependency with no published typings
 * for its plugin instance, so every entry point used here is checked for
 * before it is called rather than trusted from a version number. A user who
 * disables Excalidraw mid-session simply stops seeing the menu entries.
 */
export function getExcalidrawPlugin(app: App): ExcalidrawPlugin | null {
  const registry = (app as (App & AppWithPlugins) | undefined)?.plugins?.plugins;
  const candidate = registry?.[EXCALIDRAW_PLUGIN_ID] as Partial<ExcalidrawPlugin> | undefined;
  if (!candidate || typeof candidate.isExcalidrawFile !== 'function') return null;
  return candidate as ExcalidrawPlugin;
}

export function isExcalidrawAvailable(app: App): boolean {
  return getExcalidrawPlugin(app) !== null;
}

/**
 * Prefers a fresh ExcalidrawAutomate instance over the shared one.
 *
 * `create` serialises whatever elements are currently held by the instance it
 * is called on, and the shared `ea` object is written to by any other plugin
 * or user script in the vault. A per-call instance guarantees the new drawing
 * starts empty.
 */
function getAutomate(plugin: ExcalidrawPlugin): ExcalidrawAutomate | null {
  const global = (window as { ExcalidrawAutomate?: ExcalidrawAutomateFactory }).ExcalidrawAutomate;
  if (global && typeof global.getAPI === 'function') {
    const instance = global.getAPI();
    if (instance && typeof instance.create === 'function') return instance;
  }
  if (plugin.ea && typeof plugin.ea.create === 'function') return plugin.ea as ExcalidrawAutomate;
  if (global && typeof global.create === 'function') return global as ExcalidrawAutomate;
  return null;
}

/**
 * Applies Excalidraw's own extension rules, which decide whether a drawing is
 * a Markdown file, a Markdown file carrying the `.excalidraw` marker, or a
 * legacy standalone `.excalidraw` document.
 */
function excalidrawFileName(plugin: ExcalidrawPlugin, baseName: string): string {
  const settings = plugin.settings ?? {};
  if (settings.compatibilityMode) return `${baseName}.excalidraw`;
  if (settings.useExcalidrawExtension === false) return `${baseName}.md`;
  return `${baseName}.excalidraw.md`;
}

export async function createExcalidrawDrawing(app: App, baseName: string): Promise<TFile> {
  const plugin = getExcalidrawPlugin(app);
  if (!plugin) throw new Error('The Excalidraw plugin is not available.');
  const automate = getAutomate(plugin);
  if (!automate) throw new Error('The Excalidraw plugin exposes no usable ExcalidrawAutomate API.');

  // Silent creation keeps the file out of the workspace until the embed has
  // been written, so a failed insert cannot leave the user staring at an
  // orphaned drawing tab.
  const createdPath = await automate.create({
    filename: excalidrawFileName(plugin, baseName),
    foldername: plugin.settings?.folder,
    silent: true,
  });

  const created = app.vault.getAbstractFileByPath(normalizePath(createdPath));
  if (!(created instanceof TFile)) {
    throw new Error(`Excalidraw reported the new drawing as ${createdPath}, but no such file exists.`);
  }
  return created;
}

export async function openExcalidrawFile(app: App, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

export function isExcalidrawFile(app: App, file: TFile): boolean {
  return getExcalidrawPlugin(app)?.isExcalidrawFile(file) ?? false;
}

/**
 * Resolves the Excalidraw drawing a node embeds, if any.
 *
 * The link text alone is not a reliable marker: with Excalidraw's
 * `useExcalidrawExtension` disabled a drawing is an ordinary `.md` file, so
 * the link has to be resolved and the plugin asked.
 */
export function resolveExcalidrawEmbed(app: App, markdown: string, sourcePath: string): TFile | null {
  const plugin = getExcalidrawPlugin(app);
  if (!plugin) return null;
  const link = extractEmbedLink(markdown);
  if (!link) return null;
  const target = app.metadataCache.getFirstLinkpathDest(link.split('#')[0], sourcePath);
  if (!(target instanceof TFile) || !plugin.isExcalidrawFile(target)) return null;
  return target;
}

/**
 * Reports whether a rendered container still holds an Excalidraw embed that
 * has not been turned into an image yet.
 *
 * Excalidraw's Markdown post-processor runs through a global task queue and
 * *replaces* the `.internal-embed` placeholder with its own image container.
 * A surviving placeholder therefore means the drawing has not been rendered
 * yet, and measuring now would size the node to the embed's one-line
 * fallback text instead of the drawing.
 *
 * Embeds carrying a fragment (`#^blockref`, `#heading`) are ignored: some of
 * those are deliberately rendered as text by Excalidraw and would never be
 * replaced, which would turn every measurement into a timeout.
 */
export function hasUnrenderedExcalidrawEmbed(
  app: App,
  container: HTMLElement,
  sourcePath: string
): boolean {
  const plugin = getExcalidrawPlugin(app);
  if (!plugin) return false;

  return Array.from(container.querySelectorAll('.internal-embed')).some((embed) => {
    const src = embed.getAttribute('src');
    if (!src || src.includes('#')) return false;
    const target = app.metadataCache.getFirstLinkpathDest(src, sourcePath);
    return target instanceof TFile && plugin.isExcalidrawFile(target);
  });
}
