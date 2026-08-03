import { getStroke } from 'perfect-freehand';
import { penStrokeOptions } from './pen-stroke-options';
import type { DrawingDocument, ExportedDrawingItem, InkPoint, PressurePenOptions } from './types';
export { extractDrawingLink } from './drawing-link';

const METADATA_ID = 'eome-drawing-data';
const SUPPORTED_ITEM_TYPES = new Set(['pen', 'rect', 'circle', 'line', 'arrow', 'text', 'sticky', 'picture']);

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface DrawingPoint { x: number; y: number }

const ARROW_HEAD_SPREAD = Math.PI / 7;
const DRAWING_PADDING = 20;

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const safeColor = (value: unknown, fallback: string): string => {
  const candidate = text(value).trim();
  return /^(?:#[0-9a-f]{3,8}|transparent)$/i.test(candidate) ? candidate : fallback;
};
const isLocalRasterImage = (value: string): boolean => /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value);
const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function pointsBounds(points: DrawingPoint[], radius = 0): Bounds | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - radius,
    minY: minY - radius,
    maxX: maxX + radius,
    maxY: maxY + radius,
  };
}

/**
 * Mirrors simple-whiteboard 0.6's ArrowItem geometry: an ordinary shaft plus
 * two open line segments, each `(12 + strokeWidth * 2)` units long at PI/7.
 */
function arrowPoints(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): DrawingPoint[] {
  const points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.hypot(dx, dy) < 1) return points;

  const angle = Math.atan2(dy, dx);
  const headLength = 12 + strokeWidth * 2;
  points.push(
    {
      x: x2 - headLength * Math.cos(angle - ARROW_HEAD_SPREAD),
      y: y2 - headLength * Math.sin(angle - ARROW_HEAD_SPREAD),
    },
    {
      x: x2 - headLength * Math.cos(angle + ARROW_HEAD_SPREAD),
      y: y2 - headLength * Math.sin(angle + ARROW_HEAD_SPREAD),
    }
  );
  return points;
}

function textWidth(content: string, fontSize: number, fontFamily: string): number {
  const lines = content.split(/\r?\n/);
  const fallback = lines.reduce((widest, line) => Math.max(widest, line.length * fontSize * 0.62), 0);
  try {
    let context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'> | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      context = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined') {
      context = document.createElement('canvas').getContext('2d');
    }
    if (!context) return fallback;
    context.font = `${fontSize}px ${fontFamily}`;
    return lines.reduce((widest, line) => Math.max(widest, context?.measureText(line).width ?? 0), 0);
  } catch {
    return fallback;
  }
}

function pathData(points: number[][]): string {
  if (points.length < 4) return '';
  const average = (a: number, b: number): number => (a + b) / 2;
  const first = points[0];
  const second = points[1];
  const third = points[2];
  let result = `M${first[0].toFixed(2)},${first[1].toFixed(2)} Q${second[0].toFixed(2)},${second[1].toFixed(2)} ${average(second[0], third[0]).toFixed(2)},${average(second[1], third[1]).toFixed(2)} T`;
  for (let index = 2; index < points.length - 1; index++) {
    result += `${average(points[index][0], points[index + 1][0]).toFixed(2)},${average(points[index][1], points[index + 1][1]).toFixed(2)} `;
  }
  return `${result}Z`;
}

function itemBounds(item: ExportedDrawingItem): Bounds | null {
  const data = item.data;
  if (item.type === 'pen' && Array.isArray(data.path) && data.path.length > 0) {
    const points = data.path as InkPoint[];
    const size = finite((data.options as PressurePenOptions | undefined)?.size, 2);
    let minX = finite(points[0].x);
    let minY = finite(points[0].y);
    let maxX = minX;
    let maxY = minY;
    for (const point of points) {
      const x = finite(point.x);
      const y = finite(point.y);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return {
      minX: minX - size,
      minY: minY - size,
      maxX: maxX + size,
      maxY: maxY + size,
    };
  }
  const style = styleOptions(data);
  const strokeRadius = style.width / 2;
  if (item.type === 'rect') {
    const x = Math.min(finite(data.x1), finite(data.x2));
    const y = Math.min(finite(data.y1), finite(data.y2));
    const width = Math.abs(finite(data.x2) - finite(data.x1));
    const height = Math.abs(finite(data.y2) - finite(data.y1));
    // The editor deliberately insets the centerline by half the stroke so the
    // painted edge remains inside the item's logical rectangle.
    return pointsBounds([
      { x: x + strokeRadius, y: y + strokeRadius },
      { x: x + Math.max(strokeRadius, width - strokeRadius), y: y + Math.max(strokeRadius, height - strokeRadius) },
    ], strokeRadius);
  }
  if (item.type === 'circle') {
    const center = { x: finite(data.x), y: finite(data.y) };
    const centerlineRadius = Math.max(0, (finite(data.diameter) - style.width) / 2);
    return pointsBounds([
      { x: center.x - centerlineRadius, y: center.y - centerlineRadius },
      { x: center.x + centerlineRadius, y: center.y + centerlineRadius },
    ], strokeRadius);
  }
  if (item.type === 'line' || item.type === 'arrow') {
    const x1 = finite(data.x1);
    const y1 = finite(data.y1);
    const x2 = finite(data.x2);
    const y2 = finite(data.y2);
    const points = item.type === 'arrow'
      ? arrowPoints(x1, y1, x2, y2, style.width)
      : [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    // SVG uses round caps for the same smooth direct-input appearance. Every
    // segment endpoint therefore contributes a full stroke-radius to bounds.
    return pointsBounds(points, strokeRadius);
  }
  if (item.type === 'text') {
    const options = (data.options ?? {}) as Record<string, unknown>;
    const fontSize = Math.max(1, finite(options.fontSize, 16));
    const fontFamily = text(options.fontFamily) || 'sans-serif';
    const content = text(data.content);
    const lines = content.split(/\r?\n/);
    const x = finite(data.x);
    const y = finite(data.y);
    // TextItem.getBoundingBox() uses x-10/y-5 and adds 20 around the measured
    // text block. Reusing that contract keeps selection, editor and SVG aligned.
    return {
      minX: x - 10,
      minY: y - 5,
      maxX: x + textWidth(content, fontSize, fontFamily) + 10,
      maxY: y + lines.length * fontSize + 15,
    };
  }
  if (item.type === 'sticky' || item.type === 'picture') {
    if (item.type === 'picture' && !isLocalRasterImage(text(data.src))) return null;
    return {
      minX: Math.min(finite(data.x1), finite(data.x2)), minY: Math.min(finite(data.y1), finite(data.y2)),
      maxX: Math.max(finite(data.x1), finite(data.x2)), maxY: Math.max(finite(data.y1), finite(data.y2)),
    };
  }
  return null;
}

function styleOptions(data: Record<string, unknown>): { stroke: string; fill: string; width: number } {
  const options = (data.options ?? {}) as Record<string, unknown>;
  return {
    stroke: safeColor(options.stroke || options.color, '#000000'),
    fill: safeColor(options.fill, 'transparent') === 'transparent' ? 'none' : safeColor(options.fill, 'none'),
    width: Math.max(0.1, finite(options.strokeWidth ?? options.size, 1)),
  };
}

function svgTextLines(content: string, x: number, firstBaselineY: number, lineHeight: number): string {
  return content.split(/\r?\n/).map((line, index) =>
    `<tspan x="${x}" y="${firstBaselineY + index * lineHeight}">${escapeXml(line || ' ')}</tspan>`
  ).join('');
}

function itemToSvg(item: ExportedDrawingItem): string {
  const data = item.data;
  const style = styleOptions(data);
  const common = `stroke="${escapeXml(style.stroke)}" stroke-width="${style.width}" fill="${escapeXml(style.fill)}" stroke-linecap="round" stroke-linejoin="round"`;
  if (item.type === 'pen' && Array.isArray(data.path)) {
    const points = data.path as InkPoint[];
    const options = (data.options ?? {}) as PressurePenOptions;
    const outline = getStroke(
      points.map((point) => ({ x: point.x, y: point.y, pressure: point.pressure ?? 0.5 })),
      penStrokeOptions(options, options.size)
    );
    return `<path d="${pathData(outline)}" fill="${safeColor(options.color, '#000000')}"/>`;
  }
  if (item.type === 'rect') {
    const x = Math.min(finite(data.x1), finite(data.x2));
    const y = Math.min(finite(data.y1), finite(data.y2));
    const width = Math.abs(finite(data.x2) - finite(data.x1));
    const height = Math.abs(finite(data.y2) - finite(data.y1));
    const inset = style.width / 2;
    return `<rect x="${x + inset}" y="${y + inset}" width="${Math.max(0, width - style.width)}" height="${Math.max(0, height - style.width)}" ${common}/>`;
  }
  if (item.type === 'circle') {
    const radius = Math.max(0, (finite(data.diameter) - style.width) / 2);
    return `<circle cx="${finite(data.x)}" cy="${finite(data.y)}" r="${radius}" ${common}/>`;
  }
  if (item.type === 'line' || item.type === 'arrow') {
    const x1 = finite(data.x1);
    const y1 = finite(data.y1);
    const x2 = finite(data.x2);
    const y2 = finite(data.y2);
    const lineStyle = `stroke="${escapeXml(style.stroke)}" stroke-width="${style.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${lineStyle}/>`;
    if (item.type === 'line') return line;
    const points = arrowPoints(x1, y1, x2, y2, style.width);
    if (points.length === 2) return line;
    const left = points[2];
    const right = points[3];
    return `${line}<line x1="${x2}" y1="${y2}" x2="${left.x}" y2="${left.y}" ${lineStyle}/><line x1="${x2}" y1="${y2}" x2="${right.x}" y2="${right.y}" ${lineStyle}/>`;
  }
  if (item.type === 'text') {
    const options = (data.options ?? {}) as Record<string, unknown>;
    const fontSize = Math.max(1, finite(options.fontSize, 16));
    const x = finite(data.x);
    const y = finite(data.y);
    // Canvas fillText uses the alphabetic baseline and draws the first line one
    // font-size below the item's y anchor; subsequent lines advance by exactly
    // one font-size in simple-whiteboard's TextItem.draw().
    return `<text font-family="${escapeXml(text(options.fontFamily) || 'sans-serif')}" font-size="${fontSize}" fill="${safeColor(options.color, '#000000')}" text-anchor="start" dominant-baseline="alphabetic" xml:space="preserve">${svgTextLines(text(data.content), x, y + fontSize, fontSize)}</text>`;
  }
  if (item.type === 'sticky') {
    const x = Math.min(finite(data.x1), finite(data.x2));
    const y = Math.min(finite(data.y1), finite(data.y2));
    const width = Math.abs(finite(data.x2) - finite(data.x1));
    const height = Math.abs(finite(data.y2) - finite(data.y1));
    const fontSize = Math.max(1, finite(data.fontSize, 16));
    return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${safeColor(data.backgroundColor, '#ffe084')}"/><text font-size="${fontSize}" fill="${safeColor(data.color, '#1f2933')}">${svgTextLines(text(data.content), x + 12, y + 26, fontSize * 1.2)}</text></g>`;
  }
  if (item.type === 'picture' && text(data.src)) {
    if (!isLocalRasterImage(text(data.src))) return '';
    const x = Math.min(finite(data.x1), finite(data.x2));
    const y = Math.min(finite(data.y1), finite(data.y2));
    return `<image x="${x}" y="${y}" width="${Math.abs(finite(data.x2) - finite(data.x1))}" height="${Math.abs(finite(data.y2) - finite(data.y1))}" href="${escapeXml(text(data.src))}"/>`;
  }
  return '';
}

export function createDrawingSvg(items: ExportedDrawingItem[], previousCreatedAt?: string): string {
  const now = new Date().toISOString();
  const document: DrawingDocument = {
    format: 'eome-drawing', version: 1, createdAt: previousCreatedAt ?? now, updatedAt: now, items,
  };
  const bounds = items.map(itemBounds).filter((value): value is Bounds => value !== null);
  const combined = bounds.length > 0
    ? bounds.slice(1).reduce<Bounds>((result, current) => ({
      minX: Math.min(result.minX, current.minX), minY: Math.min(result.minY, current.minY),
      maxX: Math.max(result.maxX, current.maxX), maxY: Math.max(result.maxY, current.maxY),
    }), bounds[0])
    : { minX: 0, minY: 0, maxX: 640, maxY: 400 };
  const x = combined.minX - DRAWING_PADDING;
  const y = combined.minY - DRAWING_PADDING;
  const width = Math.max(80, combined.maxX - combined.minX + DRAWING_PADDING * 2);
  const height = Math.max(60, combined.maxY - combined.minY + DRAWING_PADDING * 2);
  const body = items.map(itemToSvg).join('');
  const metadata = encodeBase64(JSON.stringify(document));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Drawing">\n<metadata id="${METADATA_ID}" data-encoding="base64">${metadata}</metadata>\n<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>\n${body}\n</svg>\n`;
}

export function parseDrawingSvg(svg: string): DrawingDocument | null {
  const match = svg.match(new RegExp(`<metadata[^>]*id=["']${METADATA_ID}["'][^>]*>([\\s\\S]*?)<\\/metadata>`, 'i'));
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeBase64(match[1])) as DrawingDocument;
    if (parsed.format !== 'eome-drawing' || parsed.version !== 1 || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.slice(0, 5000).filter((item): item is ExportedDrawingItem => {
      if (!item || typeof item.id !== 'string' || !SUPPORTED_ITEM_TYPES.has(item.type) || !item.data || typeof item.data !== 'object') return false;
      if (item.type === 'picture') {
        const src = text(item.data.src);
        return isLocalRasterImage(src) && src.length <= 12_000_000;
      }
      if (item.type === 'pen') {
        return Array.isArray(item.data.path) && item.data.path.length <= 100_000;
      }
      return true;
    });
    return { ...parsed, items };
  } catch {
    return null;
  }
}
