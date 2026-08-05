import type { Core } from 'cytoscape';
import { Notice } from 'obsidian';
import type { HeadingSection } from '../utils/heading-sections';
import type { MindmapView } from './mindmap-view';
import { createEmbeddableMarkdownEditor } from '../editor/embeddable-markdown-editor';

interface RenderHeadingFrameOptions {
  attributeName?: 'overlay' | 'mindmapEomeOverlay';
  onEdit?: (section: HeadingSection, frame: HTMLElement) => void;
  onEmptyHeadingCreate?: (section: HeadingSection) => void;
  onEmptyHeadingDrop?: (section: HeadingSection, sourceLine: number) => void;
}

export function updateHeadingFrameGeometry(wrapper: HTMLElement, cy: Core): boolean {
  const zoom = cy.zoom();
  const pan = cy.pan();

  for (const frame of Array.from(wrapper.querySelectorAll<HTMLElement>('[data-heading-frame]'))) {
    const centerX = Number(frame.dataset.headingCenterX);
    const centerY = Number(frame.dataset.headingCenterY);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return false;

    frame.setCssProps({
      '--heading-frame-left': `${pan.x + centerX * zoom}px`,
      '--heading-frame-top': `${pan.y + centerY * zoom}px`,
      '--heading-frame-zoom': String(zoom),
    });
  }

  return true;
}

function isValidHeadingText(text: string): boolean {
  return /^#{1,6}\s+\S/.test(text.trim());
}

export function renderHeadingFrames(
  wrapper: HTMLElement,
  cy: Core,
  sections: HeadingSection[],
  sizeMap: Map<number, { w: number; h: number }>,
  options: RenderHeadingFrameOptions = {}
): void {
  wrapper.querySelectorAll('[data-heading-frame]').forEach((frame) => frame.remove());

  const zoom = cy.zoom();
  const pan = cy.pan();
  const attributeName = options.attributeName ?? 'overlay';
  const allNodeBounds = Array.from(sizeMap.keys()).reduce<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>((currentBounds, line) => {
    const node = cy.getElementById(`n${line}`);
    const dims = sizeMap.get(line);
    if (!dims || node.empty()) return currentBounds;

    const position = node.position();
    const nodeBounds = {
      left: position.x - dims.w / 2,
      top: position.y - dims.h / 2,
      right: position.x + dims.w / 2,
      bottom: position.y + dims.h / 2,
    };

    return currentBounds
      ? {
        left: Math.min(currentBounds.left, nodeBounds.left),
        top: Math.min(currentBounds.top, nodeBounds.top),
        right: Math.max(currentBounds.right, nodeBounds.right),
        bottom: Math.max(currentBounds.bottom, nodeBounds.bottom),
      }
      : nodeBounds;
  }, null);
  const emptyFrameWidth = 260;
  const emptyFrameHeight = 116;
  let nextEmptyFrameTop = (allNodeBounds?.bottom ?? 0) + 120;

  sections.forEach((section) => {
    const bounds = section.nodeLines.reduce<{
      left: number;
      top: number;
      right: number;
      bottom: number;
    } | null>((currentBounds, line) => {
      const node = cy.getElementById(`n${line}`);
      const dims = sizeMap.get(line);
      if (!dims || node.empty()) return currentBounds;

      const position = node.position();
      const halfWidth = dims.w / 2;
      const halfHeight = dims.h / 2;
      const nodeBounds = {
        left: position.x - halfWidth,
        top: position.y - halfHeight,
        right: position.x + halfWidth,
        bottom: position.y + halfHeight,
      };

      if (!currentBounds) return nodeBounds;

      return {
        left: Math.min(currentBounds.left, nodeBounds.left),
        top: Math.min(currentBounds.top, nodeBounds.top),
        right: Math.max(currentBounds.right, nodeBounds.right),
        bottom: Math.max(currentBounds.bottom, nodeBounds.bottom),
      };
    }, null);

    const padding = 24 + Math.max(0, 6 - section.level) * 6;
    const titleSpace = 34;
    const isEmptySection = !bounds;
    const emptyFrameOuterHeight = emptyFrameHeight + padding * 2 + titleSpace;
    const emptyLeft = allNodeBounds?.left ?? 0;
    const emptyContentTop = nextEmptyFrameTop + padding + titleSpace;
    const resolvedBounds = bounds ?? {
      left: emptyLeft,
      top: emptyContentTop,
      right: emptyLeft + emptyFrameWidth,
      bottom: emptyContentTop + emptyFrameHeight,
    };
    if (isEmptySection) {
      nextEmptyFrameTop += emptyFrameOuterHeight + 48;
    }

    const width = resolvedBounds.right - resolvedBounds.left + padding * 2;
    const height = resolvedBounds.bottom - resolvedBounds.top + padding * 2 + titleSpace;
    const centerX = resolvedBounds.left + (resolvedBounds.right - resolvedBounds.left) / 2;
    const centerY = resolvedBounds.top + (resolvedBounds.bottom - resolvedBounds.top) / 2 - titleSpace / 2;
    const frame = wrapper.createDiv();
    frame.className = 'mindmap-heading-frame';
    frame.classList.toggle('is-empty-heading-frame', isEmptySection);
    frame.dataset.headingFrame = '1';
    frame.dataset[attributeName] = '1';
    frame.dataset.headingLevel = String(section.level);
    frame.dataset.headingLine = String(section.line);
    frame.dataset.headingCenterX = String(centerX);
    frame.dataset.headingCenterY = String(centerY);
    frame.setCssProps({
      '--heading-frame-left': `${pan.x + centerX * zoom}px`,
      '--heading-frame-top': `${pan.y + centerY * zoom}px`,
      '--heading-frame-width': `${width}px`,
      '--heading-frame-height': `${height}px`,
      '--heading-frame-zoom': String(zoom),
    });

    const title = frame.createDiv();
    title.className = 'mindmap-heading-frame-title';
    title.addClass('markdown-rendered');
    title.createEl(`h${section.level}` as keyof HTMLElementTagNameMap, { text: section.text });
    if (options.onEdit) {
      title.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onEdit?.(section, frame);
      });
    }

    if (isEmptySection) {
      const dropTarget = frame.createEl('button');
      dropTarget.type = 'button';
      dropTarget.className = 'mindmap-empty-heading-drop-target';
      dropTarget.dataset.headingLine = String(section.line);
      dropTarget.textContent = 'Create new node';

      dropTarget.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onEmptyHeadingCreate?.(section);
      });

      dropTarget.addEventListener('dragenter', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropTarget.classList.add('mm-tgt');
      });
      dropTarget.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropTarget.classList.add('mm-tgt');
      });
      dropTarget.addEventListener('dragleave', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropTarget.classList.remove('mm-tgt');
      });
      dropTarget.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropTarget.classList.remove('mm-tgt');

        const sourceLine = Number(event.dataTransfer?.getData('text/mindmap-line'));
        if (!Number.isNaN(sourceLine)) {
          options.onEmptyHeadingDrop?.(section, sourceLine);
        }
      });

    }

  });
}

export function startHeadingEditing(
  frame: HTMLElement,
  section: HeadingSection,
  view: MindmapView,
  options: { selectHeadingTextOnly?: boolean } = {}
): void {
  if (frame.classList.contains('editing')) return;

  frame.classList.add('editing');
  const title = frame.querySelector('.mindmap-heading-frame-title');
  if (title) title.classList.add('mm-hidden');

  const editorHost = frame.createDiv();
  editorHost.className = 'mindmap-heading-editor node-editor-host';

  let finished = false;
  const closeEditor = () => {
    markdownEditor.destroy();
    editorHost.remove();
    title?.classList.remove('mm-hidden');
    frame.classList.remove('editing');
  };

  const finish = async (save: boolean) => {
    if (finished) return;
    finished = true;

    const newText = markdownEditor.value.trim();
    closeEditor();

    if (!save || newText === section.rawText) return;

    if (newText !== '' && !isValidHeadingText(newText)) {
      new Notice('Headings must start with 1-6 # characters followed by text.');
      return;
    }

    await view.executeEditHeadingCommand(section, newText);
  };

  const headingTextStart = options.selectHeadingTextOnly
    ? section.rawText.match(/^#{1,6}\s+/)?.[0].length ?? 0
    : 0;

  const markdownEditor = createEmbeddableMarkdownEditor(view.app, editorHost, {
    value: section.rawText,
    placeholder: '# Heading',
    cls: 'node-editor-cm',
    file: view.file,
    singleLine: true,
    cursorLocation: {
      anchor: headingTextStart,
      head: section.rawText.length,
    },
    onEnter: () => {
      void finish(true);
      return true;
    },
    onEscape: () => void finish(false),
    onBlur: () => void finish(true),
  });

  ['click', 'dblclick', 'dragstart', 'pointerdown'].forEach((eventName) => {
    editorHost.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });

  window.requestAnimationFrame(() => {
    markdownEditor.activeCM?.focus();
    markdownEditor.activate();
  });
}
