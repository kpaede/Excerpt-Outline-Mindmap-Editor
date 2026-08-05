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

  const checkboxToggle = box.createEl('button');
  checkboxToggle.type = 'button';
  checkboxToggle.className = 'checkbox-toggle';
  checkboxToggle.setAttribute('aria-label', node.checkbox === 'checked' ? 'Uncheck task' : 'Toggle checkbox');
  checkboxToggle.setAttribute('title', node.checkbox === 'checked' ? 'Uncheck task' : 'Toggle checkbox');
  setIcon(checkboxToggle, node.checkbox === 'checked' ? 'square-check-big' : 'square');

  const toggleCheckbox = async () => {
    if (!view.file) return;
    await view.toggleNodeCheckbox(node);
  };

  checkboxToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    // `click` is the one input-neutral activation event: browsers emit it for
    // primary mouse, touch, Pencil and keyboard activation. Rejecting secondary
    // buttons here prevents a right-click/context-menu sequence from toggling.
    if (event.button !== 0) return;
    void toggleCheckbox();
  });


  return {
    checkboxToggle,
    hasCheckbox,
    toggleCheckbox,
  };
}

export function appendZoteroBadge(box: HTMLElement, node: OutlineNode): void {
  const primaryZoteroLink = getPrimaryZoteroLink(node.text);
  if (!primaryZoteroLink) return;

  const zoteroBadge = box.createEl('button');
  zoteroBadge.className = 'mindmap-zotero-badge';
  zoteroBadge.setAttribute('type', 'button');
  zoteroBadge.setAttribute('aria-label', 'Open Zotero source');
  zoteroBadge.setAttribute('title', 'Open Zotero source');
  const badgeSvg = zoteroBadge.createSvg('svg', {
    attr: { width: '16', height: '16', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
  });
  badgeSvg.createSvg('polygon', {
    attr: {
      fill: 'currentColor',
      points:
        '13.863 2.73 13.027 1 2.137 1 2.137 3.8 2.137 3.921 8.822 3.921 1.289 13.233 2.137 15 13.863 15 13.863 12.142 13.863 12.021 6.448 12.021 13.863 2.73',
    },
  });
  zoteroBadge.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.open(primaryZoteroLink, '_blank');
  });
}

export function appendNodeControls(box: HTMLElement, node: OutlineNode, view: MindmapView): void {
  const controls = box.createDiv();
  controls.className = 'node-controls';

  const deleteButton = box.createEl('button');
  deleteButton.type = 'button';
  deleteButton.textContent = '×';
  deleteButton.className = 'mindmap-node-delete';
  deleteButton.setAttribute('aria-label', 'Delete node');
  deleteButton.setAttribute('title', 'Delete node');

  const createControlButton = (icon: string, label: string, action: () => void) => {
    const button = controls.createEl('button');
    button.type = 'button';
    button.className = 'mindmap-node-control';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    setIcon(button, icon);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      if (!view.file) return;
      action();
    });
    return button;
  };

  // createControlButton already appends to `controls`; appending the return
  // values again would add each button twice.
  createControlButton('plus', 'Add child', () => {
    void view.executeAddChildCommand(node);
  });
  createControlButton('git-pull-request-create', 'Add sibling', () => {
    void view.executeAddSiblingCommand(node);
  });

  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (!view.file) return;

    new DeleteNodeModal(view.app, (result: DeleteOption) => {
      void (async () => {
        if (!view.file) return;

        if (result === 'full') {
          await view.executeDeleteNodeCommand(node);
        } else {
          await view.executeDeleteNodeKeepChildrenCommand(node);
        }
    
      })();
    }).open();
  });

  box.append(controls, deleteButton);
}
