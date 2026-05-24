import { setIcon } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import { DeleteNodeModal, DeleteOption } from '../ui/modals/delete-node-modal';
import { getPrimaryZoteroLink } from '../utils/zotero';

export interface CheckboxOverlayControl {
  checkboxToggle: HTMLButtonElement;
  hasCheckbox: boolean;
  toggleCheckbox: () => Promise<void>;
}

export function appendCheckboxToggle(box: HTMLElement, node: OutlineNode, view: MindmapView): CheckboxOverlayControl {
  const hasCheckbox = node.checkbox !== 'none';
  const isCheckboxHoverable = !hasCheckbox && view.generalSettings.showCheckboxesOnHover;

  box.classList.toggle('has-checkbox', hasCheckbox);
  box.classList.toggle('checkbox-hoverable', isCheckboxHoverable);
  box.classList.toggle('checkbox-checked', node.checkbox === 'checked');

  const checkboxToggle = document.createElement('button');
  checkboxToggle.type = 'button';
  checkboxToggle.className = 'checkbox-toggle';
  checkboxToggle.setAttribute('aria-label', node.checkbox === 'checked' ? 'Uncheck task' : 'Toggle checkbox');
  checkboxToggle.setAttribute('title', node.checkbox === 'checked' ? 'Uncheck task' : 'Toggle checkbox');
  setIcon(checkboxToggle, node.checkbox === 'checked' ? 'square-check-big' : 'square');

  const toggleCheckbox = async () => {
    if (!view.file) return;
    await view.toggleNodeCheckbox(node);
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

  return {
    checkboxToggle,
    hasCheckbox,
    toggleCheckbox,
  };
}

export function appendZoteroBadge(box: HTMLElement, node: OutlineNode): void {
  const primaryZoteroLink = getPrimaryZoteroLink(node.text);
  if (!primaryZoteroLink) return;

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

export function appendNodeControls(box: HTMLElement, node: OutlineNode, view: MindmapView): void {
  const controls = document.createElement('div');
  controls.className = 'node-controls';

  const deleteButton = document.createElement('span');
  deleteButton.textContent = '×';
  deleteButton.className = 'mindmap-node-delete';

  const createControlButton = (icon: string, label: string, action: () => void) => {
    const button = document.createElement('span');
    button.className = 'mindmap-node-control';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    setIcon(button, icon);
    button.onclick = async (event) => {
      event.stopPropagation();
      if (!view.file) return;
      action();
    };
    return button;
  };

  controls.append(
    createControlButton('plus', 'Add child', async () => {
      await view.executeAddChildCommand(node);
    }),
    createControlButton('git-pull-request-create', 'Add sibling', async () => {
      await view.executeAddSiblingCommand(node);
    })
  );

  deleteButton.onclick = async (event) => {
    event.stopPropagation();
    if (!view.file) return;

    new DeleteNodeModal(view.app, async (result: DeleteOption) => {
      if (!view.file) return;

      if (result === 'full') {
        await view.executeDeleteNodeCommand(node);
      } else {
        await view.executeDeleteNodeKeepChildrenCommand(node);
      }
    }).open();
  };

  box.append(controls, deleteButton);
}
