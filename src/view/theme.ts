import type { Core } from 'cytoscape';

/** Read the view's inherited theme, including body classes and host overrides.
 * Cytoscape draws to a canvas and cannot resolve CSS variables itself. */
export function mindmapLineColor(wrapper: HTMLElement): string {
  const css = wrapper.ownerDocument.defaultView?.getComputedStyle(wrapper);
  return css?.getPropertyValue('--mindmap-line-color').trim() ||
    css?.getPropertyValue('--text-muted').trim() ||
    css?.color || '#808080';
}

/** Update the canvas without replacing nodes, editors, selection or viewport. */
export function refreshMindmapTheme(wrapper: HTMLElement, cy: Core): void {
  if (cy.destroyed()) return;
  cy.style().selector('edge').style('line-color', mindmapLineColor(wrapper)).update();
}
