import { Notice } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import { clearDropPreview, DropIntent, DropPointer, getDropIntent } from './overlay-dnd';

interface AttachDesktopNodeDndOptions {
  view: MindmapView;
  box: HTMLElement;
  nodeToUse: OutlineNode;
  nodeId: string;
  flatCurrent: OutlineNode[];
  getActiveDraggedNodeLine: () => number | null;
  setActiveDraggedNodeLine: (line: number | null) => void;
  isInvalidMoveTarget: (source: OutlineNode, target: OutlineNode) => boolean;
  updateMoveDropPreview: (
    event: DropPointer,
    targetBox: HTMLElement,
    targetNode: OutlineNode,
    sourceLine: number | null
  ) => DropIntent | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function attachDesktopNodeDndHandlers({
  view,
  box,
  nodeToUse,
  nodeId,
  flatCurrent,
  getActiveDraggedNodeLine,
  setActiveDraggedNodeLine,
  isInvalidMoveTarget,
  updateMoveDropPreview,
}: AttachDesktopNodeDndOptions): void {
  // Keep native HTML DnD available to a mouse/trackpad even when the same
  // device also has a touchscreen. The direct-input coordinator disables it
  // only for the lifetime of an actual touch/Pencil contact.
  box.draggable = true;

  box.addEventListener('dragstart', (event) => {
    if (event.target !== box) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    view.dismissNodeContextMenu();

    event.dataTransfer!.setData('text/mindmap-line', String(nodeToUse.line));
    event.dataTransfer!.setData('text/mindmap-node-id', nodeId);

    const currentDims = view.sizeMap.get(nodeToUse.line);
    if (currentDims) {
      event.dataTransfer!.setData('text/mindmap-width', String(currentDims.w));
      event.dataTransfer!.setData('text/mindmap-height', String(currentDims.h));
    }

    const cyNode = view.cy?.getElementById(nodeId);
    if (cyNode) {
      const pos = cyNode.position();
      event.dataTransfer!.setData('text/mindmap-pos-x', String(pos.x));
      event.dataTransfer!.setData('text/mindmap-pos-y', String(pos.y));
    }

    if (nodeToUse.scaleFactor) {
      event.dataTransfer!.setData('text/mindmap-scale', String(nodeToUse.scaleFactor));
    }

    setActiveDraggedNodeLine(nodeToUse.line);
    box.classList.add('mm-src');

    const rect = box.getBoundingClientRect();
    const clone = box.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      position: 'absolute',
      top: '-9999px',
      left: '-9999px',
      zoom: '50%',
    });
    box.ownerDocument.body.appendChild(clone);

    event.dataTransfer!.setDragImage(clone, rect.width / 4, rect.height / 4);

    const ownerWindow = box.ownerDocument.defaultView;
    if (ownerWindow) {
      ownerWindow.setTimeout(() => clone.remove(), 0);
    } else {
      clone.remove();
    }
  });

  let dragCounter = 0;

  box.addEventListener('dragend', () => {
    box.classList.remove('mm-src');
    clearDropPreview(box);
    setActiveDraggedNodeLine(null);
    dragCounter = 0;
  });

  box.addEventListener('dragenter', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter++;
    box.classList.add('mm-tgt');
    updateMoveDropPreview(event, box, nodeToUse, getActiveDraggedNodeLine());
  });

  box.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter--;

    if (dragCounter <= 0) {
      dragCounter = 0;
      box.classList.remove('mm-tgt');
      clearDropPreview(box);
    }
  });

  box.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!box.classList.contains('mm-tgt')) {
      box.classList.add('mm-tgt');
    }
    updateMoveDropPreview(event, box, nodeToUse, getActiveDraggedNodeLine());
  });

  box.addEventListener('drop', (event) => {
    void (async () => {
      event.preventDefault();
      event.stopPropagation();
      const dropIntent = getDropIntent(event, box, { targetHasChildren: nodeToUse.children.length > 0 });
      box.classList.remove('mm-tgt');
      clearDropPreview(box);
      dragCounter = 0;

      const srcLine = event.dataTransfer!.getData('text/mindmap-line');
      const srcNodeId = event.dataTransfer!.getData('text/mindmap-node-id');

      if (srcLine && srcNodeId) {
        if (!view.file) return;

        const srcNodeFromOutline = flatCurrent.find((node) => node.line === parseInt(srcLine, 10));
        if (srcNodeFromOutline && srcNodeFromOutline.line !== nodeToUse.line) {
          if (isInvalidMoveTarget(srcNodeFromOutline, nodeToUse)) {
            new Notice('Cannot move a node into its own children.');
            return;
          }

          try {
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
            await view.executeMoveSubtreeCommand(
              srcNodeFromOutline,
              nodeToUse,
              dropIntent.kind === 'child',
              dropIntent.kind === 'child' ? dropIntent.childInsertPosition : 'last',
              dropIntent.kind === 'sibling' ? dropIntent.siblingInsertPosition : 'after'
            );
          } catch (error) {
            console.error('Move subtree failed:', error);
            new Notice('Move failed: ' + errorMessage(error));
          }
        }
        return;
      }

      const txtData = event.dataTransfer!.getData('text/plain').trim();
      if (txtData && view.file) {
        try {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          if (dropIntent.kind === 'sibling') {
            await view.executeAddSiblingTextCommand(nodeToUse, txtData, dropIntent.siblingInsertPosition);
          } else {
            await view.executeAddChildTextCommand(nodeToUse, txtData, dropIntent.childInsertPosition);
          }
        } catch (error) {
          console.error('Add child text failed:', error);
          new Notice('Failed to add content: ' + errorMessage(error));
        }
      }
  
    })();
  });
}
