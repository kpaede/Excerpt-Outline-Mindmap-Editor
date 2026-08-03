/**
 * Moment-based stroke shape recognizer, ported from Excalidraw
 * (packages/element/src/convertToShape.ts and packages/math/src/pca.ts).
 * Feature values and thresholds are copied as-is; the arrow/diamond branches
 * are dropped since this canvas has no arrowhead or diamond primitive to
 * render a recognized stroke as; that also drops the axis-orientation and
 * skew step, which existed only to tell an arrow's lopsided point mass from
 * a plain line's.
 */

export interface Vec2 {
  x: number;
  y: number;
}

// Number of points every stroke is resampled to before feature extraction.
const RESAMPLE_N = 64;

// A stroke whose endpoints are farther apart than this fraction of its own
// path length is treated as open (a line) rather than closed (a rectangle or
// ellipse).
const CLOSED_GAP_MAX_RATIO = 0.15;

// Maximum elongation for an open stroke to count as straight.
const LINEAR_MAX_ELONGATION = 0.25;

// Fraction of the start-to-tip distance around the tip inside which points
// are exempt from the shaft-straightness check (a hook right at the pen-up
// point shouldn't fail an otherwise straight line).
const ARROWHEAD_ZONE_RATIO = 0.5;

// Maximum distance any point outside that zone may stray from the
// start-to-tip chord, as a fraction of the chord length.
const LINEAR_MAX_SHAFT_DEVIATION = 0.15;

// Maximum feature-space distance to a shape prototype, in units of the
// per-feature tolerances below. Beyond this the stroke is not enough like
// any known shape and stays freeform.
const CLOSED_SHAPE_MAX_DISTANCE = 1.5;

const HULL_FILL_RATIO_TOLERANCE = 0.2;
const CORNER_TURN_SHARE_TOLERANCE = 0.2;
const KURTOSIS_PRODUCT_TOLERANCE = 0.7;

// Half-width, in resampled points, of the chord window used to measure local
// turning along the stroke.
const TURN_WINDOW = 3;

export type RecognizedShapeKind = 'line' | 'rectangle' | 'ellipse' | 'freeform';

export interface StrokeFeatures {
  /** Straight-line distance between the endpoints over the stroke's own path length. */
  gapRatio: number;
  /** Point cloud elongation along the major axis: 0 straight, 1 no preferred direction. */
  elongation: number;
  /** Convex hull area over axis-aligned bounding box area: ~1 rectangle, ~PI/4 ellipse. */
  hullFillRatio: number;
  /** Share of the stroke's total turning concentrated in its 4 strongest corners. */
  cornerTurnShare: number;
  /** kurtosis(x) * kurtosis(y) in the screen frame: ~1.83 rectangle, ~2.25 ellipse. */
  kurtosisProduct: number;
  /** Max deviation from the start-to-tip chord outside the arrowhead zone, as a fraction of that chord. */
  shaftDeviationRatio: number;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared !== 0
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Resample `points` to exactly `n` evenly-spaced points along the stroke path. */
function resampleEven(points: readonly Vec2[], n: number): Vec2[] {
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) totalLength += distance(points[i - 1], points[i]);

  const interval = totalLength / (n - 1);
  let accumulated = 0;
  const result: Vec2[] = [points[0]];
  let prev = points[0];

  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const segmentLength = distance(prev, curr);
    if (accumulated + segmentLength >= interval) {
      let remaining = interval - accumulated;
      while (remaining <= segmentLength + 1e-10) {
        const t = remaining / segmentLength;
        const next: Vec2 = { x: prev.x + t * (curr.x - prev.x), y: prev.y + t * (curr.y - prev.y) };
        result.push(next);
        if (result.length === n) return result;
        prev = next;
        accumulated = 0;
        remaining += interval;
      }
      accumulated = segmentLength - (remaining - interval);
    } else {
      accumulated += segmentLength;
    }
    prev = curr;
  }

  while (result.length < n) result.push(points[points.length - 1]);
  return result;
}

function centroid(points: readonly Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  return { x: cx / points.length, y: cy / points.length };
}

/**
 * Ratio of the minor to the major variance of the point cloud's covariance
 * matrix, in [0, 1]: 0 is a perfectly straight stroke, 1 has no preferred
 * direction.
 */
function elongationOf(points: readonly Vec2[]): number {
  const c = centroid(points);
  let m20 = 0;
  let m02 = 0;
  let m11 = 0;
  for (const point of points) {
    const dx = point.x - c.x;
    const dy = point.y - c.y;
    m20 += dx * dx;
    m02 += dy * dy;
    m11 += dx * dy;
  }
  m20 /= points.length;
  m02 /= points.length;
  m11 /= points.length;

  const trace = m20 + m02;
  const diff = Math.hypot(m20 - m02, 2 * m11);
  const majorVariance = (trace + diff) / 2;
  const minorVariance = (trace - diff) / 2;
  return majorVariance > 0 ? minorVariance / majorVariance : 1;
}

/** Fourth standardized moment (not excess kurtosis - a normal sample gives 3). */
function kurtosis(values: readonly number[]): number {
  const n = values.length;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  let variance = 0;
  let moment = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
    moment += d ** 4;
  }
  variance /= n;
  moment /= n;

  const sigma = Math.sqrt(variance);
  return sigma > Number.EPSILON ? moment / sigma ** 4 : 0;
}

function polygonArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j].x * polygon[i].y - polygon[i].x * polygon[j].y;
  }
  return Math.abs(sum / 2);
}

/** Convex hull via Andrew's monotone chain. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (pts: Vec2[]): Vec2[] => {
    const chain: Vec2[] = [];
    for (const point of pts) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  return hull.length >= 3 ? hull : [...points];
}

/**
 * How far the stroke strays from the straight chord between its start and its
 * farthest point ("tip"), as a fraction of that chord's length. Points near
 * the tip are exempt so a hook at the pen-up point doesn't count.
 */
function shaftDeviationRatio(points: readonly Vec2[]): number {
  const start = points[0];
  let tip = start;
  let tipDistance = 0;
  for (const point of points) {
    const d = distance(point, start);
    if (d > tipDistance) {
      tipDistance = d;
      tip = point;
    }
  }
  if (tipDistance === 0) return 0;

  let maxDeviation = 0;
  for (const point of points) {
    if (distance(point, tip) <= ARROWHEAD_ZONE_RATIO * tipDistance) continue;
    maxDeviation = Math.max(maxDeviation, distanceToSegment(point, start, tip));
  }
  return maxDeviation / tipDistance;
}

/** The turn angle at every point, between the incoming and outgoing chords TURN_WINDOW points away. */
function windowedTurns(points: readonly Vec2[]): number[] {
  const turns: number[] = [];
  for (let i = TURN_WINDOW; i < points.length - TURN_WINDOW; i++) {
    const a = points[i - TURN_WINDOW];
    const b = points[i];
    const c = points[i + TURN_WINDOW];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    turns.push(Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)));
  }
  return turns;
}

/**
 * Share of the stroke's total turning concentrated in its 4 strongest corner
 * loci: ~1 for any quadrilateral (all turning happens at the corners) vs.
 * ~0.5 for an ellipse (turning spread along the whole outline). Greedily
 * picks the 4 strongest peaks, each absorbing its +/-TURN_WINDOW neighborhood
 * so one physical corner counts once.
 */
function cornerTurnShare(points: readonly Vec2[]): number {
  const turns = windowedTurns(points);
  const total = turns.reduce((sum, turn) => sum + turn, 0);
  if (total === 0) return 0;

  const taken = new Array<boolean>(turns.length).fill(false);
  let top4 = 0;
  for (let corner = 0; corner < 4; corner++) {
    let peak = -1;
    let peakTurn = 0;
    for (let i = 0; i < turns.length; i++) {
      if (!taken[i] && turns[i] > peakTurn) {
        peakTurn = turns[i];
        peak = i;
      }
    }
    if (peak < 0) break;
    for (let i = peak - TURN_WINDOW; i <= peak + TURN_WINDOW; i++) {
      if (i >= 0 && i < turns.length && !taken[i]) {
        top4 += turns[i];
        taken[i] = true;
      }
    }
  }
  return top4 / total;
}

export function extractStrokeFeatures(points: readonly Vec2[]): StrokeFeatures {
  // Resample first: features are moments of the point set, so they would
  // otherwise be biased by pointer speed, which crowds samples wherever the
  // user drew slowly.
  const pts = resampleEven(points, RESAMPLE_N);

  let pathLength = 0;
  for (let i = 1; i < pts.length; i++) pathLength += distance(pts[i - 1], pts[i]);
  const gap = distance(pts[0], pts[pts.length - 1]);

  const hull = convexHull(pts);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const boxArea = (maxX - minX) * (maxY - minY);

  return {
    gapRatio: pathLength > 0 ? gap / pathLength : 0,
    elongation: elongationOf(pts),
    hullFillRatio: boxArea > 0 ? polygonArea(hull) / boxArea : 0,
    cornerTurnShare: cornerTurnShare(pts),
    kurtosisProduct: kurtosis(xs) * kurtosis(ys),
    shaftDeviationRatio: shaftDeviationRatio(pts),
  };
}

const CLOSED_SHAPE_PROTOTYPES: readonly {
  type: 'rectangle' | 'ellipse';
  hullFillRatio: number;
  cornerTurnShare: number;
  kurtosisProduct: number;
}[] = [
  { type: 'rectangle', hullFillRatio: 1, cornerTurnShare: 0.95, kurtosisProduct: 1.83 },
  { type: 'ellipse', hullFillRatio: Math.PI / 4, cornerTurnShare: 0.55, kurtosisProduct: 2.25 },
];

export interface StrokeClassification {
  kind: RecognizedShapeKind;
  confidence: number;
}

/** Pick the closed shape whose prototype the stroke's features sit closest to, or freeform when even the nearest is too far. */
function classifyClosedStroke(features: StrokeFeatures): StrokeClassification {
  let best: RecognizedShapeKind = 'freeform';
  let bestDistance = CLOSED_SHAPE_MAX_DISTANCE;

  for (const prototype of CLOSED_SHAPE_PROTOTYPES) {
    const dist = Math.hypot(
      (features.hullFillRatio - prototype.hullFillRatio) / HULL_FILL_RATIO_TOLERANCE,
      (features.cornerTurnShare - prototype.cornerTurnShare) / CORNER_TURN_SHARE_TOLERANCE,
      (features.kurtosisProduct - prototype.kurtosisProduct) / KURTOSIS_PRODUCT_TOLERANCE,
    );
    if (dist < bestDistance) {
      bestDistance = dist;
      best = prototype.type;
    }
  }
  return {
    kind: best,
    confidence: best === 'freeform' ? 0.6 : Math.max(0, 1 - bestDistance / CLOSED_SHAPE_MAX_DISTANCE),
  };
}

function classifyOpenStroke(features: StrokeFeatures): StrokeClassification {
  const margin = Math.max(
    features.elongation / LINEAR_MAX_ELONGATION,
    features.shaftDeviationRatio / LINEAR_MAX_SHAFT_DEVIATION,
  );
  if (margin > 1) return { kind: 'freeform', confidence: 0.6 };
  return { kind: 'line', confidence: Math.max(0, 1 - margin) };
}

export function classifyStroke(features: StrokeFeatures): StrokeClassification {
  return features.gapRatio > CLOSED_GAP_MAX_RATIO
    ? classifyOpenStroke(features)
    : classifyClosedStroke(features);
}
