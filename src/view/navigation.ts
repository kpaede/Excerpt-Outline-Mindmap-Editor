import type { NodeSingular } from 'cytoscape';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';

/**
 * Cytoscape's data() is untyped by design; this is the one place that knows
 * what the graph actually stores on a node.
 */
function outlineLineOf(element: NodeSingular): number | undefined {
  return (element.data('node') as OutlineNode | undefined)?.line;
}

export type NavigationDirection = 'up' | 'down' | 'left' | 'right';

export function navigateSelection(view: MindmapView, direction: NavigationDirection): void {
  if (view.generalSettings.keyboardNavigation === 'spatial') {
    navigateSpatial(view, direction);
    return;
  }

  const flat = view.getFlatNodes();
  if (flat.length === 0) return;

  const selectedArray = Array.from(view.selectedNodeLines);
  const lastSelectedLine = selectedArray.length > 0 ? selectedArray[selectedArray.length - 1] : null;

  if (lastSelectedLine === null) {
    view.selectNode(flat[0].line);
    return;
  }

  const current = flat.find(node => node.line === lastSelectedLine);
  if (!current) {
    view.selectNode(flat[0].line);
    return;
  }

  const parent = flat.find(node => node.children.some(child => child.line === current.line));

  if (direction === 'up') {
    if (parent) view.selectNode(parent.line);
    return;
  }

  if (direction === 'down') {
    if (current.children[0]) view.selectNode(current.children[0].line);
    return;
  }

  if (!parent) return;

  const siblingIndex = parent.children.findIndex(child => child.line === current.line);
  if (siblingIndex < 0) return;

  if (direction === 'left') {
    const previousSibling = parent.children[siblingIndex - 1];
    if (previousSibling) view.selectNode(previousSibling.line);
    return;
  }

  if (direction === 'right') {
    const nextSibling = parent.children[siblingIndex + 1];
    if (nextSibling) view.selectNode(nextSibling.line);
  }
}

function navigateSpatial(view: MindmapView, direction: NavigationDirection): void {
  if (!view.cy) return;
  const nodes = view.cy.nodes();
  if (nodes.length === 0) return;

  const selectedArray = Array.from(view.selectedNodeLines);
  const lastSelectedLine = selectedArray.length > 0 ? selectedArray[selectedArray.length - 1] : null;

  if (lastSelectedLine === null) {
    const firstLine = outlineLineOf(nodes[0]);
    if (firstLine !== undefined) view.selectNode(firstLine);
    return;
  }

  const currentCyNode = view.cy.getElementById(`n${lastSelectedLine}`);
  if (!currentCyNode || currentCyNode.empty()) {
    const firstLine = outlineLineOf(nodes[0]);
    if (firstLine !== undefined) view.selectNode(firstLine);
    return;
  }

  const currentPos = currentCyNode.position();
  let bestNode: NodeSingular | null = null;
  let bestScore = Infinity;

  nodes.forEach(n => {
    const node = n;
    if (!node.isNode?.() || node.id() === currentCyNode.id()) return;
    const pos = node.position();

    const dx = pos.x - currentPos.x;
    const dy = pos.y - currentPos.y;

    let distanceScore = Infinity;

    if (direction === 'right') {
      if (dx > 0) distanceScore = dx + Math.abs(dy) * 3;
    } else if (direction === 'left') {
      if (dx < 0) distanceScore = -dx + Math.abs(dy) * 3;
    } else if (direction === 'down') {
      if (dy > 0) distanceScore = dy + Math.abs(dx) * 3;
    } else if (direction === 'up') {
      if (dy < 0) distanceScore = -dy + Math.abs(dx) * 3;
    }

    if (distanceScore < bestScore) {
      bestScore = distanceScore;
      bestNode = node;
    }
  });

  if (bestNode) {
    const bestLine = outlineLineOf(bestNode);
    if (bestLine !== undefined) view.selectNode(bestLine);
  }
}
