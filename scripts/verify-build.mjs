import { readFile, stat } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const bundlePath = new URL('../main.js', import.meta.url);
const manifestPath = new URL('../manifest.json', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);

const [bundle, manifestText, packageText, bundleStat] = await Promise.all([
  readFile(bundlePath, 'utf8'),
  readFile(manifestPath, 'utf8'),
  readFile(packagePath, 'utf8'),
  stat(bundlePath),
]);

const manifest = JSON.parse(manifestText);
const packageJson = JSON.parse(packageText);

if (packageJson.main !== 'main.js') {
  throw new Error(`package.json must point to main.js, got ${String(packageJson.main)}.`);
}
if (!manifest.id || manifest.isDesktopOnly !== false) {
  throw new Error('manifest.json must identify a mobile-compatible Obsidian plugin.');
}
if (bundleStat.size === 0 || bundle.trim().length === 0) {
  throw new Error('main.js is empty.');
}
if (/sourceMappingURL\s*=\s*data:/u.test(bundle)) {
  throw new Error('main.js contains an inline source map; do not ship or sync that payload.');
}
if (!bundle.includes('module.exports')) {
  throw new Error('main.js does not expose an Obsidian CommonJS entry point.');
}

// Parse the complete artifact, catching truncated or only partially written
// bundles before they are handed to Obsidian or synchronized to another device.
new vm.Script(bundle, { filename: 'main.js' });

const allowedRuntimeImports = new Set([
  'obsidian',
  '@codemirror/state',
  '@codemirror/view',
]);
const runtimeImports = new Set(
  Array.from(bundle.matchAll(/(?<![\w$.])require\(\s*['"]([^'"]+)['"]\s*\)/gu), (match) => match[1])
);
const unexpectedImports = Array.from(runtimeImports).filter((name) => !allowedRuntimeImports.has(name));
if (unexpectedImports.length > 0) {
  throw new Error(`main.js contains unexpected runtime imports: ${unexpectedImports.join(', ')}`);
}

await verifyTopLevelLoadAndOnload();

console.log(`Verified mobile-compatible Obsidian bundle (${bundleStat.size} bytes).`);

async function verifyTopLevelLoadAndOnload() {
  for (const browserGlobal of ['document', 'window', 'HTMLElement', 'customElements']) {
    if (typeof globalThis[browserGlobal] !== 'undefined') {
      throw new Error(`Startup smoke must run without the DOM global ${browserGlobal}.`);
    }
  }

  const workspace = {
    activeLeaf: null,
    getLeavesOfType: () => [],
    on: () => ({}),
  };
  const app = {
    workspace,
    vault: { on: () => ({}) },
  };

  class PluginStub {
    constructor() {
      this.app = app;
    }

    registerView() {}
    registerMarkdownCodeBlockProcessor() {}
    addCommand() {}
    registerEvent() {}
    register() {}
  }

  class TextFileViewStub {}
  class ModalStub {}

  const obsidianStub = Object.freeze({
    Plugin: PluginStub,
    TextFileView: TextFileViewStub,
    Modal: ModalStub,
    Platform: Object.freeze({ isDesktopApp: false, isMobileApp: true, isMacOS: false }),
    normalizePath: (value) => value,
    setIcon: () => {},
  });
  const codeMirrorStub = Object.freeze({});

  const require = createRequire(import.meta.url);
  const resolvedBundlePath = fileURLToPath(bundlePath);
  const originalLoad = Module._load;

  try {
    Module._load = function loadWithObsidianStubs(request, parent, isMain) {
      if (request === 'obsidian') return obsidianStub;
      if (request === '@codemirror/state' || request === '@codemirror/view') return codeMirrorStub;
      return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[resolvedBundlePath];
    const loadedBundle = require(resolvedBundlePath);
    const PluginEntry = loadedBundle?.default;
    if (typeof PluginEntry !== 'function') {
      throw new Error('main.js does not export a default Obsidian plugin class.');
    }

    const plugin = new PluginEntry();
    if (typeof plugin.onload !== 'function') {
      throw new Error('The default plugin export has no onload method.');
    }
    await plugin.onload();

    if (Object.prototype.hasOwnProperty.call(globalThis, '__eomeSimpleWhiteboardModule_v1__')) {
      throw new Error('The whiteboard runtime was initialized eagerly during plugin startup.');
    }
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolvedBundlePath];
  }
}
