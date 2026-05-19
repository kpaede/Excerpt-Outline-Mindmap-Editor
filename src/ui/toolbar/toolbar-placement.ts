export function resetToolbarPlacement(wrapper: HTMLElement): void {
  const toolbar = wrapper.querySelector<HTMLElement>('.vertical-toolbar');
  wrapper.classList.remove('uses-side-toolbar', 'mindmap-toolbar-side', 'mindmap-toolbar-top');
  delete wrapper.dataset.toolbarPlacement;
  delete wrapper.dataset.toolbarMetrics;

  [document.documentElement, document.body].forEach((element) => {
    element.classList.remove('mindmap-touch-toolbar');
    element.classList.remove('mindmap-toolbar-side');
    element.classList.remove('mindmap-toolbar-top');
    delete element.dataset.mindmapToolbarPlacement;
  });

  wrapper.style.removeProperty('--mindmap-mobile-toolbar-top');
  wrapper.style.removeProperty('--mindmap-visual-height');
  wrapper.style.removeProperty('--mindmap-visual-width');
  document.documentElement.style.removeProperty('--mindmap-mobile-toolbar-top');
  document.documentElement.style.removeProperty('--mindmap-visual-height');
  document.documentElement.style.removeProperty('--mindmap-visual-width');
  toolbar?.removeAttribute('style');
  delete toolbar?.dataset.placement;
  delete toolbar?.dataset.metrics;
}
