import { Menu } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';

export function showNodeContextMenu(view: MindmapView, event: MouseEvent): void {
  event.preventDefault();
  if (view.wrapper?.classList.contains('is-touch-dragging')) return;

  const target = event.target as HTMLElement | null;
  const overlay = target?.closest('.mindmap-overlay') as HTMLElement | null;
  const contextLine = overlay ? Number(overlay.dataset.nodeLine) : NaN;
  const contextNode = Number.isNaN(contextLine) ? null : view.getNodeByLine(contextLine);

  if (contextNode && !view.selectedNodeLines.has(contextNode.line)) {
    view.selectNode(contextNode.line);
  } else {
    view.wrapper?.focus();
  }

  const selectedNodes = getSelectedNodesForContext(view, contextNode);
  const copyCount = selectedNodes.length;
  const targetNode = contextNode ?? (view.selectedNodeLines.size === 1 ? selectedNodes[0] : null);
  const menu = new Menu();

  if (targetNode) {
    menu.addItem((item) => {
      item
        .setTitle('Edit node')
        .setIcon('edit-3')
        .onClick(() => void view.enterEditModeForNodeByLine(targetNode.line));
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
        .setTitle('Copy selection as Markdown')
        .setIcon('file-text')
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

    menu.addItem((item) => {
      item
        .setTitle(copyCount > 1 ? `Convert ${copyCount} selected nodes to unchecked tasks` : 'Convert to unchecked task')
        .setIcon('check-square')
        .onClick(() => void view.convertNodesToTask(selectedNodes));
    });

    menu.addItem((item) => {
      item
        .setTitle(copyCount > 1 ? `Convert ${copyCount} selected nodes to checked tasks` : 'Convert to checked task')
        .setIcon('check-square')
        .onClick(() => void view.convertNodesToCheckedTask(selectedNodes));
    });

    menu.addItem((item) => {
      item
        .setTitle(copyCount > 1 ? `Convert ${copyCount} selected nodes to bullet points` : 'Convert to bullet point')
        .setIcon('list')
        .onClick(() => void view.convertNodesToBulletPoint(selectedNodes));
    });

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

  menu.showAtMouseEvent(event);
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
