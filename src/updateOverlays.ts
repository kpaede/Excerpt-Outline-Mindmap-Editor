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
import { Notice } from 'obsidian';
import { CommandHistory } from './command-history';

export function updateOverlays(view: MindmapView): void {
  if (!view.cy) return;

  // Prevent multiple concurrent overlay updates
  if (view.isUpdatingOverlays) {
    return;
  }
  view.isUpdatingOverlays = true;

  // Use requestAnimationFrame to batch overlay updates
  requestAnimationFrame(() => {
    try {
      performOverlayUpdate(view);
    } finally {
      view.isUpdatingOverlays = false;
    }
  });
}

function performOverlayUpdate(view: MindmapView): void {
  // Remove all existing overlays before redrawing
  view.wrapper.querySelectorAll('[data-overlay]').forEach((e) => e.remove());

  const css = getComputedStyle(document.documentElement);
  const border = css.getPropertyValue('--background-modifier-border').trim() || '#888';
  const txt = css.getPropertyValue('--text-normal').trim() || '#000';
  const font = css.getPropertyValue('--font-family').trim() || 'inherit';
  const bg = css.getPropertyValue('--background-primary').trim() || '#fff';

  const zoom = view.cy!.zoom();

  // Parse current document to get valid line mappings
  const currentOutline = parseOutline(view.data);
  const flatCurrent: import('./util').OutlineNode[] = [];
  (function walk(arr: import('./util').OutlineNode[]) {
    arr.forEach((n) => {
      flatCurrent.push(n);
      walk(n.children);
    });
  })(currentOutline);

  // Create a map of valid line numbers from current document
  const validLines = new Set(flatCurrent.map(n => n.line));

  view.cy!.nodes().forEach((n) => {
    const nd = n.data('node') as import('./util').OutlineNode;
    
    // Enhanced validation for node data
    if (!nd || typeof nd.line === 'undefined' || nd.line < 0) {
        console.warn('Invalid node data detected, skipping overlay:', n.id(), nd);
        return;
    }
    
    // Check if this line number exists in current parsed outline
    if (!validLines.has(nd.line)) {
        console.warn('Node line number not found in current outline, skipping overlay:', nd.line);
        return;
    }
    
    // Find the corresponding node in current outline to ensure data consistency
    const currentNode = flatCurrent.find(cn => cn.line === nd.line);
    if (!currentNode) {
        console.warn('Node not found in current outline, skipping overlay:', nd.line);
        return;
    }
    
    // Update node data in cytoscape to match current document
    n.data('node', currentNode);
    const nodeToUse = currentNode;
    
    const nodeId = `n${nodeToUse.line}`;
    
    const p = n.renderedPosition();
    const dims = view.sizeMap.get(nodeToUse.line);

    // If dims are missing, skip this overlay
    if (!dims) {
        console.warn(`Dimensions not found in sizeMap for line ${nodeToUse.line}. Skipping overlay.`);
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
    // Remove pointerEvents: 'none' to allow interaction with embedded content
    md.dataset.text = nodeToUse.text;
    
    // Apply scale factor if it exists
    if (nodeToUse.scaleFactor && nodeToUse.scaleFactor !== 1) {
      md.style.transform = `scale(${nodeToUse.scaleFactor})`;
      md.style.transformOrigin = 'top left';
      md.style.width = `${100 / nodeToUse.scaleFactor}%`;
    }
    
    if (nodeToUse.text.trim() === '') {
      md.innerHTML = '&nbsp;';
    } else {
      // Sanitize text to prevent Verovio rendering errors
      let sanitizedText = nodeToUse.text;
      
      // Remove or escape problematic patterns that might trigger Verovio
      sanitizedText = sanitizedText.replace(/\|([^|]*)\|/g, '`$1`'); // Convert |text| to `text`
      sanitizedText = sanitizedText.replace(/%%[^%]*%%/g, ''); // Remove Obsidian comments
      
      // Use full Obsidian rendering for overlays
      MarkdownRenderer.render(
        view.app,
        sanitizedText,
        md,
        view.file?.path || '',
        view as Component
      ).then(() => {
        // Handle images in overlays
        md.querySelectorAll('img').forEach(img => {
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
        });
        
        // Handle internal links in overlays
        md.querySelectorAll('a.internal-link').forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const href = link.getAttribute('href');
            if (href && view.file) {
              view.app.workspace.openLinkText(href, view.file.path);
            }
          });
        });
        
        // Handle external links
        md.querySelectorAll('a:not(.internal-link)').forEach(link => {
          link.addEventListener('click', (e) => {
            e.stopPropagation();
          });
        });

        // Handle YouTube iframes and other interactive content
        md.querySelectorAll('iframe, video, audio, button, input, select, textarea').forEach(element => {
          element.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent overlay click events
          });
          element.addEventListener('dblclick', (e) => {
            e.stopPropagation(); // Prevent double-click editing
          });
        });

        // Handle code blocks with interactive content
        md.querySelectorAll('.verovio-container, pre code').forEach(element => {
          // Allow interaction with rendered content
          element.addEventListener('click', (e) => {
            // Only stop propagation if the click target is an interactive element
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'BUTTON' || 
                target.tagName === 'A' || 
                target.closest('button, a, [onclick]'))) {
              e.stopPropagation();
            }
          });
        });
      }).catch((error) => {
        console.warn('MarkdownRenderer failed, using plain text:', error);
        md.textContent = nodeToUse.text;
      });
    }
    
    box.insertBefore(md, box.firstChild);

    // Setup event handlers with improved drag and drop
    box.draggable = true;
    
    // Prevent child elements from being draggable
    box.addEventListener('dragstart', (e) => {
      // Ensure we're always dragging the entire node, not internal content
      if (e.target !== box) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      // Use current node data for drag operations
      e.dataTransfer!.setData('text/mindmap-line', String(nodeToUse.line));
      e.dataTransfer!.setData('text/mindmap-node-id', nodeId);
      
      // CRITICAL: Store comprehensive visual state for drag and drop
      const currentDims = view.sizeMap.get(nodeToUse.line);
      if (currentDims) {
        e.dataTransfer!.setData('text/mindmap-width', String(currentDims.w));
        e.dataTransfer!.setData('text/mindmap-height', String(currentDims.h));
      }
      
      // Store current cytoscape position to preserve layout
      const cyNode = view.cy?.getElementById(nodeId);
      if (cyNode) {
        const pos = cyNode.position();
        e.dataTransfer!.setData('text/mindmap-pos-x', String(pos.x));
        e.dataTransfer!.setData('text/mindmap-pos-y', String(pos.y));
      }
      
      // Store scale factor if it exists
      if (nodeToUse.scaleFactor) {
        e.dataTransfer!.setData('text/mindmap-scale', String(nodeToUse.scaleFactor));
      }
      
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

    // Improved drag event handling for better visual feedback
    let dragCounter = 0; // Track nested drag events
    
    box.addEventListener('dragend', () => {
      box.classList.remove('mm-src');
      dragCounter = 0; // Reset counter
    });
    
    box.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      box.classList.add('mm-tgt');
    });
    
    box.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      // Only remove the class when we've left all nested elements
      if (dragCounter <= 0) {
        dragCounter = 0;
        box.classList.remove('mm-tgt');
      }
    });
    
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Ensure the visual feedback stays active
      if (!box.classList.contains('mm-tgt')) {
        box.classList.add('mm-tgt');
      }
    });
    
    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('mm-tgt');
      dragCounter = 0;
      
      const srcLine = e.dataTransfer!.getData('text/mindmap-line');
      const srcNodeId = e.dataTransfer!.getData('text/mindmap-node-id');
      
      if (srcLine && srcNodeId) {
        if (!view.file) return;
        
        const srcNodeFromOutline = flatCurrent.find(n => n.line === parseInt(srcLine));
        if (srcNodeFromOutline && srcNodeFromOutline.line !== nodeToUse.line) {
          try {
            // Use the new command-based move operation
            await view.executeMoveSubtreeCommand(srcNodeFromOutline, nodeToUse, true);
          } catch (error) {
            console.error('Move subtree failed:', error);
            new Notice('Move failed: ' + (error.message || 'Unknown error'));
          }
        }
      } else {
        // Handle text drop (external content)
        const txtData = e.dataTransfer!.getData('text/plain').trim();
        if (txtData && view.file) {
          try {
            // Use the new command-based add child text operation
            await view.executeAddChildTextCommand(nodeToUse, txtData);
          } catch (error) {
            console.error('Add child text failed:', error);
            new Notice('Failed to add content: ' + (error.message || 'Unknown error'));
          }
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
        await view.executeAddChildCommand(nodeToUse);
      }),
      btn('→', async () => {
        await view.executeAddSiblingCommand(nodeToUse);
      })
    );

    del.onclick = async (e) => {
      e.stopPropagation();
      if (!view.file) return;
      new DeleteNodeModal(view.app, async (result: DeleteOption) => {
        if (!view.file) return;
        
        if (result === "full") {
          await view.executeDeleteNodeCommand(nodeToUse);
        } else {
          await view.executeDeleteNodeKeepChildrenCommand(nodeToUse);
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

    // Enhanced double-click to edit with single-line input
    box.addEventListener('dblclick', (e) => {
      // Check if the double-click was on an interactive element
      const target = e.target as HTMLElement;
      const isInteractiveElement = target.tagName === 'BUTTON' ||
                                   target.tagName === 'A' ||
                                   target.tagName === 'INPUT' ||
                                   target.tagName === 'SELECT' ||
                                   target.tagName === 'TEXTAREA' ||
                                   target.tagName === 'IFRAME' ||
                                   target.tagName === 'VIDEO' ||
                                   target.tagName === 'AUDIO' ||
                                   target.closest('button, a, input, select, textarea, iframe, video, audio, [onclick]') ||
                                   target.closest('.verovio-container');

      if (isInteractiveElement || target.closest('span[style*="cursor: pointer"]')) {
        return;
      }

      e.stopPropagation();
      e.preventDefault();

      const md = box.querySelector('div[data-text]') as HTMLElement;
      md.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = nodeToUse.text;
      Object.assign(input.style, {
        position: 'absolute',
        top: '6px',
        left: '10px',
        right: '10px',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontFamily: font,
        fontSize: '16px',
        color: txt,
        boxSizing: 'border-box',
      });

      box.appendChild(input);
      input.focus();
      input.select();

      const finish = async (save: boolean) => {
        const newText = input.value.trim();
        box.removeChild(input);
        md.style.display = 'block';

        if (save && newText !== nodeToUse.text && view.file) {
          await view.executeEditNodeCommand(nodeToUse, newText);
        }
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(true);
        } else if (ev.key === 'Escape') {
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
    });

    // Prevent internal elements from starting their own drag operations
    md.addEventListener('dragstart', (e) => {
      if (e.target !== box) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    });

    // Prevent internal links and other elements from interfering with node drag
    md.querySelectorAll('*').forEach(element => {
      element.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      });
      
      // Ensure draggable is explicitly disabled for internal elements
      if (element instanceof HTMLElement) {
        element.draggable = false;
      }
    });
  });
}
