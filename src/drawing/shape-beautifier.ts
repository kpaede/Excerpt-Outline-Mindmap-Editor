import type { InkPoint } from './types';
import { classifyStroke, extractStrokeFeatures } from './stroke-features';

export interface BeautifiedStroke {
  points: InkPoint[];
  kind: 'line' | 'rectangle' | 'ellipse' | 'freeform';
  confidence: number;
}

const distance = (a: InkPoint, b: InkPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(points: InkPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) length += distance(points[index - 1], points[index]);
  return length;
}

interface PrincipalAxis {
  center: { x: number; y: number };
  cos: number;
  sin: number;
}

/** PCA fit through every point, used only to orient/size the ellipse output below. */
function fitPrincipalAxis(points: InkPoint[]): PrincipalAxis {
  const n = points.length;
  const center = points.reduce((sum, point) => ({
    x: sum.x + point.x / n,
    y: sum.y + point.y / n,
  }), { x: 0, y: 0 });
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { center, cos: Math.cos(angle), sin: Math.sin(angle) };
}

/** Shoelace signed area: the whole loop's winding direction, immune to noise in any one sample. */
function signedArea(points: InkPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area;
}

function distanceToLine(point: InkPoint, start: InkPoint, end: InkPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function simplify(points: InkPoint[], tolerance: number): InkPoint[] {
  if (points.length <= 2) return points.slice();
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const current = distanceToLine(points[index], points[0], points[points.length - 1]);
    if (current > maxDistance) {
      maxDistance = current;
      splitIndex = index;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, splitIndex + 1), tolerance);
  const right = simplify(points.slice(splitIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

function resample(points: InkPoint[], count: number): InkPoint[] {
  if (points.length === 0 || count <= 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }));
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return Array.from({ length: count }, () => ({ ...points[0] }));
  return Array.from({ length: count }, (_, outputIndex) => {
    const target = total * (outputIndex / Math.max(1, count - 1));
    let segment = 1;
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment++;
    const startDistance = cumulative[segment - 1];
    const segmentLength = Math.max(0.0001, cumulative[segment] - startDistance);
    const t = (target - startDistance) / segmentLength;
    const a = points[segment - 1];
    const b = points[segment];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      pressure: a.pressure + (b.pressure - a.pressure) * t,
      tiltX: a.tiltX,
      tiltY: a.tiltY,
      time: a.time,
    };
  });
}

function smoothCorners(points: InkPoint[], passes = 2): InkPoint[] {
  let result = points.slice();
  for (let pass = 0; pass < passes; pass++) {
    if (result.length < 3) break;
    const next: InkPoint[] = [{ ...result[0] }];
    for (let index = 0; index < result.length - 1; index++) {
      const a = result[index];
      const b = result[index + 1];
      next.push({ ...a, x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ ...b, x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push({ ...result[result.length - 1] });
    result = next;
  }
  return result;
}

function fitEllipse(points: InkPoint[], axis: PrincipalAxis, count: number): InkPoint[] {
  const { center, cos, sin } = axis;
  let localXX = 0;
  let localYY = 0;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    localXX += localX * localX;
    localYY += localY * localY;
  }
  // Points sampled around an ellipse's boundary have variance R^2/2 along
  // each axis, so this moment estimate averages over every sample instead of
  // keying off whichever single one happens to be furthest out - one wobbly
  // point can no longer blow up the fitted radius.
  const radiusX = Math.max(0.0001, Math.sqrt(2 * localXX / points.length));
  const radiusY = Math.max(0.0001, Math.sqrt(2 * localYY / points.length));
  const firstDx = points[0].x - center.x;
  const firstDy = points[0].y - center.y;
  const startX = (firstDx * cos + firstDy * sin) / radiusX;
  const startY = (-firstDx * sin + firstDy * cos) / radiusY;
  const startAngle = Math.atan2(startY, startX);
  // Winding direction from the whole loop's signed area, not the angle between
  // two early samples, so pen-down jitter at the start can't flip it.
  const direction = signedArea(points) >= 0 ? 1 : -1;
  return Array.from({ length: count }, (_, index) => {
    const theta = startAngle + direction * Math.PI * 2 * (index / Math.max(1, count - 1));
    const localX = Math.cos(theta) * radiusX;
    const localY = Math.sin(theta) * radiusY;
    const source = points[Math.min(points.length - 1, Math.round(index * (points.length - 1) / Math.max(1, count - 1)))];
    return {
      ...source,
      x: center.x + localX * cos - localY * sin,
      y: center.y + localX * sin + localY * cos,
    };
  });
}

/**
 * Axis-aligned bounding-box rectangle, starting at whichever corner is
 * closest to where the user actually put the pen down and tracing the
 * observed winding direction - matching Excalidraw's own recognized
 * rectangles, which are always axis-aligned regardless of how the sketch was
 * rotated.
 */
function fitRectangle(points: InkPoint[], count: number): InkPoint[] {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const clockwise: InkPoint[] = [
    { x: minX, y: minY, pressure: 0.5 },
    { x: maxX, y: minY, pressure: 0.5 },
    { x: maxX, y: maxY, pressure: 0.5 },
    { x: minX, y: maxY, pressure: 0.5 },
  ];
  const direction = signedArea(points) >= 0 ? 1 : -1;
  const corners = direction >= 0 ? clockwise : [clockwise[0], clockwise[3], clockwise[2], clockwise[1]];

  let startIndex = 0;
  let startDistance = Infinity;
  corners.forEach((corner, index) => {
    const d = distance(corner, points[0]);
    if (d < startDistance) {
      startDistance = d;
      startIndex = index;
    }
  });
  const ring = [...corners.slice(startIndex), ...corners.slice(0, startIndex), corners[startIndex]];

  const perimeter = resample(ring, count);
  return perimeter.map((point, index) => ({
    ...points[Math.min(points.length - 1, Math.round((index * (points.length - 1)) / Math.max(1, count - 1)))],
    x: point.x,
    y: point.y,
  }));
}

export function beautifyStroke(points: InkPoint[]): BeautifiedStroke | null {
  if (points.length < 6) return null;
  const length = pathLength(points);
  if (length < 12) return null;

  const { kind, confidence } = classifyStroke(extractStrokeFeatures(points));

  if (kind === 'line') {
    const line = Array.from({ length: points.length }, (_, index) => {
      const t = index / (points.length - 1);
      return {
        ...points[index],
        x: points[0].x + (points[points.length - 1].x - points[0].x) * t,
        y: points[0].y + (points[points.length - 1].y - points[0].y) * t,
      };
    });
    return { points: line, kind: 'line', confidence };
  }

  if (kind === 'rectangle') {
    return { points: fitRectangle(points, points.length), kind: 'rectangle', confidence };
  }

  if (kind === 'ellipse') {
    const axis = fitPrincipalAxis(points);
    return { points: fitEllipse(points, axis, points.length), kind: 'ellipse', confidence };
  }

  const tolerance = Math.max(1.2, length / 350);
  const cleaned = resample(smoothCorners(simplify(points, tolerance)), points.length);
  return { points: cleaned, kind: 'freeform', confidence: 0.6 };
}

export function interpolateStroke(from: InkPoint[], to: InkPoint[], progress: number): InkPoint[] {
  const t = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3);
  return from.map((point, index) => ({
    ...point,
    x: point.x + (to[index].x - point.x) * t,
    y: point.y + (to[index].y - point.y) * t,
  }));
}
