import { parseOutline, OutlineNode } from '../utils/outline';
import { parseHeadingSections } from '../utils/heading-sections';
import { MindmapView } from './mindmap-view';
import { renderNodeMarkdown, startNodeEditing } from '../editor/node-editing';
import { clearDropPreview, DropIntent, DropPointer, updateDropPreview } from './overlay-dnd';
import { isMoveTargetInsideSourceSubtree } from '../domain/mindmap-file';
import { renderHeadingFrames, startHeadingEditing, updateHeadingFrameGeometry } from './heading-frames';
import { attachDesktopNodeDndHandlers } from './node-desktop-dnd';
import { appendCheckboxToggle, appendNodeControls, appendZoteroBadge } from './node-overlay-controls';

export { startNodeEditing };

export function updateOverlays(view: MindmapView): void {
  if (!view.cy || view.cy.destroyed() || !view.wrapper?.isConnected) return;
  view.dismissNodeContextMenu();

  if (view.wrapper.querySelector('.node-editor, .mindmap-heading-editor')) {
    return;
  }

  // Prevent multiple concurrent overlay updates
  if (view.isUpdatingOverlays) {
    return;
  }
  view.isUpdatingOverlays = true;

  // The view owns this frame so a newer render, reset, or close can cancel it.
  const scheduled = view.requestOverlayUpdateFrame(() => {
    try {
      const isTouchViewportGesture = view.isDirectViewportGestureActive() || view.isDirectNodeDragActive();

      if (isTouchViewportGesture && updateOverlayGeometry(view)) {
        return;
      }

      performOverlayUpdate(view);
    } finally {
      view.isUpdatingOverlays = false;
    }
  });
  if (!scheduled) {
    view.isUpdatingOverlays = false;
  }
}

export function updateOverlayGeometry(view: MindmapView): boolean {
  if (!view.cy || view.cy.destroyed() || !view.wrapper?.isConnected) return false;

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
    overlay.setCssProps({
      '--mindmap-left': `${position.x}px`,
      '--mindmap-top': `${position.y}px`,
      '--mindmap-box-width': `${dims.w}px`,
      '--mindmap-box-height': `${dims.h}px`,
      '--mindmap-zoom': String(zoom),
    });
  }

  return updateHeadingFrameGeometry(view.wrapper, view.cy);
}

function performOverlayUpdate(view: MindmapView): void {
  // Any full rebuild invalidates overlay elements retained by an in-flight
  // direct gesture. End that gesture before replacing the DOM.
  view.resetDirectGestures();
  // Remove all existing overlays before redrawing
  view.wrapper.querySelectorAll('[data-overlay]').forEach((e) => e.remove());

  const doc = view.wrapper.ownerDocument;
  const css = doc.defaultView?.getComputedStyle(doc.documentElement) ?? getComputedStyle(doc.documentElement);
  const txt = css.getPropertyValue('--text-normal').trim() || '#000';
  const font = css.getPropertyValue('--font-family').trim() || 'inherit';
  const bg = css.getPropertyValue('--background-primary').trim() || '#fff';
  const border = css.getPropertyValue('--background-modifier-border').trim() || txt;

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
  const getCurrentNodeByLine = (line: number): OutlineNode | undefined => flatCurrent.find(n => n.line === line);
  renderHeadingFrames(view.wrapper, view.cy!, parseHeadingSections(view.data), view.sizeMap, {
    onEdit: (section, frame) => startHeadingEditing(frame, section, view),
    onEmptyHeadingCreate: (section) => {
      void view.executeCreateNodeInEmptyHeadingCommand(section.line);
    },
    onEmptyHeadingDrop: (section, sourceLine) => {
      const sourceNode = getCurrentNodeByLine(sourceLine);
      if (!sourceNode) return;
      void view.executeMoveSubtreeToEmptyHeadingCommand(sourceNode, section.line);
    },
  });

  const pendingEdit: {
    current: { box: HTMLElement; node: OutlineNode } | null;
  } = { current: null };
  let activeDraggedNodeLine: number | null = null;

  const isInvalidMoveTarget = (source: OutlineNode, target: OutlineNode): boolean => (
    source.line === target.line || isMoveTargetInsideSourceSubtree(source, target)
  );
  const setInvalidDropPreview = (targetBox: HTMLElement): void => {
    clearDropPreview(targetBox);
    targetBox.classList.add('mm-tgt-invalid');
  };
  const updateMoveDropPreview = (
    event: DropPointer,
    targetBox: HTMLElement,
    targetNode: OutlineNode,
    sourceLine: number | null
  ): DropIntent | null => {
    const sourceNode = sourceLine === null ? undefined : getCurrentNodeByLine(sourceLine);
    if (sourceNode && isInvalidMoveTarget(sourceNode, targetNode)) {
      setInvalidDropPreview(targetBox);
      return null;
    }

    targetBox.classList.remove('mm-tgt-invalid');
    return updateDropPreview(event, targetBox, { targetHasChildren: targetNode.children.length > 0 });
  };

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
    const box = view.wrapper.createDiv();
    box.dataset.overlay = '1';
    box.dataset.nodeId = nodeId;
    box.dataset.nodeLine = String(nodeToUse.line);

    // Update position and styling using CSS variables where possible
    box.classList.add('mindmap-overlay');
    box.createDiv({ cls: 'mindmap-node-selection-ring', attr: { 'aria-hidden': 'true' } });
    // Dynamic position variables for CSS positioning
    box.setCssProps({
      '--mindmap-left': `${p.x}px`,
      '--mindmap-top': `${p.y}px`,
      '--mindmap-box-width': `${dims.w}px`,
      '--mindmap-box-height': `${dims.h}px`,
      '--mindmap-zoom': String(zoom),
      '--mindmap-border': border,
      '--mindmap-bg': bg,
      '--mindmap-color': txt,
    });
    if (font) {
      box.setCssProps({ '--mindmap-font': font });
    }
    box.setCssProps({
      '--mindmap-font-size': '16px',
      '--mindmap-box-shadow': '0 1px 3px rgba(0,0,0,.08)',
    });

    appendCheckboxToggle(box, nodeToUse, view);

    if (view.selectedNodeLines.has(nodeToUse.line)) {
      box.classList.add('selected');
    }

    if (view.pendingEditNodeLine === nodeToUse.line) {
      pendingEdit.current = { box, node: nodeToUse };
    }

    appendZoteroBadge(box, nodeToUse);

    const md = box.createDiv({ prepend: true });
    box.classList.add('mindmap-overlay');
    // Inserted before rendering. Markdown post-processors are free to skip
    // work for elements that are not in the document - Excalidraw drops any
    // embed whose placeholder is disconnected - and rendering into a detached
    // div first left that up to how far into the render the first await lands.
    renderNodeMarkdown(md, nodeToUse, view);

    attachDesktopNodeDndHandlers({
      view,
      box,
      nodeToUse,
      nodeId,
      flatCurrent,
      getActiveDraggedNodeLine: () => activeDraggedNodeLine,
      setActiveDraggedNodeLine: (line) => {
        activeDraggedNodeLine = line;
      },
      isInvalidMoveTarget,
      updateMoveDropPreview,
    });

    appendNodeControls(box, nodeToUse, view);
    box.onmouseenter = () => {
      box.classList.add('hovering');
    };
    box.onmouseleave = () => {
      box.classList.remove('hovering');
    };

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
      if (view.isDirectGestureBlockingNodeClick()) {
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

    // Mouse and trackpad keep the browser's native double-click path on every
    // device, including iPads with an attached pointer device.
    box.addEventListener('dblclick', (e) => {
      if (view.isDirectNodeDragActive()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (box.classList.contains('editing')) {
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

      view.dismissNodeContextMenu();
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
      if ('draggable' in element) {
        element.draggable = false;
      }
    });
  });

  if (pendingEdit.current) {
    const edit = pendingEdit.current;
    view.requestPostOverlayFrame(() => {
      if (!edit.box.isConnected) return;
      view.pendingEditNodeLine = null;
      view.clearSelection();
      startNodeEditing(edit.box, edit.node, view, { isNewNode: true });
    });
  }
}
