import { Platform } from 'obsidian';

export function shouldUseMobileMenuLayout(): boolean {
  return Boolean(
    Platform.isMobile ||
    Platform.isMobileApp ||
    Platform.isPhone ||
    Platform.isTablet ||
    window.matchMedia?.('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0
  );
}

export function applyMobileMenuPosition(menu: HTMLElement, preferredWidth: number): boolean {
  if (!shouldUseMobileMenuLayout()) return false;

  const viewport = window.visualViewport;
  const viewportWidth = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth);
  const viewportHeight = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
  const isLandscape = viewportWidth > viewportHeight;

  menu.classList.add('mindmap-mobile-options-menu');
  menu.style.position = 'fixed';
  menu.style.boxSizing = 'border-box';
  menu.style.overflowY = 'auto';
  menu.style.transform = 'none';
  menu.style.maxWidth = 'none';

  if (isLandscape) {
    menu.dataset.mobilePlacement = 'side';
    menu.style.top = 'max(56px, calc(env(safe-area-inset-top) + 18px))';
    menu.style.right = 'calc(env(safe-area-inset-right) + 64px)';
    menu.style.bottom = 'calc(env(safe-area-inset-bottom) + 14px)';
    menu.style.left = 'auto';
    menu.style.width = `min(${preferredWidth}px, calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 112px))`;
    menu.style.maxHeight = 'none';
    return true;
  }

  menu.dataset.mobilePlacement = 'bottom';
  menu.style.top = 'auto';
  menu.style.right = 'calc(env(safe-area-inset-right) + 12px)';
  menu.style.bottom = 'calc(env(safe-area-inset-bottom) + 12px)';
  menu.style.left = 'calc(env(safe-area-inset-left) + 12px)';
  menu.style.width = 'auto';
  menu.style.maxHeight = 'min(58vh, calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 112px))';
  return true;
}
