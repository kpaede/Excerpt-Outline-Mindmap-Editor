import type { Core } from 'cytoscape';
import { Notice } from 'obsidian';
import type { HeadingSection } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import { createEmbeddableMarkdownEditor } from '../editor/embeddable-markdown-editor';

interface RenderHeadingFrameOptions {
  attributeName?: 'overlay' | 'mindmapEomeOverlay';
  onEdit?: (section: HeadingSection, frame: HTMLElement) => void;
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

    if (!bounds) return;

    const padding = 18 + Math.max(0, 6 - section.level);
    const titleSpace = 30;
    const width = bounds.right - bounds.left + padding * 2;
    const height = bounds.bottom - bounds.top + padding * 2 + titleSpace;
    const centerX = bounds.left + (bounds.right - bounds.left) / 2;
    const centerY = bounds.top + (bounds.bottom - bounds.top) / 2 - titleSpace / 2;
    const frame = document.createElement('div');
    frame.className = 'mindmap-heading-frame';
    frame.dataset.headingFrame = '1';
    frame.dataset[attributeName] = '1';
    frame.dataset.headingLevel = String(section.level);
    frame.dataset.headingLine = String(section.line);
    frame.style.setProperty('--heading-frame-left', `${pan.x + centerX * zoom}px`);
    frame.style.setProperty('--heading-frame-top', `${pan.y + centerY * zoom}px`);
    frame.style.setProperty('--heading-frame-width', `${width}px`);
    frame.style.setProperty('--heading-frame-height', `${height}px`);
    frame.style.setProperty('--heading-frame-zoom', String(zoom));

    const title = document.createElement('div');
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
    frame.appendChild(title);
    wrapper.appendChild(frame);
  });
}

export function startHeadingEditing(
  frame: HTMLElement,
  section: HeadingSection,
  view: MindmapView
): void {
  if (frame.classList.contains('editing')) return;

  frame.classList.add('editing');
  const title = frame.querySelector('.mindmap-heading-frame-title') as HTMLElement | null;
  if (title) title.classList.add('mm-hidden');

  const editorHost = document.createElement('div');
  editorHost.className = 'mindmap-heading-editor node-editor-host';
  frame.appendChild(editorHost);

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

    if (!isValidHeadingText(newText)) {
      new Notice('Headings must start with 1-6 # characters followed by text.');
      return;
    }

    await view.executeEditHeadingCommand(section, newText);
  };

  const markdownEditor = createEmbeddableMarkdownEditor(view.app, editorHost, {
    value: section.rawText,
    placeholder: '# Heading',
    cls: 'node-editor-cm',
    file: view.file,
    singleLine: true,
    cursorLocation: {
      anchor: 0,
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

  requestAnimationFrame(() => {
    markdownEditor.activeCM?.focus();
    markdownEditor.activate();
  });
}
