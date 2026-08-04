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
  menu.setCssStyles({
    position: 'fixed',
    boxSizing: 'border-box',
    overflowY: 'auto',
    transform: 'none',
    maxWidth: 'none',
  });

  if (isLandscape) {
    menu.dataset.mobilePlacement = 'side';
    menu.setCssStyles({
      top: 'max(56px, calc(env(safe-area-inset-top) + 18px))',
      right: 'calc(env(safe-area-inset-right) + 64px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 14px)',
      left: 'auto',
      width: `min(${preferredWidth}px, calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 112px))`,
      maxHeight: 'none',
    });
    return true;
  }

  menu.dataset.mobilePlacement = 'bottom';
  menu.setCssStyles({
    top: 'auto',
    right: 'calc(env(safe-area-inset-right) + 12px)',
    bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
    left: 'calc(env(safe-area-inset-left) + 12px)',
    width: 'auto',
    maxHeight: 'min(58vh, calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 112px))',
  });
  return true;
}
