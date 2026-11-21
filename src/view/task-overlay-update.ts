import type { MindmapView } from './mindmap-view';
import type { OutlineNode } from '../utils/outline';
import { appendCheckboxToggle, updateCheckboxPresentation } from './node-overlay-controls';
import { savedZoomOnlyChanged } from '../storage/zoom-settings-change';

/** Task state has no effect on Markdown dimensions, positions or hierarchy. */
export function updateTaskOverlays(view: MindmapView): boolean {
  const cy = view.cy;
  if (!cy || cy.destroyed() || view.wrapper.querySelector('.editing')) return false;
  const nodes = view.getFlatNodes();
  if (nodes.length !== cy.nodes().length || view.wrapper.querySelectorAll('[data-overlay]').length !== nodes.length) return false;
  const boxes = new Map(Array.from(view.wrapper.querySelectorAll<HTMLElement>('[data-overlay]')).map(box => [Number(box.dataset.nodeLine), box]));
  const updates: { node: OutlineNode; rendered: OutlineNode; box: HTMLElement }[] = [];
  for (const node of nodes) {
    const rendered = cy.getElementById(`n${node.line}`).data('node') as OutlineNode | undefined;
    const box = boxes.get(node.line);
    if (!rendered || !box || rendered.text !== node.text || rendered.indent !== node.indent ||
      rendered.marker !== node.marker || rendered.ownEnd !== node.ownEnd || rendered.endLine !== node.endLine ||
      rendered.children.length !== node.children.length || rendered.children.some((child, i) => child.line !== node.children[i].line)) return false;
    updates.push({ node, rendered, box });
  }
  const before = updates[0]?.rendered.sourceDoc;
  const after = updates[0]?.node.sourceDoc;
  if (before === undefined || after === undefined) return false;
  if (before !== after) {
    const oldLines = before.split(/\r?\n/);
    const newLines = after.split(/\r?\n/);
    if (oldLines.length !== newLines.length) return false;
    for (const { node, rendered } of updates) {
      if (rendered.sourceDoc !== before || node.sourceDoc !== after) return false;
      oldLines[node.line] = newLines[node.line];
    }
    // Headings, frontmatter and document text must still take the full path.
    if (oldLines.join('\n') !== newLines.join('\n') && !savedZoomOnlyChanged(oldLines, newLines)) return false;
  }
  for (const { node, rendered, box } of updates) {
    const statusChanged = rendered.checkbox !== node.checkbox;
    // Existing event handlers retain this object. Refresh its snapshot too,
    // so a second click or subsequent drag never uses an obsolete source.
    Object.assign(rendered, node);
    updateCheckboxPresentation(box, rendered, view);
    if (statusChanged) {
      box.querySelector('.checkbox-toggle')?.remove();
      appendCheckboxToggle(box, rendered, view);
    }
  }
  view.updateSelectionStyling();
  return true;
}
