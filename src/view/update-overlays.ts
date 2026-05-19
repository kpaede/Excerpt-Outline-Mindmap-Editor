import { setIcon, Notice } from 'obsidian';
import { parseOutline, OutlineNode } from '../utils/outline';
import { MindmapView } from './mindmap-view';
import { DeleteNodeModal, DeleteOption } from "../ui/modals/delete-node-modal";
import { renderNodeMarkdown, startNodeEditing } from '../editor/node-editing';
import { clearDropPreview, DropIntent, DropPointer, getDropIntent, getOverlayAtPoint, updateDropPreview } from './overlay-dnd';
import { getPrimaryZoteroLink } from '../utils/zotero';

export { startNodeEditing };

export function updateOverlays(view: MindmapView): void {
  if (!view.cy) return;

  if (view.wrapper.querySelector('.node-editor') || document.querySelector('.mindmap-mobile-editor')) {
    return;
  }

  // Prevent multiple concurrent overlay updates
  if (view.isUpdatingOverlays) {
    return;
  }
  view.isUpdatingOverlays = true;

  // Use requestAnimationFrame to batch overlay updates
  requestAnimationFrame(() => {
    try {
      const isTouchViewportGesture =
        view.wrapper.classList.contains('is-touch-panning') ||
        view.wrapper.classList.contains('is-touch-pinching') ||
        view.wrapper.classList.contains('is-touch-dragging');

      if (isTouchViewportGesture && updateOverlayGeometry(view)) {
        return;
      }

      performOverlayUpdate(view);
    } finally {
      view.isUpdatingOverlays = false;
    }
  });
}

function updateOverlayGeometry(view: MindmapView): boolean {
  if (!view.cy) return false;

  const overlays = new Map<number, HTMLElement>();
  view.wrapper.querySelectorAll<HTMLElement>('[data-overlay][data-node-line]').forEach((overlay) => {
    const line = Number(overlay.dataset.nodeLine);
    if (!Number.isNaN(line)) {
      overlays.set(line, overlay);
    }
  });

  if (overlays.size === 0 || overlays.size !== view.cy.nodes().length) {
    return false;
  }

  const zoom = view.cy.zoom();

  for (const node of view.cy.nodes()) {
    const outlineNode = node.data('node') as OutlineNode | undefined;
    if (!outlineNode || typeof outlineNode.line !== 'number') {
      return false;
    }

    const overlay = overlays.get(outlineNode.line);
    const dims = view.sizeMap.get(outlineNode.line);
    if (!overlay || !dims) {
      return false;
    }

    const position = node.renderedPosition();
    overlay.style.setProperty('--mindmap-left', `${position.x}px`);
    overlay.style.setProperty('--mindmap-top', `${position.y}px`);
    overlay.style.setProperty('--mindmap-box-width', `${dims.w}px`);
    overlay.style.setProperty('--mindmap-box-height', `${dims.h}px`);
    overlay.style.setProperty('--mindmap-zoom', String(zoom));
  }

  return true;
}

function performOverlayUpdate(view: MindmapView): void {
  // Remove all existing overlays before redrawing
  view.wrapper.querySelectorAll('[data-overlay]').forEach((e) => e.remove());

  const css = getComputedStyle(document.documentElement);
  const txt = css.getPropertyValue('--text-normal').trim() || '#000';
  const font = css.getPropertyValue('--font-family').trim() || 'inherit';
  const bg = css.getPropertyValue('--background-primary').trim() || '#fff';

  const zoom = view.cy!.zoom();

  // Parse current document to get valid line mappings
  const currentOutline = parseOutline(view.data);
  const flatCurrent: OutlineNode[] = [];
  (function walk(arr: OutlineNode[]) {
    arr.forEach((n) => {
      flatCurrent.push(n);
      walk(n.children);
    });
  })(currentOutline);

  // Create a map of valid line numbers from current document
  const validLines = new Set(flatCurrent.map(n => n.line));

  let pendingEdit: {
    box: HTMLElement;
    node: OutlineNode;
  } | null = null;

  view.cy!.nodes().forEach((n) => {
    const nd = n.data('node') as OutlineNode;
    
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
    box.dataset.nodeLine = String(nodeToUse.line);
    view.wrapper.appendChild(box);

    // Update position and styling using CSS variables where possible
    box.classList.add('mindmap-overlay');
    // Dynamic position variables for CSS positioning
    box.style.setProperty('--mindmap-left', `${p.x}px`);
    box.style.setProperty('--mindmap-top', `${p.y}px`);
    box.style.setProperty('--mindmap-box-width', `${dims.w}px`);
    box.style.setProperty('--mindmap-box-height', `${dims.h}px`);
    box.style.setProperty('--mindmap-zoom', String(zoom));
    box.style.setProperty('--mindmap-border', '#000000');
    box.style.setProperty('--mindmap-bg', bg);
    box.style.setProperty('--mindmap-color', txt);
    if (font) {
      box.style.setProperty('--mindmap-font', font);
    }
    box.style.setProperty('--mindmap-font-size', '16px');
    box.style.setProperty('--mindmap-box-shadow', '0 1px 3px rgba(0,0,0,.08)');

    const hasCheckbox = nodeToUse.checkbox !== 'none';
    const isCheckboxHoverable = !hasCheckbox && view.generalSettings.showCheckboxesOnHover;

    box.classList.toggle('has-checkbox', hasCheckbox);
    box.classList.toggle('checkbox-hoverable', isCheckboxHoverable);
    box.classList.toggle('checkbox-checked', nodeToUse.checkbox === 'checked');

    const checkboxToggle = document.createElement('button');
    checkboxToggle.type = 'button';
    checkboxToggle.className = 'checkbox-toggle';
    checkboxToggle.setAttribute('aria-label', nodeToUse.checkbox === 'checked' ? 'Uncheck task' : 'Toggle checkbox');
    checkboxToggle.setAttribute('title', nodeToUse.checkbox === 'checked' ? 'Uncheck task' : 'Toggle checkbox');
    setIcon(checkboxToggle, nodeToUse.checkbox === 'checked' ? 'square-check-big' : 'square');
    const toggleCheckbox = async () => {
      if (!view.file) return;
      await view.toggleNodeCheckbox(nodeToUse);
    };
    checkboxToggle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    checkboxToggle.addEventListener('pointerup', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggleCheckbox();
    });
    checkboxToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    box.appendChild(checkboxToggle);

    if (view.selectedNodeLines.has(nodeToUse.line)) {
      box.classList.add('selected');
    }

    if (view.pendingEditNodeLine === nodeToUse.line) {
      pendingEdit = { box, node: nodeToUse };
    }

    const primaryZoteroLink = getPrimaryZoteroLink(nodeToUse.text);
    if (primaryZoteroLink) {
      const zoteroBadge = document.createElement('button');
      zoteroBadge.className = 'mindmap-zotero-badge';
      zoteroBadge.setAttribute('type', 'button');
      zoteroBadge.setAttribute('aria-label', 'Open Zotero source');
      zoteroBadge.setAttribute('title', 'Open Zotero source');
      zoteroBadge.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <polygon fill="currentColor" points="13.863 2.73 13.027 1 2.137 1 2.137 3.8 2.137 3.921 8.822 3.921 1.289 13.233 2.137 15 13.863 15 13.863 12.142 13.863 12.021 6.448 12.021 13.863 2.73"/>
        </svg>
      `;
      zoteroBadge.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open(primaryZoteroLink, '_blank');
      });
      box.appendChild(zoteroBadge);
    }

    const md = document.createElement('div');
    renderNodeMarkdown(md, nodeToUse, view);

    box.classList.add('mindmap-overlay');
    box.insertBefore(md, box.firstChild);

    const isTouchDevice = view.wrapper.classList.contains('is-touch-device');

    // Setup event handlers with improved drag and drop
    box.draggable = !isTouchDevice;
    
    // Prevent child elements from being draggable
    box.addEventListener('dragstart', (e) => {
      if (isTouchDevice) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

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
      clearDropPreview(box);
      dragCounter = 0; // Reset counter
    });
    
    box.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      box.classList.add('mm-tgt');
      updateDropPreview(e, box);
    });
    
    box.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      // Only remove the class when we've left all nested elements
      if (dragCounter <= 0) {
        dragCounter = 0;
        box.classList.remove('mm-tgt');
        clearDropPreview(box);
      }
    });
    
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Ensure the visual feedback stays active
      if (!box.classList.contains('mm-tgt')) {
        box.classList.add('mm-tgt');
      }
      updateDropPreview(e, box);
    });
    
    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dropIntent = getDropIntent(e, box);
      box.classList.remove('mm-tgt');
      clearDropPreview(box);
      dragCounter = 0;
      
      const srcLine = e.dataTransfer!.getData('text/mindmap-line');
      const srcNodeId = e.dataTransfer!.getData('text/mindmap-node-id');
      
      if (srcLine && srcNodeId) {
        if (!view.file) return;
        
        const srcNodeFromOutline = flatCurrent.find(n => n.line === parseInt(srcLine));
        if (srcNodeFromOutline && srcNodeFromOutline.line !== nodeToUse.line) {
          try {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            // Use the new command-based move operation
            await view.executeMoveSubtreeCommand(
              srcNodeFromOutline,
              nodeToUse,
              dropIntent.kind === 'child',
              dropIntent.kind === 'child' ? dropIntent.childInsertPosition : 'last',
              dropIntent.kind === 'sibling' ? dropIntent.siblingInsertPosition : 'after'
            );
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
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            // Use the new command-based add child text operation
            if (dropIntent.kind === 'sibling') {
              await view.executeAddSiblingTextCommand(nodeToUse, txtData, dropIntent.siblingInsertPosition);
            } else {
              await view.executeAddChildTextCommand(nodeToUse, txtData, dropIntent.childInsertPosition);
            }
          } catch (error) {
            console.error('Add child text failed:', error);
            new Notice('Failed to add content: ' + (error.message || 'Unknown error'));
          }
        }
      }
    });

    // Add control elements
    const ctr = document.createElement('div');
    ctr.className = 'node-controls';

    const del = document.createElement('span');
    del.textContent = '×';
    del.className = 'mindmap-node-delete';

    const btn = (icon: string, label: string, f: () => void) => {
      const s = document.createElement('span');
      s.className = 'mindmap-node-control';
      s.setAttribute('aria-label', label);
      s.setAttribute('title', label);
      // Layout and cursor handled via CSS classes
      setIcon(s, icon);
      s.onclick = async (e) => {
        e.stopPropagation();
        if (!view.file) return;
        f();
      };
      return s;
    };

    ctr.append(
      btn('plus', 'Add child', async () => {
        await view.executeAddChildCommand(nodeToUse);
      }),
      btn('git-pull-request-create', 'Add sibling', async () => {
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
      box.classList.add('hovering');
    };
    box.onmouseleave = () => {
      box.classList.remove('hovering');
    };

    let suppressNextTouchDblClick = false;

    if (isTouchDevice) {
      let longPressTimer: number | null = null;
      let touchDragActive = false;
      let touchDragGhost: HTMLElement | null = null;
      let touchDropTarget: HTMLElement | null = null;
      let touchDropIntent: DropIntent | null = null;
      let touchStartX = 0;
      let touchStartY = 0;
      let lastTapAt = 0;
      let suppressNextClick = false;
      let touchDragAbortController: AbortController | null = null;
      let touchDragLastPoint: { clientX: number; clientY: number } | null = null;
      let touchDragPointerId: number | null = null;
      let longPressAbortController: AbortController | null = null;
      let touchDragGhostSize: { width: number; height: number } | null = null;

      const clearLongPressTimer = () => {
        if (longPressTimer === null) return;
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressAbortController?.abort();
        longPressAbortController = null;
      };

      const clearTouchDropTarget = () => {
        if (!touchDropTarget) return;
        touchDropTarget.classList.remove('mm-tgt');
        clearDropPreview(touchDropTarget);
        touchDropTarget = null;
        touchDropIntent = null;
        touchDragGhost?.classList.remove('is-over-target');
      };

      const removeTouchDragGhost = () => {
        if (touchDragGhost?.parentElement) {
          touchDragGhost.remove();
        }
        touchDragGhost = null;
      };

      const finishTouchDrag = () => {
        clearLongPressTimer();
        clearTouchDropTarget();
        removeTouchDragGhost();
        box.classList.remove('mm-src');
        view.wrapper.classList.remove('is-touch-dragging');
        view.wrapper.dispatchEvent(new CustomEvent('mindmap-touch-drag-end'));
        touchDragActive = false;
        touchDragAbortController?.abort();
        touchDragAbortController = null;
        touchDragLastPoint = null;
        touchDragPointerId = null;
        touchDragGhostSize = null;
      };

      const moveTouchDragGhost = (event: PointerEvent) => {
        if (!touchDragGhost) return;
        touchDragGhost.style.setProperty('--touch-drag-left', `${event.clientX}px`);
        touchDragGhost.style.setProperty('--touch-drag-top', `${event.clientY}px`);
      };

      const updateTouchDragGhostScale = () => {
        if (!touchDragGhost) return;

        const size = touchDragGhostSize ?? (() => {
          const boxRect = box.getBoundingClientRect();
          touchDragGhostSize = {
            width: Math.max(80, Math.round(boxRect.width * 0.92)),
            height: Math.max(40, Math.round(boxRect.height * 0.92)),
          };
          return touchDragGhostSize;
        })();

        touchDragGhost.style.setProperty('--touch-drag-width', `${size.width}px`);
        touchDragGhost.style.setProperty('--touch-drag-height', `${size.height}px`);
      };

      const updateTouchDropTarget = (event: DropPointer) => {
        const nextTarget = getOverlayAtPoint(event.clientX, event.clientY);
        if (nextTarget === box) {
          clearTouchDropTarget();
          return;
        }

        if (nextTarget !== touchDropTarget) {
          clearTouchDropTarget();
          touchDropTarget = nextTarget;
          if (touchDropTarget) {
            touchDropTarget.classList.add('mm-tgt');
          }
        }

        if (touchDropTarget) {
          touchDragGhost?.classList.add('is-over-target');
          touchDropIntent = updateDropPreview(event, touchDropTarget);
        }
      };

      const startTouchDrag = (event: PointerEvent) => {
        longPressTimer = null;
        touchDragActive = true;
        touchDragPointerId = event.pointerId;
        suppressNextClick = true;
        view.selectNode(nodeToUse.line);
        box.classList.add('mm-src');
        view.wrapper.classList.add('is-touch-dragging');
        view.wrapper.dispatchEvent(new CustomEvent('mindmap-touch-drag-start', {
          detail: { pointerId: event.pointerId },
        }));
        touchDragAbortController?.abort();
        touchDragAbortController = new AbortController();
        touchDragLastPoint = { clientX: event.clientX, clientY: event.clientY };
        view.wrapper.addEventListener('mindmap-touch-viewport-change', () => {
          if (!touchDragActive || !touchDragLastPoint) return;
          updateTouchDragGhostScale();
          updateTouchDropTarget(touchDragLastPoint);
        }, {
          signal: touchDragAbortController.signal,
        });
        window.addEventListener('pointermove', (pointerEvent) => {
          if (
            pointerEvent.pointerType !== 'touch' ||
            pointerEvent.pointerId !== touchDragPointerId ||
            !touchDragActive
          ) {
            return;
          }

          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
          touchDragLastPoint = { clientX: pointerEvent.clientX, clientY: pointerEvent.clientY };
          moveTouchDragGhost(pointerEvent);
          updateTouchDropTarget(pointerEvent);
        }, {
          passive: false,
          signal: touchDragAbortController.signal,
        });

        touchDragGhost = document.createElement('div');
        touchDragGhost.className = 'mindmap-touch-drag-ghost';
        const mdClone = md.cloneNode(true) as HTMLElement;
        mdClone.classList.add('mindmap-touch-drag-ghost-content');
        mdClone.style.removeProperty('--mindmap-scale');
        touchDragGhost.appendChild(mdClone);
        document.body.appendChild(touchDragGhost);
        updateTouchDragGhostScale();
        moveTouchDragGhost(event);
      };

      const completeTouchDrag = async (event: PointerEvent) => {
        if (
          event.pointerType !== 'touch' ||
          event.pointerId !== touchDragPointerId ||
          !touchDragActive
        ) return;

        event.preventDefault();
        event.stopPropagation();

        const targetBox = touchDropTarget;
        const dropIntent = touchDropIntent;
        finishTouchDrag();

        const targetLine = Number(targetBox?.dataset.nodeLine);
        const targetNode = Number.isNaN(targetLine) ? null : flatCurrent.find(n => n.line === targetLine);
        const srcNodeFromOutline = flatCurrent.find(n => n.line === nodeToUse.line);

        if (view.file && srcNodeFromOutline && targetNode && targetNode.line !== srcNodeFromOutline.line && dropIntent) {
          try {
            await view.executeMoveSubtreeCommand(
              srcNodeFromOutline,
              targetNode,
              dropIntent.kind === 'child',
              dropIntent.kind === 'child' ? dropIntent.childInsertPosition : 'last',
              dropIntent.kind === 'sibling' ? dropIntent.siblingInsertPosition : 'after'
            );
          } catch (error) {
            console.error('Touch move subtree failed:', error);
            new Notice('Move failed: ' + (error.message || 'Unknown error'));
          }
        }
      };

      box.addEventListener('pointerdown', (event) => {
        if (
          event.pointerType !== 'touch' ||
          box.classList.contains('editing') ||
          view.wrapper.classList.contains('is-touch-pinching')
        ) return;

        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, select, textarea, iframe, video, audio, [contenteditable="true"]')) {
          return;
        }

        touchStartX = event.clientX;
        touchStartY = event.clientY;
        clearLongPressTimer();
        longPressAbortController = new AbortController();
        view.wrapper.addEventListener('mindmap-touch-gesture-start', clearLongPressTimer, {
          signal: longPressAbortController.signal,
        });

        longPressTimer = window.setTimeout(() => {
          if (
            view.wrapper.classList.contains('is-touch-pinching') ||
            view.wrapper.classList.contains('is-touch-panning')
          ) {
            clearLongPressTimer();
            return;
          }

          startTouchDrag(event);
          window.addEventListener('pointerup', (pointerEvent) => {
            void completeTouchDrag(pointerEvent);
          }, { signal: touchDragAbortController?.signal });
          window.addEventListener('pointercancel', (pointerEvent) => {
            if (
              pointerEvent.pointerType === 'touch' &&
              pointerEvent.pointerId === touchDragPointerId
            ) finishTouchDrag();
          }, { signal: touchDragAbortController?.signal });
        }, 420);
      }, { passive: true });

      box.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'touch') return;

        const deltaX = Math.abs(event.clientX - touchStartX);
        const deltaY = Math.abs(event.clientY - touchStartY);

        if (!touchDragActive && view.wrapper.classList.contains('is-touch-pinching')) {
          clearLongPressTimer();
          return;
        }

        if (
          !touchDragActive &&
          (deltaX > 3 || deltaY > 3 || view.wrapper.classList.contains('is-touch-panning'))
        ) {
          clearLongPressTimer();
          return;
        }

        if (!touchDragActive) return;
        if (event.pointerId !== touchDragPointerId) return;

        event.preventDefault();
        event.stopPropagation();
        touchDragLastPoint = { clientX: event.clientX, clientY: event.clientY };
        moveTouchDragGhost(event);
        updateTouchDropTarget(event);
      }, { passive: false });

      box.addEventListener('pointerup', async (event) => {
        if (event.pointerType !== 'touch') return;

        const wasDragging = touchDragActive;
        const hadPendingLongPress = longPressTimer !== null;
        clearLongPressTimer();

        if (wasDragging) {
          await completeTouchDrag(event);
          return;
        }

        const target = event.target as HTMLElement;
        const tapDeltaX = Math.abs(event.clientX - touchStartX);
        const tapDeltaY = Math.abs(event.clientY - touchStartY);
        const checkboxHitPadding = 22;
        const checkboxRect = checkboxToggle.getBoundingClientRect();
        const isNearCheckbox =
          hasCheckbox &&
          tapDeltaX <= 10 &&
          tapDeltaY <= 10 &&
          event.clientX >= checkboxRect.left - checkboxHitPadding &&
          event.clientX <= checkboxRect.right + checkboxHitPadding &&
          event.clientY >= checkboxRect.top - checkboxHitPadding &&
          event.clientY <= checkboxRect.bottom + checkboxHitPadding;

        if (isNearCheckbox) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClick = true;
          await toggleCheckbox();
          return;
        }

        if (
          !hadPendingLongPress ||
          target.closest('button, a, input, select, textarea, iframe, video, audio, [contenteditable="true"]')
        ) {
          return;
        }

        const now = Date.now();
        if (now - lastTapAt < 360) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClick = true;
          suppressNextTouchDblClick = true;
          view.selectNode(nodeToUse.line);
          const contextEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
          });
          box.dispatchEvent(contextEvent);
          lastTapAt = 0;
          window.setTimeout(() => {
            suppressNextTouchDblClick = false;
          }, 450);
          return;
        }

        lastTapAt = now;
      });

      box.addEventListener('pointercancel', finishTouchDrag);

      box.addEventListener('click', (event) => {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
      }, { capture: true });
    }

    box.addEventListener('wheel', (e) => {
      const target = e.target as HTMLElement;
      if (box.classList.contains('editing')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (target.closest('input, textarea, select, pre, code, iframe, video, audio')) {
        return;
      }

      const cyContainer = view.cy?.container();
      if (!cyContainer) return;

      e.preventDefault();
      e.stopPropagation();

      cyContainer.dispatchEvent(new WheelEvent(e.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        button: e.button,
        buttons: e.buttons,
      }));
    }, { passive: false });

    box.addEventListener('click', (e) => {
      if (
        view.wrapper.classList.contains('is-touch-dragging') ||
        view.wrapper.classList.contains('is-touch-panning') ||
        view.wrapper.classList.contains('is-touch-pan-suppressed')
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const target = e.target as HTMLElement;
      if (
        box.classList.contains('editing') ||
        target.closest('.mindmap-node-control') ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'A'
      ) {
        return;
      }

      e.stopPropagation();
      view.selectNode(nodeToUse.line, e.shiftKey || e.metaKey || e.ctrlKey);
    });

    // Enhanced double-click to edit with single-line input
    box.addEventListener('dblclick', (e) => {
      if (view.wrapper.classList.contains('is-touch-dragging')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (box.classList.contains('editing')) {
        return;
      }

      if (suppressNextTouchDblClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressNextTouchDblClick = false;
        return;
      }

      view.clearSelection();

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

      startNodeEditing(box, nodeToUse, view);
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

  if (pendingEdit) {
    view.pendingEditNodeLine = null;
    view.clearSelection();
    requestAnimationFrame(() => {
      startNodeEditing(pendingEdit!.box, pendingEdit!.node, view, { isNewNode: true });
    });
  }
}
