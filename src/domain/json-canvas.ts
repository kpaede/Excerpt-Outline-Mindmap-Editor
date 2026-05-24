import type { OutlineNode } from '../utils/outline';

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

export interface JsonCanvasTextNode {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  fromSide: CanvasSide;
  toNode: string;
  toSide: CanvasSide;
  toEnd: 'arrow';
}

export interface JsonCanvas {
  nodes: JsonCanvasTextNode[];
  edges: JsonCanvasEdge[];
}

export interface CanvasExportOptions {
  idFactory?: () => string;
}

const NODE_WIDTH = 320;
const MIN_NODE_HEIGHT = 90;
const MAX_NODE_HEIGHT = 420;
const X_GAP = 430;
const Y_GAP = 170;

function randomHexId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createUniqueId(usedIds: Set<string>, idFactory: () => string): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = idFactory();
    if (/^[0-9a-f]{16}$/.test(id) && !usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }

  throw new Error('Could not generate a unique JSON Canvas id.');
}

function canvasTextForNode(node: OutlineNode): string {
  const text = node.text.trim() || 'Untitled';
  if (node.checkbox === 'checked') return `- [x] ${text}`;
  if (node.checkbox === 'unchecked') return `- [ ] ${text}`;
  return text;
}

function estimateNodeHeight(text: string): number {
  const lines = text.split('\n');
  const wrappedLineCount = lines.reduce((count, line) => {
    return count + Math.max(1, Math.ceil(line.length / 42));
  }, 0);

  return Math.max(MIN_NODE_HEIGHT, Math.min(MAX_NODE_HEIGHT, 48 + wrappedLineCount * 24));
}

function flattenOutlineNodes(nodes: OutlineNode[]): OutlineNode[] {
  const flat: OutlineNode[] = [];
  const walk = (items: OutlineNode[]) => {
    items.forEach((node) => {
      flat.push(node);
      walk(node.children);
    });
  };
  walk(nodes);
  return flat;
}

function assignLayout(nodes: OutlineNode[]): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  let nextLeafY = 0;

  const walk = (node: OutlineNode, depth: number): number => {
    if (node.children.length === 0) {
      const y = nextLeafY;
      positions.set(node.line, { x: depth * X_GAP, y });
      nextLeafY += Y_GAP;
      return y;
    }

    const childYs = node.children.map((child) => walk(child, depth + 1));
    const y = Math.round((childYs[0] + childYs[childYs.length - 1]) / 2);
    positions.set(node.line, { x: depth * X_GAP, y });
    return y;
  };

  nodes.forEach((node) => {
    walk(node, 0);
    nextLeafY += Y_GAP;
  });

  return positions;
}

export function outlineToJsonCanvas(
  roots: OutlineNode[],
  options: CanvasExportOptions = {}
): JsonCanvas {
  const usedIds = new Set<string>();
  const idFactory = options.idFactory ?? randomHexId;
  const flatNodes = flattenOutlineNodes(roots);
  const positions = assignLayout(roots);
  const idByLine = new Map<number, string>();

  const nodes: JsonCanvasTextNode[] = flatNodes.map((node) => {
    const id = createUniqueId(usedIds, idFactory);
    idByLine.set(node.line, id);
    const text = canvasTextForNode(node);
    const position = positions.get(node.line) ?? { x: 0, y: 0 };

    return {
      id,
      type: 'text',
      x: position.x,
      y: position.y,
      width: NODE_WIDTH,
      height: estimateNodeHeight(text),
      text,
    };
  });

  const edges: JsonCanvasEdge[] = [];
  flatNodes.forEach((node) => {
    const parentId = idByLine.get(node.line);
    if (!parentId) return;

    node.children.forEach((child) => {
      const childId = idByLine.get(child.line);
      if (!childId) return;

      edges.push({
        id: createUniqueId(usedIds, idFactory),
        fromNode: parentId,
        fromSide: 'right',
        toNode: childId,
        toSide: 'left',
        toEnd: 'arrow',
      });
    });
  });

  return { nodes, edges };
}

export function validateJsonCanvas(canvas: JsonCanvas): void {
  const ids = new Set<string>();
  canvas.nodes.forEach((node) => {
    if (ids.has(node.id)) throw new Error(`Duplicate JSON Canvas id: ${node.id}`);
    ids.add(node.id);
  });

  canvas.edges.forEach((edge) => {
    if (ids.has(edge.id)) throw new Error(`Duplicate JSON Canvas id: ${edge.id}`);
    ids.add(edge.id);
    if (!canvas.nodes.some((node) => node.id === edge.fromNode)) {
      throw new Error(`JSON Canvas edge references missing fromNode: ${edge.fromNode}`);
    }
    if (!canvas.nodes.some((node) => node.id === edge.toNode)) {
      throw new Error(`JSON Canvas edge references missing toNode: ${edge.toNode}`);
    }
  });
}
