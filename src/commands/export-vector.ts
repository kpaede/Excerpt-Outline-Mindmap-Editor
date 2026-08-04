import { Notice, Platform, normalizePath, requestUrl, type TFile } from 'obsidian';
import type MindmapPlugin from '../main';
import type { MindmapView } from '../view/mindmap-view';

type ExportFormat = 'svg' | 'pdf';

interface PreparedExportDom {
  width: number;
  height: number;
  background: string;
  snapshot: HTMLElement;
  printRoot: HTMLElement;
}

export async function exportMindmapViewToSvg(plugin: MindmapPlugin, view: MindmapView): Promise<void> {
  await exportMindmapView(plugin, view, 'svg');
}

export async function exportMindmapViewToPdf(plugin: MindmapPlugin, view: MindmapView): Promise<void> {
  await exportMindmapView(plugin, view, 'pdf');
}

async function exportMindmapView(plugin: MindmapPlugin, view: MindmapView, format: ExportFormat): Promise<void> {
  if (!view.file || !view.cy) {
    new Notice('Open a mindmap before exporting.');
    return;
  }

  try {
    if (format === 'svg') {
      const svg = await renderFitToViewSvg(view);
      const svgPath = await getAvailableExportPath(plugin, view.file, 'svg');
      await plugin.app.vault.create(svgPath, svg);
      new Notice(`Exported SVG: ${svgPath.split('/').pop()}`);
      return;
    }

    const pdfBytes = await renderFitToViewPdf(view);
    const pdfPath = await getAvailableExportPath(plugin, view.file, 'pdf');
    await plugin.app.vault.adapter.writeBinary(pdfPath, pdfBytes);
    new Notice(`Exported PDF: ${pdfPath.split('/').pop()}`);
  } catch (error) {
    console.error(`Failed to export mindmap as ${format.toUpperCase()}:`, error);
    new Notice(`Failed to export mindmap as ${format.toUpperCase()}.`);
  }
}

async function refreshOverlays(view: MindmapView): Promise<void> {
  view.updateOverlays();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function inlineComputedStyles(source: HTMLElement, target: HTMLElement): void {
  const properties = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'z-index',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'line-height',
    'letter-spacing',
    'color',
    'text-align',
    'text-decoration',
    'white-space',
    'word-break',
    'overflow-wrap',
    'overflow',
    'background-color',
    'background-image',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-radius',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'align-items',
    'justify-content',
    'flex-direction',
    'gap',
    'opacity',
    'transform',
    'transform-origin',
    'fill',
    'stroke',
    'stroke-width',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'box-sizing',
  ];
  const sourceElements = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
  const targetElements = [target, ...Array.from(target.querySelectorAll<HTMLElement>('*'))];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    if (!targetElement) return;

    const computed = getComputedStyle(sourceElement);
    properties.forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (value) {
        targetElement.setCssProps({ [property]: value });
      }
    });
  });
}

function serializeElementForForeignObject(element: HTMLElement): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(element)
    .replace(/&nbsp;/g, '&#160;')
    .replace(/\u00a0/g, '&#160;');
}

async function renderFitToViewPdf(view: MindmapView): Promise<ArrayBuffer> {
  if (!Platform.isDesktopApp) {
    throw new Error('PDF export requires the Obsidian desktop app.');
  }

  const requireFn = (window as unknown as { require?: (module: string) => unknown }).require;
  type ElectronWebContents = {
    printToPDF: (options: Record<string, unknown>) => Promise<Uint8Array>;
  };
  type ElectronWindow = {
    webContents: ElectronWebContents;
  };
  type ElectronRemote = {
    getCurrentWindow?: () => ElectronWindow;
  };
  const electron = requireFn?.('electron') as { remote?: ElectronRemote } | undefined;
  const remote = electron?.remote ?? (requireFn?.('@electron/remote') as ElectronRemote | undefined);
  const currentWindow = remote?.getCurrentWindow?.();

  if (!currentWindow) {
    throw new Error('Electron current window is not available for PDF export.');
  }

  return withPreparedExportDom(view, async (prepared) => {
    const svg = buildPreparedDomSvg(prepared);
    const pdfArtifact = createSvgPrintArtifact(svg, prepared.width, prepared.height);
    prepared.snapshot.setCssStyles({ display: 'none' });
    prepared.printRoot.appendChild(pdfArtifact);
    await waitForCurrentDocumentReady(pdfArtifact);
    const bytes = await currentWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      marginsType: 1,
    });
    pdfArtifact.remove();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  });
}

async function renderFitToViewSvg(view: MindmapView): Promise<string> {
  return withPreparedExportDom(view, async (prepared) => {
    await waitForCurrentDocumentReady(prepared.snapshot);
    return buildPreparedDomSvg(prepared);
  });
}

async function withPreparedExportDom<T>(
  view: MindmapView,
  callback: (prepared: PreparedExportDom) => Promise<T> | T
): Promise<T> {
  if (!view.cy) {
    throw new Error('Mindmap graph is not ready.');
  }

  const hasRenderableContent = view.wrapper.querySelector('.mindmap-heading-frame, .mindmap-overlay');
  if (!hasRenderableContent) {
    throw new Error('This mindmap has nothing to export.');
  }

  const previousZoom = view.cy.zoom();
  const previousPan = view.cy.pan();
  const originalParent = view.wrapper.parentElement;
  const placeholder = document.createComment('mindmap-export-placeholder');

  if (!originalParent) {
    throw new Error('Mindmap wrapper is not attached to the document.');
  }

  const originalRect = view.wrapper.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(originalRect.width));
  const height = Math.max(1, Math.ceil(originalRect.height));
  const background = getDocumentBackgroundColor();
  const printRoot = createDiv();
  printRoot.className = 'mindmap-vector-print-root';
  printRoot.setCssStyles({
    width: `${width}px`,
    height: `${height}px`,
    background: background,
    overflow: 'hidden',
    position: 'fixed',
    left: '-100000px',
    top: '0',
  });

  const previousWrapperStyle = {
    width: view.wrapper.style.width,
    height: view.wrapper.style.height,
    position: view.wrapper.style.position,
    left: view.wrapper.style.left,
    top: view.wrapper.style.top,
  };
  let printEdgeLayer: SVGSVGElement | null = null;
  let snapshot: HTMLElement | null = null;
  const exportStyle = createEl('style');
  exportStyle.textContent = `
    @page { size: ${(width / 96).toFixed(4)}in ${(height / 96).toFixed(4)}in; margin: 0; }
    body.mindmap-vector-printing .mindmap-vector-print-root .mindmap-canvas {
      visibility: hidden !important;
    }
    body.mindmap-vector-printing .mindmap-vector-print-edge-layer {
      display: block !important;
    }
    body.mindmap-vector-printing .mindmap-vector-print-root .vertical-toolbar,
    body.mindmap-vector-printing .mindmap-vector-print-root .node-controls,
    body.mindmap-vector-printing .mindmap-vector-print-root .mindmap-node-delete,
    body.mindmap-vector-printing .mindmap-vector-print-root .node-editor,
    body.mindmap-vector-printing .mindmap-vector-print-root .mindmap-heading-editor {
      display: none !important;
    }
    body.mindmap-vector-printing .mindmap-vector-print-root .mindmap-overlay.checkbox-checked {
      background: color-mix(in srgb, var(--mindmap-bg, #ffffff) 88%, #808080 12%) !important;
    }
    body.mindmap-vector-printing .mindmap-vector-source-wrapper {
      display: none !important;
    }
    body.mindmap-vector-printing .mindmap-vector-export-snapshot {
      display: block !important;
    }
    @media print {
      html, body {
        width: ${width}px !important;
        height: ${height}px !important;
        margin: 0 !important;
        overflow: hidden !important;
        background: ${background} !important;
      }
      body.mindmap-vector-printing > :not(.mindmap-vector-print-root) {
        display: none !important;
      }
      body.mindmap-vector-printing .mindmap-vector-print-root {
        display: block !important;
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: ${width}px !important;
        height: ${height}px !important;
        overflow: hidden !important;
        background: ${background} !important;
        z-index: 2147483647 !important;
      }
    }
  `;

  originalParent.insertBefore(placeholder, view.wrapper);
  document.body.appendChild(printRoot);
  printRoot.appendChild(view.wrapper);
  view.wrapper.setCssStyles({
    width: `${width}px`,
    height: `${height}px`,
    position: 'relative',
    left: '0',
    top: '0',
  });
  document.head.appendChild(exportStyle);
  document.body.classList.add('mindmap-vector-printing');

  try {
    view.cy?.resize();
    view.cy?.fit(view.cy.elements(), 50);
    view.cy?.center(view.cy.elements());
    await refreshOverlays(view);
    printEdgeLayer = createPrintEdgeLayer(view, width, height);
    view.wrapper.insertBefore(printEdgeLayer, view.wrapper.firstChild);
    snapshot = await createExportSnapshot(view.wrapper, width, height, background);
    printRoot.appendChild(snapshot);
    view.wrapper.classList.add('mindmap-vector-source-wrapper');
    return await callback({ width, height, background, snapshot, printRoot });
  } finally {
    document.body.classList.remove('mindmap-vector-printing');
    exportStyle.remove();
    view.wrapper.classList.remove('mindmap-vector-source-wrapper');
    snapshot?.remove();
    printEdgeLayer?.remove();
    view.wrapper.setCssStyles({
      width: previousWrapperStyle.width,
      height: previousWrapperStyle.height,
      position: previousWrapperStyle.position,
      left: previousWrapperStyle.left,
      top: previousWrapperStyle.top,
    });
    placeholder.parentNode?.insertBefore(view.wrapper, placeholder);
    placeholder.remove();
    printRoot.remove();
    view.cy.resize();
    view.cy.zoom(previousZoom);
    view.cy.pan(previousPan);
    await refreshOverlays(view);
  }
}

function buildPreparedDomSvg(prepared: PreparedExportDom): string {
  const wrapperClone = prepared.snapshot.cloneNode(true) as HTMLElement;
  sanitizeInvalidSvgTransforms(wrapperClone);
  wrapperClone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  const html = serializeElementForForeignObject(wrapperClone);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${prepared.width}" height="${prepared.height}" viewBox="0 0 ${prepared.width} ${prepared.height}">
  <rect width="100%" height="100%" fill="${escapeXml(prepared.background)}" />
  <foreignObject x="0" y="0" width="${prepared.width}" height="${prepared.height}">
${html}
  </foreignObject>
</svg>
`;
}

function createSvgPrintArtifact(svg: string, width: number, height: number): HTMLElement {
  const parser = new DOMParser();
  const svgDocument = parser.parseFromString(svg, 'image/svg+xml');
  const parserError = svgDocument.querySelector('parsererror');
  const svgElement = svgDocument.documentElement;

  if (parserError || svgElement.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Could not prepare SVG for PDF export.');
  }

  const container = createDiv();
  container.className = 'mindmap-vector-pdf-artifact';
  container.setCssStyles({
    display: 'block',
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'hidden',
    background: getDocumentBackgroundColor(),
  });

  const importedSvg = document.importNode(svgElement, true) as unknown as SVGSVGElement;
  importedSvg.setCssStyles({
    display: 'block',
    width: `${width}px`,
    height: `${height}px`,
  });
  container.appendChild(importedSvg);
  return container;
}

async function createExportSnapshot(source: HTMLElement, width: number, height: number, background: string): Promise<HTMLElement> {
  const snapshot = source.cloneNode(true) as HTMLElement;
  inlineComputedStyles(source, snapshot);
  sanitizeExportDomClone(snapshot);
  await inlineExportMedia(snapshot);
  snapshot.classList.add('mindmap-vector-export-snapshot');
  snapshot.classList.remove('mindmap-vector-source-wrapper');
  snapshot.setCssStyles({
    display: 'block',
    width: `${width}px`,
    height: `${height}px`,
    position: 'relative',
    left: '0',
    top: '0',
    overflow: 'hidden',
    background: background,
    margin: '0',
    boxSizing: 'border-box',
  });
  snapshot.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  return snapshot;
}

function sanitizeExportDomClone(root: HTMLElement): void {
  root.querySelectorAll(
    '.mindmap-canvas, .vertical-toolbar, .node-controls, .mindmap-node-delete, .node-editor, .mindmap-heading-editor'
  ).forEach((element) => element.remove());

  root.querySelectorAll<HTMLElement>('.hovering, .selected, .mm-src, .mm-tgt, .mm-tgt-child, .mm-tgt-first-child, .mm-tgt-last-child, .mm-tgt-sibling-before, .mm-tgt-sibling-after')
    .forEach((element) => {
      element.classList.remove(
        'hovering',
        'selected',
        'mm-src',
        'mm-tgt',
        'mm-tgt-child',
        'mm-tgt-first-child',
        'mm-tgt-last-child',
        'mm-tgt-sibling-before',
        'mm-tgt-sibling-after'
      );
    });

  root.querySelectorAll<HTMLElement>('.mindmap-overlay.checkbox-checked').forEach((element) => {
    element.classList.add('mindmap-export-checked');
    element.setCssProps({ '--mindmap-export-checked-bg': CHECKED_EXPORT_BACKGROUND });
    element.setCssStyles({
      borderColor: '#b8b8b8',
      color: CHECKED_EXPORT_COLOR,
      zIndex: '10',
    });

    element.querySelectorAll<HTMLElement>('.markdown-rendered, .markdown-rendered *').forEach((content) => {
      content.setCssStyles({
        color: CHECKED_EXPORT_COLOR,
        opacity: '1',
      });
    });

    element.querySelectorAll<HTMLElement>('.checkbox-toggle, .checkbox-toggle *').forEach((checkbox) => {
      checkbox.setCssStyles({
        color: CHECKED_EXPORT_COLOR,
        stroke: CHECKED_EXPORT_COLOR,
        opacity: '1',
      });
    });
  });

  root.querySelectorAll<HTMLElement>('[draggable]').forEach((element) => {
    element.removeAttribute('draggable');
  });

  root.querySelectorAll<HTMLElement>('button').forEach((button) => {
    button.setAttribute('disabled', 'true');
  });

  sanitizeInvalidSvgTransforms(root);
}

async function inlineExportMedia(root: HTMLElement): Promise<void> {
  const tasks: Promise<void>[] = [];

  root.querySelectorAll<HTMLImageElement>('img').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'src', element.currentSrc || element.src || element.getAttribute('src')));
  });

  root.querySelectorAll<HTMLVideoElement>('video').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'src', element.currentSrc || element.src || element.getAttribute('src')));
    tasks.push(inlineElementUrl(element, 'poster', element.poster || element.getAttribute('poster')));
  });

  root.querySelectorAll<HTMLAudioElement>('audio').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'src', element.currentSrc || element.src || element.getAttribute('src')));
  });

  root.querySelectorAll<HTMLSourceElement>('source').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'src', element.src || element.getAttribute('src')));
    tasks.push(inlineElementUrl(element, 'srcset', element.srcset || element.getAttribute('srcset')));
  });

  root.querySelectorAll<HTMLIFrameElement>('iframe').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'src', element.src || element.getAttribute('src')));
  });

  root.querySelectorAll<HTMLEmbedElement>('embed').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'src', element.src || element.getAttribute('src')));
  });

  root.querySelectorAll<HTMLObjectElement>('object').forEach((element) => {
    tasks.push(inlineElementUrl(element, 'data', element.data || element.getAttribute('data')));
  });

  await Promise.all(tasks);
}

async function inlineElementUrl(
  element: Element,
  attribute: string,
  rawUrl: string | null | undefined
): Promise<void> {
  const url = rawUrl?.trim();
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#')) return;

  if (attribute === 'srcset') {
    const firstSource = url.split(',')[0]?.trim().split(/\s+/)[0];
    if (!firstSource) return;
    const dataUrl = await fetchAsDataUrl(firstSource);
    if (dataUrl) {
      element.setAttribute(attribute, dataUrl);
    }
    return;
  }

  const dataUrl = await fetchAsDataUrl(url);
  if (!dataUrl) return;

  element.setAttribute(attribute, dataUrl);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await requestUrl({ url, throw: false });
    if (response.status < 200 || response.status >= 300) return null;

    const contentType = response.headers['content-type'] ?? 'application/octet-stream';
    return await blobToDataUrl(new Blob([response.arrayBuffer], { type: contentType }));
  } catch (error) {
    console.warn('Could not inline media for mindmap export:', url, error);
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read media blob.'));
    reader.readAsDataURL(blob);
  });
}

function sanitizeInvalidSvgTransforms(root: Element): void {
  [root, ...Array.from(root.querySelectorAll('*'))].forEach((element) => {
    if (element.getAttribute('transform') === 'none') {
      element.removeAttribute('transform');
    }
  });
}

function createPrintEdgeLayer(view: MindmapView, width: number, height: number): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('mindmap-vector-print-edge-layer');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setCssStyles({
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '1',
  });

  view.cy?.edges().forEach((edge) => {
    const source = edge.source().renderedPosition();
    const target = edge.target().renderedPosition();
    const line = document.createElementNS(namespace, 'line');
    line.setAttribute('x1', source.x.toFixed(2));
    line.setAttribute('y1', source.y.toFixed(2));
    line.setAttribute('x2', target.x.toFixed(2));
    line.setAttribute('y2', target.y.toFixed(2));
    line.setAttribute('stroke', '#000000');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(line);
  });

  addCheckedNodeEdgeCovers(view, svg, namespace);

  return svg;
}

function addCheckedNodeEdgeCovers(view: MindmapView, svg: SVGSVGElement, namespace: string): void {
  const wrapperRect = view.wrapper.getBoundingClientRect();

  view.wrapper.querySelectorAll<HTMLElement>('.mindmap-overlay.checkbox-checked').forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const cover = document.createElementNS(namespace, 'rect');
    cover.setAttribute('x', (rect.left - wrapperRect.left).toFixed(2));
    cover.setAttribute('y', (rect.top - wrapperRect.top).toFixed(2));
    cover.setAttribute('width', rect.width.toFixed(2));
    cover.setAttribute('height', rect.height.toFixed(2));
    cover.setAttribute('rx', '4');
    cover.setAttribute('ry', '4');
    cover.setAttribute('fill', CHECKED_EXPORT_BACKGROUND);
    cover.setAttribute('stroke', 'none');
    svg.appendChild(cover);
  });
}

const CHECKED_EXPORT_BACKGROUND = 'rgb(242, 242, 242)';
const CHECKED_EXPORT_COLOR = '#777777';

function getDocumentBackgroundColor(): string {
  return getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#ffffff';
}

async function waitForCurrentDocumentReady(root: HTMLElement): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  try {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    const fontsReady = fonts?.ready;
    if (fontsReady !== undefined) {
      await fontsReady;
    }
  } catch {
    // Continue; font readiness should not block export forever.
  }

  await Promise.all(Array.from(root.querySelectorAll('img')).map((img) => {
    if (img.complete) return Promise.resolve();

    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      window.setTimeout(resolve, 2000);
    });
  }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getAvailableExportPath(plugin: MindmapPlugin, sourceFile: TFile, extension: ExportFormat): Promise<string> {
  const withoutExtension = sourceFile.path.replace(/\.md$/i, '');
  let candidate = normalizePath(`${withoutExtension}.${extension}`);
  let counter = 1;

  while (await plugin.app.vault.adapter.exists(candidate)) {
    candidate = normalizePath(`${withoutExtension} ${counter}.${extension}`);
    counter++;
  }

  return candidate;
}
