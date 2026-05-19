import { Component, MarkdownRenderer, Notice } from 'obsidian';
import { openInternalLink, OutlineNode } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';
import { createEmbeddableMarkdownEditor } from './embeddable-markdown-editor';

export function renderNodeMarkdown(
  container: HTMLElement,
  node: OutlineNode,
  view: MindmapView
): void {
  container.dataset.text = node.text;

  if (node.scaleFactor && node.scaleFactor !== 1) {
    container.style.setProperty('--mindmap-scale', String(node.scaleFactor));
  }

  if (node.text.trim() === '') {
    container.innerHTML = '&nbsp;';
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

function startMobileNodeEditing(
  box: HTMLElement,
  nodeToUse: OutlineNode,
  view: MindmapView,
  options: { isNewNode?: boolean } = {}
): void {
  if (box.classList.contains('editing')) return;

  box.classList.add('editing');
  box.draggable = false;

  const editor = document.createElement('div');
  editor.className = 'mindmap-mobile-editor';

  const panel = editor.createDiv({ cls: 'mindmap-mobile-editor-panel' });
  panel.createDiv({ cls: 'mindmap-mobile-editor-title', text: 'Edit node' });

  const inputContainer = document.createElement('div');
  inputContainer.className = 'mindmap-mobile-editor-textarea';
  inputContainer.style.overflow = 'auto';
  inputContainer.style.width = '100%';
  panel.appendChild(inputContainer);

  let finished = false;
  let markdownEditor: ReturnType<typeof createEmbeddableMarkdownEditor> | null = null;

  const finish = async (save: boolean) => {
    if (finished) return;
    finished = true;

    const newText = view.normalizeNodeText(markdownEditor?.value ?? nodeToUse.text);
    closeEditor();

    if (save && newText !== nodeToUse.text && view.file) {
      await view.executeEditNodeCommand(nodeToUse, newText);
    }

    if (save) {
      view.selectNode(nodeToUse.line);
    } else if (options.isNewNode && nodeToUse.children.length === 0) {
      await view.deleteNodesWithConfirmation([nodeToUse]);
    }
  };

  const updatePanelMaxHeight = () => {
    const visualViewport = window.visualViewport;
    const visualHeight = visualViewport
      ? Math.min(visualViewport.height, window.innerHeight, document.documentElement.clientHeight || window.innerHeight)
      : Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    const offsetTop = visualViewport?.offsetTop ?? 0;
    const mobileSheetCap = Math.max(260, Math.round(window.innerHeight * 0.58));
    const viewportHeight = Math.max(160, Math.min(visualHeight, mobileSheetCap));

    editor.style.height = `${viewportHeight}px`;
    editor.style.top = `${offsetTop}px`;
    editor.style.bottom = 'auto';

    if (viewportHeight < 450) {
      editor.style.paddingTop = '12px';
      editor.style.paddingBottom = '12px';
      editor.style.alignItems = 'center';
    } else {
      editor.style.paddingTop = '';
      editor.style.paddingBottom = '8px';
      editor.style.alignItems = '';
    }

    const overlayTop = parseFloat(getComputedStyle(editor).paddingTop) || 0;
    const overlayBottom = parseFloat(getComputedStyle(editor).paddingBottom) || 0;
    const maxPanelHeight = Math.max(120, viewportHeight - overlayTop - overlayBottom);
    panel.style.maxHeight = `${maxPanelHeight}px`;
    panel.style.height = `${maxPanelHeight}px`;

    const maxTextareaHeight = maxPanelHeight - actions.offsetHeight - 52;
    inputContainer.style.maxHeight = `${Math.max(48, maxTextareaHeight)}px`;
  };

  const actions = panel.createDiv({ cls: 'mindmap-mobile-editor-actions' });
  const cancelButton = actions.createEl('button', { text: 'Cancel' });
  const saveButton = actions.createEl('button', { text: 'Save' });
  saveButton.addClass('mod-cta');
  updatePanelMaxHeight();

  const detachViewportListeners = () => {
    window.removeEventListener('resize', updatePanelMaxHeight);
    window.removeEventListener('orientationchange', updatePanelMaxHeight);
    window.visualViewport?.removeEventListener('resize', updatePanelMaxHeight);
    window.visualViewport?.removeEventListener('scroll', updatePanelMaxHeight);
  };

  const closeEditor = () => {
    detachViewportListeners();
    markdownEditor?.destroy();
    markdownEditor = null;
    editor.remove();
    box.classList.remove('editing');
    box.draggable = false;
  };

  editor.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  editor.addEventListener('click', (event) => {
    if (event.target === editor) {
      void finish(true);
      return;
    }

    event.stopPropagation();
  });

  cancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    void finish(false);
  });
  saveButton.addEventListener('click', (event) => {
    event.preventDefault();
    void finish(true);
  });

  document.body.appendChild(editor);
  window.addEventListener('resize', updatePanelMaxHeight);
  window.addEventListener('orientationchange', updatePanelMaxHeight);
  window.visualViewport?.addEventListener('resize', updatePanelMaxHeight);
  window.visualViewport?.addEventListener('scroll', updatePanelMaxHeight);

  requestAnimationFrame(() => {
    markdownEditor = createEmbeddableMarkdownEditor(view.app, inputContainer, {
      value: nodeToUse.text,
      placeholder: 'Edit node',
      cls: 'mindmap-mobile-editor-cm',
      file: view.file,
      onEscape: () => void finish(false),
      onEnter: (_editor, mod) => {
        if (mod) {
          void finish(true);
          return true;
        }
        return false;
      }
    });

    updatePanelMaxHeight();
    markdownEditor.activate();
    markdownEditor.activeCM?.focus();
    window.setTimeout(updatePanelMaxHeight, 250);
    window.setTimeout(updatePanelMaxHeight, 600);
  });
}

export function startNodeEditing(
  box: HTMLElement,
  nodeToUse: OutlineNode,
  view: MindmapView,
  options: { isNewNode?: boolean } = {}
): void {
  if (box.classList.contains('editing')) return;

  if (view.wrapper.classList.contains('is-touch-device')) {
    startMobileNodeEditing(box, nodeToUse, view, options);
    return;
  }

  box.classList.add('editing');
  box.draggable = false;

  const md = box.querySelector('div[data-text]') as HTMLElement;
  if (md) md.classList.add('mm-hidden');

  const editorHost = document.createElement('div');
  editorHost.className = 'node-editor node-editor-host';
  box.appendChild(editorHost);

  const resizeEditor = () => {
    const scroller = editorHost.querySelector('.cm-scroller') as HTMLElement | null;
    if (!scroller) return;

    editorHost.style.height = 'auto';
    editorHost.style.height = `${Math.max(box.clientHeight - 22, scroller.scrollHeight)}px`;
  };

  let finished = false;
  const closeEditor = () => {
    markdownEditor.destroy();
    if (box.contains(editorHost)) box.removeChild(editorHost);
    if (md) md.classList.remove('mm-hidden');
    box.classList.remove('editing');
    box.draggable = !view.wrapper.classList.contains('is-touch-device');
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

    const newText = view.normalizeNodeText(markdownEditor.value);
    closeEditor();

    if (save && newText !== nodeToUse.text && view.file) {
      await view.executeEditNodeCommand(nodeToUse, newText);
    }

    if (save) {
      view.selectNode(nodeToUse.line);
    }
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

  requestAnimationFrame(() => {
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

    markdownEditor.activeCM?.focus();
    markdownEditor.activate();

    scrollContainers.forEach(({ element, left, top }) => {
      element.scrollLeft = left;
      element.scrollTop = top;
    });
  });
}
