import { Notice, Platform, normalizePath, type TFile } from 'obsidian';
import type MindmapPlugin from '../main';
import type { MindmapView } from '../view/mindmap-view';

interface ExportBox {
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
  kind: 'heading' | 'node';
  bleed: ExportBoxBleed;
}

interface ExportEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ExportBoxBleed {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ExportScene {
  width: number;
  height: number;
  boxes: ExportBox[];
  edges: ExportEdge[];
  css: string;
  background: string;
}

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
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function createFitToViewExportScene(view: MindmapView): Promise<ExportScene> {
  return withFitToView(view, async () => createExportScene(view));
}

async function withFitToView<T>(view: MindmapView, callback: () => Promise<T> | T): Promise<T> {
  if (!view.cy) {
    throw new Error('Mindmap graph is not ready.');
  }

  const previousZoom = view.cy.zoom();
  const previousPan = view.cy.pan();

  try {
    view.cy.fit(view.cy.elements(), 50);
    view.cy.center(view.cy.elements());
    await refreshOverlays(view);
    return await callback();
  } finally {
    view.cy.zoom(previousZoom);
    view.cy.pan(previousPan);
    await refreshOverlays(view);
  }
}

function createExportScene(view: MindmapView): ExportScene {
  const wrapperRect = view.wrapper.getBoundingClientRect();
  const rawBoxes: ExportBox[] = [];

  view.wrapper
    .querySelectorAll<HTMLElement>('.mindmap-heading-frame, .mindmap-overlay')
    .forEach((element) => {
      if (element.closest('.node-editor, .mindmap-heading-editor')) return;

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const kind = element.classList.contains('mindmap-heading-frame') ? 'heading' : 'node';

      rawBoxes.push({
        x: rect.left - wrapperRect.left,
        y: rect.top - wrapperRect.top,
        w: rect.width,
        h: rect.height,
        html: cleanExportElement(element, rect),
        kind,
        bleed: getExportBoxBleed(element, kind),
      });
    });

  const rawEdges: ExportEdge[] = [];
  view.cy?.edges().forEach((edge) => {
    const source = edge.source().renderedPosition();
    const target = edge.target().renderedPosition();
    rawEdges.push({
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
    });
  });

  const padding = 32;
  const boxPoints = rawBoxes.reduce<Array<{ x: number; y: number }>>((points, box) => {
    points.push(
      { x: box.x - box.bleed.left, y: box.y - box.bleed.top },
      { x: box.x + box.w + box.bleed.right, y: box.y + box.h + box.bleed.bottom }
    );
    return points;
  }, []);
  const edgePoints = rawEdges.reduce<Array<{ x: number; y: number }>>((points, edge) => {
    points.push(
      { x: edge.x1, y: edge.y1 },
      { x: edge.x2, y: edge.y2 }
    );
    return points;
  }, []);
  const bounds = [...boxPoints, ...edgePoints].reduce((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxX: Math.max(acc.maxX, point.x),
    maxY: Math.max(acc.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });

  const offsetX = bounds.minX - padding;
  const offsetY = bounds.minY - padding;

  return {
    width: Math.ceil(bounds.maxX - bounds.minX + padding * 2),
    height: Math.ceil(bounds.maxY - bounds.minY + padding * 2),
    boxes: rawBoxes.map((box) => ({
      ...box,
      x: box.x - offsetX,
      y: box.y - offsetY,
    })),
    edges: rawEdges.map((edge) => ({
      x1: edge.x1 - offsetX,
      y1: edge.y1 - offsetY,
      x2: edge.x2 - offsetX,
      y2: edge.y2 - offsetY,
    })),
    css: collectDocumentCss(),
    background: getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#ffffff',
  };
}

function getExportBoxBleed(element: HTMLElement, kind: ExportBox['kind']): ExportBoxBleed {
  if (kind === 'heading') {
    return { top: 28, right: 10, bottom: 2, left: 10 };
  }

  const hasProtrudingCheckbox = element.classList.contains('has-checkbox') || element.classList.contains('checkbox-hoverable');
  return hasProtrudingCheckbox
    ? { top: 14, right: 4, bottom: 4, left: 14 }
    : { top: 2, right: 2, bottom: 2, left: 2 };
}

function cleanExportElement(element: HTMLElement, rect: DOMRect): string {
  const clone = element.cloneNode(true) as HTMLElement;
  inlineComputedStyles(element, clone);
  const computed = getComputedStyle(element);
  const localWidth = parseFloat(computed.width) || rect.width;
  const localHeight = parseFloat(computed.height) || rect.height;
  const scale = rect.width > 0 && localWidth > 0 ? rect.width / localWidth : 1;

  clone.querySelectorAll(
    '.node-controls, .mindmap-node-delete, .node-editor, .mindmap-heading-editor'
  ).forEach((child) => child.remove());

  clone.classList.remove('hovering', 'selected', 'mm-src', 'mm-tgt', 'mm-tgt-child', 'mm-tgt-first-child', 'mm-tgt-last-child', 'mm-tgt-sibling-before', 'mm-tgt-sibling-after');
  clone.removeAttribute('draggable');
  clone.style.position = 'relative';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.setProperty('transform', `scale(${scale})`, 'important');
  clone.style.setProperty('transform-origin', 'top left', 'important');
  clone.style.width = `${localWidth}px`;
  clone.style.height = `${localHeight}px`;
  clone.style.margin = '0';
  clone.style.boxSizing = 'border-box';
  if (clone.classList.contains('checkbox-checked')) {
    clone.style.backgroundColor = flattenColor(computed.backgroundColor, getDocumentBackgroundColor());
  }

  clone.querySelectorAll<HTMLElement>('button').forEach((button) => {
    button.setAttribute('disabled', 'true');
  });

  return serializeElementForForeignObject(clone);
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
        targetElement.style.setProperty(property, value);
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

function collectDocumentCss(): string {
  const chunks: string[] = [];

  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const rules = (sheet as CSSStyleSheet).cssRules;
      if (!rules) return;
      chunks.push(Array.from(rules).map((rule) => rule.cssText).join('\n'));
    } catch (_error) {
      // Cross-origin sheets cannot be read; export still uses inline element styles.
    }
  });

  chunks.push(`
    :root, body, .mindmap-export-page, .mindmap-export-box { ${collectCssVariables()} }
    body { margin: 0; background: var(--background-primary, #ffffff); }
    .mindmap-export-page { position: relative; overflow: hidden; background: var(--background-primary, #ffffff); }
    .mindmap-export-box { position: absolute; overflow: visible; }
    .mindmap-export-box .mindmap-overlay,
    .mindmap-export-box .mindmap-heading-frame { position: relative !important; left: 0 !important; top: 0 !important; }
  `);

  return chunks.join('\n');
}

function collectCssVariables(): string {
  const variables = new Map<string, string>();
  [document.documentElement, document.body].forEach((element) => {
    const computed = getComputedStyle(element);
    for (let i = 0; i < computed.length; i++) {
      const property = computed[i];
      if (property.startsWith('--')) {
        variables.set(property, computed.getPropertyValue(property));
      }
    }
  });

  return Array.from(variables.entries())
    .map(([property, value]) => `${property}: ${value};`)
    .join('\n');
}

function buildSvg(scene: ExportScene): string {
  const escapedCss = scene.css.split(']]>').join(']]]]><![CDATA[>');
  const edges = scene.edges.map((edge) => (
    `<line x1="${edge.x1.toFixed(2)}" y1="${edge.y1.toFixed(2)}" x2="${edge.x2.toFixed(2)}" y2="${edge.y2.toFixed(2)}" stroke="#000000" stroke-width="1" />`
  )).join('\n');
  const boxes = [...scene.boxes].sort(compareExportBoxes).map((box) => {
    const exportX = box.x - box.bleed.left;
    const exportY = box.y - box.bleed.top;
    const exportW = box.w + box.bleed.left + box.bleed.right;
    const exportH = box.h + box.bleed.top + box.bleed.bottom;

    return `
    <foreignObject x="${exportX.toFixed(2)}" y="${exportY.toFixed(2)}" width="${exportW.toFixed(2)}" height="${exportH.toFixed(2)}">
      <div xmlns="http://www.w3.org/1999/xhtml" class="mindmap-export-box" style="position:relative;width:${exportW}px;height:${exportH}px;overflow:visible;">
        <div style="position:absolute;left:${box.bleed.left}px;top:${box.bleed.top}px;width:${box.w}px;height:${box.h}px;overflow:visible;">
          ${box.html}
        </div>
      </div>
    </foreignObject>
  `;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">
  <style><![CDATA[
${escapedCss}
  ]]></style>
  <rect width="100%" height="100%" fill="${escapeXml(scene.background)}" />
  <g class="mindmap-export-edges">
${edges}
  </g>
  <g class="mindmap-export-nodes">
${boxes}
  </g>
</svg>
`;
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
    prepared.snapshot.style.display = 'none';
    prepared.printRoot.appendChild(pdfArtifact);
    await waitForCurrentDocumentReady(pdfArtifact);
    const bytes = await currentWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      marginsType: 1,
    });
    pdfArtifact.remove();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
  const printRoot = document.createElement('div');
  printRoot.className = 'mindmap-vector-print-root';
  printRoot.style.width = `${width}px`;
  printRoot.style.height = `${height}px`;
  printRoot.style.background = background;
  printRoot.style.overflow = 'hidden';
  printRoot.style.position = 'fixed';
  printRoot.style.left = '-100000px';
  printRoot.style.top = '0';

  const previousWrapperStyle = {
    width: view.wrapper.style.width,
    height: view.wrapper.style.height,
    position: view.wrapper.style.position,
    left: view.wrapper.style.left,
    top: view.wrapper.style.top,
  };
  let printEdgeLayer: SVGSVGElement | null = null;
  let snapshot: HTMLElement | null = null;
  const exportStyle = document.createElement('style');
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
  view.wrapper.style.width = `${width}px`;
  view.wrapper.style.height = `${height}px`;
  view.wrapper.style.position = 'relative';
  view.wrapper.style.left = '0';
  view.wrapper.style.top = '0';
  document.head.appendChild(exportStyle);
  document.body.classList.add('mindmap-vector-printing');

  try {
    view.cy?.resize();
    view.cy?.fit(view.cy.elements(), 50);
    view.cy?.center(view.cy.elements());
    await refreshOverlays(view);
    printEdgeLayer = createPrintEdgeLayer(view, width, height);
    view.wrapper.insertBefore(printEdgeLayer, view.wrapper.firstChild);
    snapshot = createExportSnapshot(view.wrapper, width, height, background);
    printRoot.appendChild(snapshot);
    view.wrapper.classList.add('mindmap-vector-source-wrapper');
    return await callback({ width, height, background, snapshot, printRoot });
  } finally {
    document.body.classList.remove('mindmap-vector-printing');
    exportStyle.remove();
    view.wrapper.classList.remove('mindmap-vector-source-wrapper');
    snapshot?.remove();
    printEdgeLayer?.remove();
    view.wrapper.style.width = previousWrapperStyle.width;
    view.wrapper.style.height = previousWrapperStyle.height;
    view.wrapper.style.position = previousWrapperStyle.position;
    view.wrapper.style.left = previousWrapperStyle.left;
    view.wrapper.style.top = previousWrapperStyle.top;
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

  const container = document.createElement('div');
  container.className = 'mindmap-vector-pdf-artifact';
  container.style.display = 'block';
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.overflow = 'hidden';
  container.style.background = getDocumentBackgroundColor();

  const importedSvg = document.importNode(svgElement, true) as unknown as SVGSVGElement;
  importedSvg.style.display = 'block';
  importedSvg.style.width = `${width}px`;
  importedSvg.style.height = `${height}px`;
  container.appendChild(importedSvg);
  return container;
}

function createExportSnapshot(source: HTMLElement, width: number, height: number, background: string): HTMLElement {
  const snapshot = source.cloneNode(true) as HTMLElement;
  inlineComputedStyles(source, snapshot);
  sanitizeExportDomClone(snapshot);
  snapshot.classList.add('mindmap-vector-export-snapshot');
  snapshot.classList.remove('mindmap-vector-source-wrapper');
  snapshot.style.display = 'block';
  snapshot.style.width = `${width}px`;
  snapshot.style.height = `${height}px`;
  snapshot.style.position = 'relative';
  snapshot.style.left = '0';
  snapshot.style.top = '0';
  snapshot.style.overflow = 'hidden';
  snapshot.style.background = background;
  snapshot.style.margin = '0';
  snapshot.style.boxSizing = 'border-box';
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
    element.style.setProperty('background', CHECKED_EXPORT_BACKGROUND, 'important');
    element.style.setProperty('background-color', CHECKED_EXPORT_BACKGROUND, 'important');
    element.style.setProperty('background-image', 'none', 'important');
    element.style.borderColor = '#b8b8b8';
    element.style.color = CHECKED_EXPORT_COLOR;
    element.style.zIndex = '10';

    element.querySelectorAll<HTMLElement>('.markdown-rendered, .markdown-rendered *').forEach((content) => {
      content.style.color = CHECKED_EXPORT_COLOR;
      content.style.opacity = '1';
    });

    element.querySelectorAll<HTMLElement>('.checkbox-toggle, .checkbox-toggle *').forEach((checkbox) => {
      checkbox.style.color = CHECKED_EXPORT_COLOR;
      checkbox.style.stroke = CHECKED_EXPORT_COLOR;
      checkbox.style.opacity = '1';
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
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '1';

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

function flattenColor(color: string, background: string): string {
  const foregroundRgba = parseRgbColor(color);
  if (!foregroundRgba || foregroundRgba.a >= 1) {
    return color;
  }

  const backgroundRgba = parseRgbColor(background) ?? { r: 255, g: 255, b: 255, a: 1 };
  const alpha = foregroundRgba.a;
  const r = Math.round(foregroundRgba.r * alpha + backgroundRgba.r * (1 - alpha));
  const g = Math.round(foregroundRgba.g * alpha + backgroundRgba.g * (1 - alpha));
  const b = Math.round(foregroundRgba.b * alpha + backgroundRgba.b * (1 - alpha));
  return `rgb(${r}, ${g}, ${b})`;
}

function parseRgbColor(color: string): { r: number; g: number; b: number; a: number } | null {
  const rgbaMatch = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => part.trim());
    const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    if ([r, g, b, a].every(Number.isFinite)) {
      return { r, g, b, a };
    }
  }

  const hexMatch = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hexMatch) return null;

  const value = hexMatch[1];
  const normalized = value.length === 3
    ? value.split('').map((char) => `${char}${char}`).join('')
    : value;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: 1,
  };
}

function compareExportBoxes(a: ExportBox, b: ExportBox): number {
  if (a.kind !== b.kind) {
    return a.kind === 'heading' ? -1 : 1;
  }

  if (a.kind === 'heading') {
    return (b.w * b.h) - (a.w * a.h);
  }

  return 0;
}

async function waitForCurrentDocumentReady(root: HTMLElement): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      await fonts.ready;
    }
  } catch (_error) {
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
