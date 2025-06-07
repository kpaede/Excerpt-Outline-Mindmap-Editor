// src/updateOverlays.ts

import { MarkdownRenderer, Component } from 'obsidian';
import { parseOutline } from './util';
import { MindmapView } from './mindmapView';
import {
  addChild,
  addSibling,
  writeNode,
  deleteNode,
  moveSubtree,
  addChildText,
  deleteNodeKeepChildren,
} from './mindmap-file';
import { DeleteNodeModal, DeleteOption } from "./delete-node-modal";

export function updateOverlays(view: MindmapView): void {
  if (!view.cy) return;

  // Remove all existing overlays before redrawing
  view.wrapper.querySelectorAll('[data-overlay]').forEach((e) => e.remove());

  const css = getComputedStyle(document.documentElement);
  const border = css.getPropertyValue('--background-modifier-border').trim() || '#888';
  const txt = css.getPropertyValue('--text-normal').trim() || '#000';
  const font = css.getPropertyValue('--font-family').trim() || 'inherit';
  const bg = css.getPropertyValue('--background-primary').trim() || '#fff';

  const zoom = view.cy.zoom();

  view.cy.nodes().forEach((n) => {
    const nd = n.data('node') as import('./util').OutlineNode;
    // If nd is undefined, it means the node might be new or data is not yet set.
    // This can happen if updateOverlays is called before cy node data is fully populated.
    // However, draw() and incrementalUpdate() should ensure 'node' data is set.
    if (!nd || typeof nd.line === 'undefined') {
        // console.warn('Node data missing or incomplete for overlay:', n.id(), n.data());
        return; // Skip creating overlay for nodes without proper data
    }
    const nodeId = `n${nd.line}`;
    
    const p = n.renderedPosition();
    const dims = view.sizeMap.get(nd.line);

    // If dims are missing, it's an issue. Log and skip.
    // This should ideally be caught earlier in draw/incrementalUpdate.
    if (!dims) {
        // console.warn(`Dimensions not found in sizeMap for line ${nd.line}. Skipping overlay.`);
        return;
    }

    // Always create a new box, as all old ones were removed
    const box = document.createElement('div');
    box.dataset.overlay = '1';
    box.dataset.nodeId = nodeId;
    view.wrapper.appendChild(box);

    // Update position and styling
    Object.assign(box.style, {
      position: 'absolute',
      left: `${p.x}px`,
      top: `${p.y}px`,
      transform: `translate(-50%,-50%) scale(${zoom})`,
      transformOrigin: 'center center',
      width: `${dims.w}px`,
      height: `${dims.h}px`,
      padding: '6px 10px 22px',
      border: `1px solid ${border}`,
      borderRadius: '4px',
      background: bg,
      color: txt,
      fontFamily: font,
      fontSize: '16px',
      whiteSpace: 'normal',
      wordWrap: 'break-word',
      boxShadow: '0 1px 3px rgba(0,0,0,.08)',
      zIndex: '10',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    // Update content (always recreate)
    const md = document.createElement('div');
    md.style.pointerEvents = 'none';
    md.dataset.text = nd.text; // Store text for potential debugging or future use
    
    if (nd.text.trim() === '') {
      md.innerHTML = '&nbsp;';
    } else {
      MarkdownRenderer.renderMarkdown(
        nd.text,
        md,
        view.file!.path,
        (view as unknown) as Component
      );
    }
    box.insertBefore(md, box.firstChild);

    // Setup event handlers (always add for new boxes)
    box.draggable = true;
      
    box.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/mindmap-line', String(nd.line));
      box.classList.add('mm-src');

      const rect = box.getBoundingClientRect();
      const clone = box.cloneNode(true) as HTMLElement;
      Object.assign(clone.style, {
        position: 'absolute',
        top: '-9999px',
        left: '-9999px',
        zoom: '50%',
      });
      document.body.appendChild(clone);

      const offsetX = rect.width / 4;
      const offsetY = rect.height / 4;
      e.dataTransfer!.setDragImage(clone, offsetX, offsetY);

      setTimeout(() => {
        if (clone.parentElement) clone.parentElement.removeChild(clone);
      }, 0);
    });

    box.addEventListener('dragend', () => box.classList.remove('mm-src'));
    box.addEventListener('dragenter', () => box.classList.add('mm-tgt'));
    box.addEventListener('dragleave', () => box.classList.remove('mm-tgt'));
    box.addEventListener('dragover', (e) => e.preventDefault());
    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      box.classList.remove('mm-tgt');
      const srcLine = e.dataTransfer!.getData('text/mindmap-line');
      if (srcLine) {
        if (!view.file) return;
        const srcNode = (view.cy!.nodes(`#n${srcLine}`)[0]?.data('node')) as import('./util').OutlineNode | undefined;
        if (srcNode && srcNode.line !== nd.line) {
          // Always insert as child for drag and drop
          const insertAsChild = true;
          view.applyDocIncremental(await moveSubtree(view.app, view.file, srcNode, nd, insertAsChild));
        }
      } else {
        const txtData = e.dataTransfer!.getData('text/plain').trim();
        if (txtData && view.file) {
          view.applyDocIncremental(await addChildText(view.app, view.file, nd, txtData));
        }
      }
    });

    // Add control elements
    const ctr = document.createElement('div');
    Object.assign(ctr.style, {
      position: 'absolute',
      bottom: '2px',
      width: '100%',
      textAlign: 'center',
      fontSize: '14px',
      display: 'none',
    });

    const del = document.createElement('span');
    del.textContent = '×';
    Object.assign(del.style, {
      position: 'absolute',
      top: '4px',
      right: '6px',
      cursor: 'pointer',
      display: 'none',
    });

    const btn = (l: string, f: () => void) => {
      const s = document.createElement('span');
      s.textContent = l;
      s.style.cursor = 'pointer';
      s.onclick = async (e) => {
        e.stopPropagation();
        if (!view.file) return;
        f();
      };
      return s;
    };

    ctr.append(
      btn('↓', async () => {
        view.applyDocIncremental(await addChild(view.app, view.file!, nd));
      }),
      btn('→', async () => {
        view.applyDocIncremental(await addSibling(view.app, view.file!, nd));
      })
    );

    del.onclick = async (e) => {
      e.stopPropagation();
      if (!view.file) return;
      new DeleteNodeModal(view.app, async (result: DeleteOption) => {
        if (!view.file) return;
        if (result === "full") {
          view.applyDocIncremental(await deleteNode(view.app, view.file, nd));
        } else if (result === "single") {
          view.applyDocIncremental(await deleteNodeKeepChildren(view.app, view.file, nd));
        }
      }).open();
    };

    box.append(ctr, del);
    box.onmouseenter = () => {
      ctr.style.display = del.style.display = 'block';
    };
    box.onmouseleave = () => {
      ctr.style.display = del.style.display = 'none';
    };

    // Double-click to edit
    box.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('span')) return;

      const md = box.querySelector('div[data-text]') as HTMLElement;
      md.style.display = 'none';

      const textarea = document.createElement('textarea');
      textarea.value = nd.text;
      Object.assign(textarea.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontFamily: font,
        fontSize: '16px',
        lineHeight: '1.2',
        color: txt,
        whiteSpace: 'normal',
        wordWrap: 'break-word',
        resize: 'none',
        boxSizing: 'border-box',
        padding: '6px 10px 22px',
      });

      box.appendChild(textarea);
      textarea.focus();

      const finish = async (save: boolean) => {
        const newText = textarea.value.trim();
        box.removeChild(textarea);
        md.style.display = 'block';

        if (save && newText !== nd.text && view.file) {
          view.applyDocIncremental(await writeNode(view.app, view.file, nd, newText));
        }
      };

      textarea.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(true);
        } else if (ev.key === 'Escape') {
          finish(false);
        }
      });
      textarea.addEventListener('blur', () => finish(true));
    });
  });

  // Remove overlays for nodes that no longer exist (handled by clearing all at the start)
}
