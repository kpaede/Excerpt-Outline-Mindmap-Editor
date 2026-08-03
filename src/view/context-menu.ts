import { Menu } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import {
  addDrawingAsChild,
  addDrawingAsSibling,
  addExcalidrawAsChild,
  addExcalidrawAsSibling,
  editNodeContent,
  warmDrawingEditor,
} from '../drawing/drawing-actions';
import { isExcalidrawAvailable } from '../drawing/excalidraw-integration';

export function showNodeContextMenu(
  view: MindmapView,
  event: MouseEvent,
  explicitNodeLine?: number
): void {
  event.preventDefault();
  event.stopPropagation();
  if (view.isDirectNodeDragActive()) return;

  const contextLine = explicitNodeLine ?? contextLineFromEvent(event);
  const contextNode = Number.isNaN(contextLine) ? null : view.getNodeByLine(contextLine);

  if (contextNode && !view.selectedNodeLines.has(contextNode.line)) {
    view.selectNode(contextNode.line);
  } else {
    view.wrapper?.focus();
  }

  const selectedNodes = getSelectedNodesForContext(view, contextNode);
  const copyCount = selectedNodes.length;
  const targetNode = contextNode ?? (view.selectedNodeLines.size === 1 ? selectedNodes[0] : null);
  const selectionIsBullets = copyCount > 0 && selectedNodes.every((node) => node.checkbox === 'none');
  const selectionIsTasks = copyCount > 0 && selectedNodes.every((node) => node.checkbox !== 'none');
  const menu = new Menu();

  if (targetNode) {
    menu.addItem((item) => {
      item
        .setTitle('Edit')
        .setIcon('edit-3')
        .onClick(() => void editNodeContent(view, targetNode));
    });

    if (copyCount > 0) menu.addSeparator();
  }

  if (copyCount > 0) {
    menu.addItem((item) => {
      item
        .setTitle(copyCount > 1 ? `Copy ${copyCount} nodes` : 'Copy')
        .setIcon('copy')
        .onClick(() => void view.copyNodesToClipboard(selectedNodes));
    });

    menu.addItem((item) => {
      item
        .setTitle(copyCount > 1 ? `Cut ${copyCount} nodes` : 'Cut')
        .setIcon('scissors')
        .onClick(() => void view.cutNodesToClipboard(selectedNodes));
    });

    menu.addItem((item) => {
      item
        .setTitle(copyCount > 1 ? `Delete ${copyCount} nodes` : 'Delete')
        .setIcon('trash')
        .onClick(() => void view.deleteNodesWithConfirmation(selectedNodes));
    });
  }

  if (targetNode) {
    menu.addItem((item) => {
      item
        .setTitle('Add child')
        .setIcon('plus')
        .onClick(() => void view.executeAddChildCommand(targetNode));
    });

    menu.addItem((item) => {
      item
        .setTitle('Add sibling')
        .setIcon('git-pull-request-create')
        .onClick(() => void view.executeAddSiblingCommand(targetNode));
    });

    // This menu is the last step before any of the drawing actions below, so
    // it is where the editor's one-off module cost can be absorbed.
    warmDrawingEditor();

    menu.addItem((item) => {
      item
        .setTitle('Add drawing as child')
        .setIcon('pen-tool')
        .onClick(() => void addDrawingAsChild(view, targetNode));
    });

    menu.addItem((item) => {
      item
        .setTitle('Add drawing as sibling')
        .setIcon('pen-tool')
        .onClick(() => void addDrawingAsSibling(view, targetNode));
    });

    // Excalidraw is optional. Its entries appear only while the plugin is
    // installed and enabled, so the menu never offers an action that cannot
    // run. Existing Excalidraw nodes still render either way - that is
    // Obsidian's embed pipeline, not this plugin's.
    if (isExcalidrawAvailable(view.app)) {
      menu.addItem((item) => {
        item
          .setTitle('Add Excalidraw drawing as child')
          .setIcon('shapes')
          .onClick(() => void addExcalidrawAsChild(view, targetNode));
      });

      menu.addItem((item) => {
        item
          .setTitle('Add Excalidraw drawing as sibling')
          .setIcon('shapes')
          .onClick(() => void addExcalidrawAsSibling(view, targetNode));
      });
    }

    menu.addItem((item) => {
      item
        .setTitle('Add heading for this tree')
        .setIcon('heading')
        .onClick(() => void view.executeAddHeadingCommand(targetNode));
    });

    if (selectionIsBullets) {
      menu.addItem((item) => {
        item
          .setTitle(copyCount > 1 ? `Convert ${copyCount} selected nodes to unchecked tasks` : 'Convert to unchecked task')
          .setIcon('square')
          .onClick(() => void view.convertNodesToTask(selectedNodes));
      });

      menu.addItem((item) => {
        item
          .setTitle(copyCount > 1 ? `Convert ${copyCount} selected nodes to checked tasks` : 'Convert to checked task')
          .setIcon('square-check-big')
          .onClick(() => void view.convertNodesToCheckedTask(selectedNodes));
      });
    } else if (selectionIsTasks) {
      menu.addItem((item) => {
        item
          .setTitle(copyCount > 1 ? `Convert ${copyCount} selected nodes to bullet points` : 'Convert to bullet point')
          .setIcon('list')
          .onClick(() => void view.convertNodesToBulletPoint(selectedNodes));
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Paste')
        .setIcon('clipboard-paste')
        .onClick(() => void view.pasteClipboardAsChildren(targetNode));
    });

    menu.addItem((item) => {
      item
        .setTitle('Duplicate')
        .setIcon('copy-plus')
        .onClick(() => void view.executeDuplicateNodeCommand(targetNode));
    });
  }

  if (copyCount === 0 && !targetNode) {
    menu.addItem((item) => item.setTitle('No node selected').setDisabled(true));
  }

  view.setActiveNodeContextMenu(menu);
  if (explicitNodeLine !== undefined && typeof menu.showAtPosition === 'function') {
    // Supplying the originating document is important in Obsidian's pop-out
    // windows and mobile WebViews. It also avoids relying on a synthetic
    // event's retargeted `view` when a Pencil long-press opens the menu.
    menu.showAtPosition({ x: event.clientX, y: event.clientY }, view.wrapper.ownerDocument);
  } else {
    // Preserve Obsidian's trusted desktop/contextmenu path and compatibility
    // with app versions predating showAtPosition.
    menu.showAtMouseEvent(event);
  }
}

function contextLineFromEvent(event: MouseEvent): number {
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : [event.target];

  for (const candidate of path) {
    if (!candidate || typeof candidate !== 'object') continue;
    const element = candidate as {
      classList?: { contains?: (className: string) => boolean };
      dataset?: { nodeLine?: string };
      closest?: (selector: string) => Element | null;
    };
    const overlay = element.classList?.contains?.('mindmap-overlay')
      ? element
      : element.closest?.('.mindmap-overlay');
    if (!overlay) continue;
    const line = Number((overlay as HTMLElement).dataset.nodeLine);
    if (!Number.isNaN(line)) return line;
  }

  return NaN;
}

function getSelectedNodesForContext(view: MindmapView, contextNode: OutlineNode | null): OutlineNode[] {
  const selected = view.getFlatNodes()
    .filter((node) => view.selectedNodeLines.has(node.line))
    .sort((a, b) => a.line - b.line);

  if (selected.length > 0 && (!contextNode || view.selectedNodeLines.has(contextNode.line))) {
    return selected;
  }

  return contextNode ? [contextNode] : [];
}
