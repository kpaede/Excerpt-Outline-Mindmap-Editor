import type { MindmapView } from './mindmap-view';

/** Do not fit a hidden tab or make a large outline unreadably small on open. */
export function initializeViewport(view: MindmapView): void {
  const cy = view.cy;
  if (!cy || view.firstFitDone) return;
  const rectangle = cy.container()?.getBoundingClientRect();
  if (!rectangle || rectangle.width < 2 || rectangle.height < 2) return;
  cy.resize();
  const savedZoom = view.layoutOptions.zoomFactor;
  if (typeof savedZoom === 'number' && savedZoom > 0) {
    cy.zoom(savedZoom);
    cy.center(cy.elements());
  } else {
    cy.fit(cy.elements(), 50);
    if (cy.zoom() < 0.25) {
      cy.zoom(0.65);
      const first = cy.nodes().first();
      cy.center(first);
    } else cy.center(cy.elements());
  }
  view.firstFitDone = true;
  view.rememberCurrentZoom(false);
}
