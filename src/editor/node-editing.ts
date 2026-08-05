import { Component, MarkdownRenderer, Notice } from 'obsidian';
import { openInternalLink, OutlineNode } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';
import {
  createEmbeddableMarkdownEditor,
  EmbeddableMarkdownEditor,
} from './embeddable-markdown-editor';

export function renderNodeMarkdown(
  container: HTMLElement,
  node: OutlineNode,
  view: MindmapView
): void {
  container.dataset.text = node.text;

  if (node.scaleFactor && node.scaleFactor !== 1) {
    container.setCssProps({ '--mindmap-scale': String(node.scaleFactor) });
  }

  if (node.text.trim() === '') {
    container.textContent = '\u00a0';
    return;
  }

  let sanitizedText = node.text;
  sanitizedText = sanitizedText.replace(/\|([^|]*)\|/g, '`$1`');
  sanitizedText = sanitizedText.replace(/%%[^%]*%%/g, '');

  MarkdownRenderer.render(
    view.app,
    sanitizedText,
    container,
    view.file?.path || '',
    view as Component
  ).then(() => {
    // Reapplied on every render, not once after a redraw: the overlay rebuild
    // replaces these elements wholesale, so a version stamped outside the
    // render is discarded by the very next pass.
    view.attachmentVersions.applyTo(container, view.app);

    container.querySelectorAll('a.internal-link').forEach(link => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const href = link.getAttribute('href');
        if (href && view.file) {
          void openInternalLink(view.app, href, view.file.path);
        }
      });
    });

    container.querySelectorAll('a:not(.internal-link)').forEach(link => {
      link.addEventListener('click', (event) => {
        event.stopPropagation();
      });
    });

    container.querySelectorAll('iframe, video, audio, button, input, select, textarea').forEach(element => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      element.addEventListener('dblclick', (event) => {
        event.stopPropagation();
      });
    });

    container.querySelectorAll('.verovio-container, pre code').forEach(element => {
      element.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target && (
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.closest('button, a, [onclick]')
        )) {
          event.stopPropagation();
        }
      });
    });
  }).catch((error) => {
    console.warn('MarkdownRenderer failed, using plain text:', error);
    container.textContent = node.text;
  });
}

export function startNodeEditing(
  box: HTMLElement,
  nodeToUse: OutlineNode,
  view: MindmapView,
  options: { isNewNode?: boolean } = {}
): EmbeddableMarkdownEditor | null {
  if (box.classList.contains('editing')) return null;

  box.classList.add('editing');
  box.draggable = false;

  const md = box.querySelector('div[data-text]') as HTMLElement;
  if (md) md.classList.add('mm-hidden');

  const editorHost = box.createDiv();
  editorHost.className = 'node-editor node-editor-host';

  const resizeEditor = () => {
    const scroller = editorHost.querySelector('.cm-scroller');
    if (!scroller) return;

    // Two steps on purpose: releasing the height lets the scroller take its
    // natural size, which is what the second assignment then measures.
    editorHost.setCssStyles({ height: 'auto' });
    editorHost.setCssStyles({
      height: `${Math.max(box.clientHeight - 22, scroller.scrollHeight)}px`,
    });
  };

  let finished = false;
  const closeEditor = () => {
    markdownEditor.destroy();
    if (box.contains(editorHost)) box.removeChild(editorHost);
    if (md) md.classList.remove('mm-hidden');
    box.classList.remove('editing');
    // A touch-capable device may still use a mouse or trackpad. Direct-input
    // contacts suppress native DnD only while their gesture is active.
    box.draggable = true;
  };

  const deleteCurrentNode = async () => {
    if (finished) return;
    finished = true;
    closeEditor();
    await view.deleteNodesWithConfirmation([nodeToUse]);
  };

  const finish = async (save: boolean) => {
    if (finished) return;
    finished = true;

    const rawText = markdownEditor.value;
    closeEditor();

    // Opening and closing a node without typing must leave it untouched. This
    // used to normalise unconditionally, so merely double-clicking a node
    // whose source spans several lines stripped those line breaks, announced
    // it, and wrote the collapsed text back - on Escape as well as on save.
    if (!save || rawText === nodeToUse.text) {
      if (save) view.selectNode(nodeToUse.line);
      return;
    }

    const newText = view.normalizeNodeText(rawText);
    if (newText !== nodeToUse.text && view.file) {
      await view.executeEditNodeCommand(nodeToUse, newText);
    }
    view.selectNode(nodeToUse.line);
  };

  const markdownEditor = createEmbeddableMarkdownEditor(view.app, editorHost, {
    value: nodeToUse.text,
    placeholder: 'Edit node',
    cls: 'node-editor-cm',
    file: view.file,
    singleLine: true,
    cursorLocation: {
      anchor: 0,
      head: nodeToUse.text.length,
    },
    onEnter: (_editor, _mod, shift) => {
      if (shift) {
        new Notice('Line breaks inside a node are not supported.');
        return true;
      }

      void finish(true);
      return true;
    },
    onEscape: () => {
      if (options.isNewNode && nodeToUse.children.length === 0) {
        void deleteCurrentNode();
      } else {
        void finish(false);
      }
    },
    onBlur: () => void finish(true),
    onChange: () => resizeEditor(),
  });

  // Pen/touch user activation is tied to the trusted pointerup. Focus the
  // already-created CodeMirror synchronously; the next frame is layout only.
  markdownEditor.activate();
  markdownEditor.activeCM?.focus();

  editorHost.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      void deleteCurrentNode();
    }
  }, { capture: true });

  ['click', 'dblclick', 'dragstart'].forEach((eventName) => {
    editorHost.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });
  editorHost.addEventListener('wheel', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, passive: false });

  window.requestAnimationFrame(() => {
    resizeEditor();

    const scrollContainers: Array<{ element: HTMLElement; left: number; top: number }> = [];
    let ancestor: HTMLElement | null = box.parentElement;

    while (ancestor) {
      if (ancestor.scrollWidth > ancestor.clientWidth || ancestor.scrollHeight > ancestor.clientHeight) {
        scrollContainers.push({
          element: ancestor,
          left: ancestor.scrollLeft,
          top: ancestor.scrollTop,
        });
      }

      ancestor = ancestor.parentElement;
    }

    if (!markdownEditor.activeCM?.hasFocus) {
      markdownEditor.activeCM?.focus();
    }

    scrollContainers.forEach(({ element, left, top }) => {
      element.scrollLeft = left;
      element.scrollTop = top;
    });
  });

  return markdownEditor;
}
