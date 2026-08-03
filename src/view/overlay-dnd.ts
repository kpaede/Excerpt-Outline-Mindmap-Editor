import type { ChildInsertPosition, SiblingInsertPosition } from '../domain/mindmap-file';

export type DropIntent =
  | { kind: 'sibling'; siblingInsertPosition: SiblingInsertPosition }
  | { kind: 'child'; childInsertPosition: ChildInsertPosition };

export type DropPointer = Pick<MouseEvent | DragEvent | PointerEvent, 'clientX' | 'clientY'>;
export interface DropIntentOptions {
  targetHasChildren?: boolean;
}

export function getDropIntent(
  event: DropPointer,
  targetBox: HTMLElement,
  options: DropIntentOptions = {}
): DropIntent {
  const rect = targetBox.getBoundingClientRect();
  const relativeY = event.clientY - rect.top;
  const relativeX = event.clientX - rect.left;
  const targetHasChildren = options.targetHasChildren ?? true;

  const isLeft = relativeX < rect.width / 2;

  if (relativeY < rect.height / 2) {
    return { kind: 'sibling', siblingInsertPosition: isLeft ? 'before' : 'after' };
  }

  if (!targetHasChildren) {
    return { kind: 'child', childInsertPosition: 'last' };
  }

  return { kind: 'child', childInsertPosition: isLeft ? 'first' : 'last' };
}

export function updateDropPreview(
  event: DropPointer,
  targetBox: HTMLElement,
  options: DropIntentOptions = {}
): DropIntent {
  const dropIntent = getDropIntent(event, targetBox, options);
  const targetHasChildren = options.targetHasChildren ?? true;
  targetBox.classList.toggle('mm-tgt-sibling-before', dropIntent.kind === 'sibling' && dropIntent.siblingInsertPosition === 'before');
  targetBox.classList.toggle('mm-tgt-sibling-after', dropIntent.kind === 'sibling' && dropIntent.siblingInsertPosition === 'after');
  targetBox.classList.toggle('mm-tgt-first-child', targetHasChildren && dropIntent.kind === 'child' && dropIntent.childInsertPosition === 'first');
  targetBox.classList.toggle('mm-tgt-last-child', targetHasChildren && dropIntent.kind === 'child' && dropIntent.childInsertPosition === 'last');
  targetBox.classList.toggle('mm-tgt-child', !targetHasChildren && dropIntent.kind === 'child');
  return dropIntent;
}

export function clearDropPreview(targetBox: HTMLElement): void {
  targetBox.classList.remove('mm-tgt-sibling-before', 'mm-tgt-sibling-after', 'mm-tgt-first-child', 'mm-tgt-last-child', 'mm-tgt-child', 'mm-tgt-invalid');
}
