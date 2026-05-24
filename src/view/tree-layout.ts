import type { Core } from 'cytoscape';
import type { HeadingTreeLayout } from '../domain/layout-options';
import type { OutlineNode } from '../utils/outline';

function collectSubtreeLines(node: OutlineNode, lines: Set<number>): void {
  lines.add(node.line);
  node.children.forEach((child) => collectSubtreeLines(child, lines));
}

function getGroupBounds(
  cy: Core,
  lines: Set<number>,
  sizeMap: Map<number, { w: number; h: number }>
): { left: number; top: number; right: number; bottom: number } | null {
  let bounds: { left: number; top: number; right: number; bottom: number } | null = null;

  lines.forEach((line) => {
    const node = cy.getElementById(`n${line}`);
    const dims = sizeMap.get(line);
    if (!dims || node.empty()) return;

    const position = node.position();
    const nodeBounds = {
      left: position.x - dims.w / 2,
      top: position.y - dims.h / 2,
      right: position.x + dims.w / 2,
      bottom: position.y + dims.h / 2,
    };

    bounds = bounds
      ? {
        left: Math.min(bounds.left, nodeBounds.left),
        top: Math.min(bounds.top, nodeBounds.top),
        right: Math.max(bounds.right, nodeBounds.right),
        bottom: Math.max(bounds.bottom, nodeBounds.bottom),
      }
      : nodeBounds;
  });

  return bounds;
}

export function arrangeTopLevelTrees(
  cy: Core,
  roots: OutlineNode[],
  sizeMap: Map<number, { w: number; h: number }>,
  mode: HeadingTreeLayout = 'vertical',
  gap: number = 160
): void {
  if (roots.length < 2) return;

  const groups = roots
    .map((root) => {
      const lines = new Set<number>();
      collectSubtreeLines(root, lines);
      return { lines, bounds: getGroupBounds(cy, lines, sizeMap) };
    })
    .filter((group): group is { lines: Set<number>; bounds: { left: number; top: number; right: number; bottom: number } } => (
      group.bounds !== null
    ));

  if (groups.length < 2) return;

  const targetLeft = Math.min(...groups.map((group) => group.bounds.left));
  const targetTop = Math.min(...groups.map((group) => group.bounds.top));
  let nextTop = groups[0].bounds.top;
  let nextLeft = groups[0].bounds.left;

  groups.forEach((group) => {
    const dx = mode === 'horizontal'
      ? nextLeft - group.bounds.left
      : targetLeft - group.bounds.left;
    const dy = mode === 'horizontal'
      ? targetTop - group.bounds.top
      : nextTop - group.bounds.top;

    group.lines.forEach((line) => {
      const node = cy.getElementById(`n${line}`);
      if (node.empty()) return;

      const position = node.position();
      node.position({
        x: position.x + dx,
        y: position.y + dy,
      });
    });

    if (mode === 'horizontal') {
      nextLeft += group.bounds.right - group.bounds.left + gap;
    } else {
      nextTop += group.bounds.bottom - group.bounds.top + gap;
    }
  });
}
