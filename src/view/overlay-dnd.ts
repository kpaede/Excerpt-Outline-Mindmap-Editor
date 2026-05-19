import type { ChildInsertPosition, SiblingInsertPosition } from '../domain/mindmap-file';

export type DropIntent =
  | { kind: 'sibling'; siblingInsertPosition: SiblingInsertPosition }
  | { kind: 'child'; childInsertPosition: ChildInsertPosition };

export type DropPointer = Pick<MouseEvent | DragEvent | PointerEvent, 'clientX' | 'clientY'>;

export function getDropIntent(event: DropPointer, targetBox: HTMLElement): DropIntent {
  const rect = targetBox.getBoundingClientRect();
  const relativeY = event.clientY - rect.top;
  const relativeX = event.clientX - rect.left;

  const isLeft = relativeX < rect.width / 2;

  if (relativeY < rect.height / 2) {
    return { kind: 'sibling', siblingInsertPosition: isLeft ? 'before' : 'after' };
  }

  return { kind: 'child', childInsertPosition: isLeft ? 'first' : 'last' };
}

export function updateDropPreview(event: DropPointer, targetBox: HTMLElement): DropIntent {
  const dropIntent = getDropIntent(event, targetBox);
  targetBox.classList.toggle('mm-tgt-sibling-before', dropIntent.kind === 'sibling' && dropIntent.siblingInsertPosition === 'before');
  targetBox.classList.toggle('mm-tgt-sibling-after', dropIntent.kind === 'sibling' && dropIntent.siblingInsertPosition === 'after');
  targetBox.classList.toggle('mm-tgt-first-child', dropIntent.kind === 'child' && dropIntent.childInsertPosition === 'first');
  targetBox.classList.toggle('mm-tgt-last-child', dropIntent.kind === 'child' && dropIntent.childInsertPosition === 'last');
  return dropIntent;
}

export function clearDropPreview(targetBox: HTMLElement): void {
  targetBox.classList.remove('mm-tgt-sibling-before', 'mm-tgt-sibling-after', 'mm-tgt-first-child', 'mm-tgt-last-child');
}

export function getOverlayAtPoint(clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  return element?.closest('.mindmap-overlay') as HTMLElement | null;
}
