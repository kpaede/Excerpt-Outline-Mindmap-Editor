import { MarkdownRenderer, Notice } from 'obsidian';
import { openInternalLink, OutlineNode } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';
import { NodeEditSession } from './node-edit-session';
import { cursorIsInMarkdownList, waitForListContext } from './list-context';
import { nodeMarkdown } from './node-markdown';
import { useSingleLineEditor } from './editing-mode';
import {
  createEmbeddableMarkdownEditor,
  EmbeddableMarkdownEditor,
} from './embeddable-markdown-editor';

export function renderNodeMarkdown(
  container: HTMLElement,
  node: OutlineNode,
  view: MindmapView
): void {
  container.classList.add('markdown-rendered', 'mindmap-node-content');
  container.dataset.text = node.text;

  if (node.scaleFactor && node.scaleFactor !== 1) {
    container.setCssProps({ '--mindmap-scale': String(node.scaleFactor) });
  }

  if (node.text.trim() === '') {
    container.textContent = '\u00a0';
    return;
  }

  const sanitizedText = nodeMarkdown(node);

  const renderScope = view.nodeRenderResources.current();
  MarkdownRenderer.render(
    view.app,
    sanitizedText,
    container,
    view.file?.path || '',
    renderScope
  ).then(() => {
    if (!view.nodeRenderResources.isCurrent(renderScope) || !container.isConnected) return;
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
    if (!view.nodeRenderResources.isCurrent(renderScope)) return;
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
  const current = view.getFlatNodes().find(node => nodeToUse.id ? node.id === nodeToUse.id : node.line === nodeToUse.line);
  if (!current) { view.updateOverlays(); return null; }
  // DOM callbacks can outlive a source edit. Use the current node and freeze
  // this edit's source snapshot; never silently advance it during a save.
  nodeToUse = { ...current };
  const openingDoc = view.data;
  const openingFile = view.file?.path;
  const editingMode = view.generalSettings.nodeEditingMode;
  const isSingleLine = (text: string) => useSingleLineEditor(editingMode, text);

  box.classList.add('editing');
  box.draggable = false;

  const md = box.querySelector('div[data-text]') as HTMLElement;
  if (md) md.classList.add('mm-hidden');

  const editorHost = box.createDiv();
  editorHost.className = 'node-editor node-editor-host';
  const minimumEditorHeight = Math.min(640, Math.max(48, box.clientHeight - 22));
  editorHost.setCssStyles({ minHeight: `${minimumEditorHeight}px` });
  const updateMode = (classic: boolean) => {
    editorHost.classList.toggle('is-single-line', classic);
  };
  updateMode(isSingleLine(nodeToUse.text));

  const resizeEditor = () => {
    const cm = markdownEditor.activeCM;
    if (!cm) return;
    editorHost.setCssStyles({
      height: `${Math.min(640, Math.max(minimumEditorHeight, cm.contentHeight + 12))}px`,
    });
  };

  let unregisterCloser = () => {};
  let layoutFrame: number | null = null;
  const closeEditor = () => {
    unregisterCloser();
    if (layoutFrame !== null) {
      window.cancelAnimationFrame(layoutFrame);
      layoutFrame = null;
    }
    markdownEditor.destroy();
    if (box.contains(editorHost)) box.removeChild(editorHost);
    if (md) md.classList.remove('mm-hidden');
    box.classList.remove('editing');
    // A touch-capable device may still use a mouse or trackpad. Direct-input
    // contacts suppress native DnD only while their gesture is active.
    box.draggable = true;
  };

  const session = new NodeEditSession(nodeToUse.text, {
    save: async text => {
      if (view.file?.path !== openingFile) throw new Error('The active file changed. Reopen the original note before saving this draft.');
      if (view.file) await view.executeEditNodeCommand(nodeToUse, view.normalizeNodeText(text));
    },
    close: closeEditor,
    refresh: async () => {
      if (view.file?.path !== openingFile) return;
      await view.reloadDataIncremental();
      if (view.data !== openingDoc) view.updateOverlays();
    },
    select: () => {
      if (view.file?.path !== openingFile) return;
      if (view.wrapper.querySelector('.node-editor, .mindmap-heading-editor')) return;
      const current = view.getFlatNodes().find(node => node.id === nodeToUse.id);
      if (current) view.selectNode(current.line);
    },
    saving: value => markdownEditor.setReadOnly(value),
    error: error => {
      new Notice(error instanceof Error ? error.message : 'Save failed. Your draft is still in the editor.');
      if (session.isEditing) markdownEditor.activeCM?.focus();
    },
  });
  const finish = (save: boolean) => session.finish(save, markdownEditor.value);
  const deleteCurrentNode = async () => {
    if (!session.isEditing) return;
    session.dispose();
    await view.deleteNodesWithConfirmation([nodeToUse]);
  };

  let parsingEnter = false;
  const markdownEditor = createEmbeddableMarkdownEditor(view.app, editorHost, {
    value: nodeToUse.text,
    placeholder: 'Edit node',
    cls: 'node-editor-cm',
    file: view.file,
    singleLine: isSingleLine(nodeToUse.text),
    cursorLocation: {
      anchor: 0,
      head: nodeToUse.text.length,
    },
    onEnter: (editor, mod, shift) => {
      if (!session.isEditing) return true;
      if (editingMode === 'single-line' && editor.activeCM.state.doc.lines === 1) {
        void finish(true);
        return true;
      }
      if (shift && !mod) {
        editor.activeCM.dispatch(editor.activeCM.state.replaceSelection('\n'));
        return true;
      }
      if (!mod) {
        const context = cursorIsInMarkdownList(editor.activeCM.state);
        if (context === true) return false;
        if (context === null) {
          if (!parsingEnter) {
            parsingEnter = true;
            void waitForListContext(() => editor.activeCM.state, () => session.isEditing && editorHost.isConnected).then(inList => {
              parsingEnter = false;
              if (inList === undefined || !session.isEditing) return;
              if (inList) editor.activeCM.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
              }));
              else void finish(true);
            }).catch((error: unknown) => {
              parsingEnter = false;
              new Notice(error instanceof Error ? error.message : 'Could not determine the list context. Your draft is retained.');
            });
          }
          return true;
        }
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
    onChange: update => {
      updateMode(editingMode === 'single-line' && update.state.doc.lines === 1);
      // Changes can arrive while the editor constructor is still setting up.
      if (update.view.dom.isConnected) {
        editorHost.setCssStyles({ height: `${Math.min(640, Math.max(minimumEditorHeight, update.view.contentHeight + 12))}px` });
      }
    },
  });

  unregisterCloser = view.registerTransientCloser(() => session.dispose());

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
    event.stopPropagation();
  }, { capture: true, passive: true });

  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = null;
    if (!editorHost.isConnected || !session.isEditing) return;
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
