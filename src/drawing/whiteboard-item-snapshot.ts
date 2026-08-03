import type { SimpleWhiteboard } from '@ludovicm67/simple-whiteboard';

type SnapshotBoard = Pick<
  SimpleWhiteboard,
  | 'exportItems'
  | 'canUndo'
  | 'undo'
  | 'getCurrentTool'
  | 'setCurrentTool'
  | 'getSelectedItemId'
  | 'setSelectedItemId'
  | 'draw'
>;

export class WhiteboardRollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhiteboardRollbackError';
  }
}

/**
 * Immutable, public-API snapshot of the complete whiteboard item store.
 *
 * Tool interactions can create, mutate, reorder, or erase several items before
 * the input layer learns that a one-finger stroke is becoming a pinch. A full
 * serialization lets us verify that the library's public undo API returned to
 * precisely the original item state, without guessing about tool internals.
 */
export class WhiteboardItemSnapshot {
  private constructor(
    private readonly serializedItems: string,
    private readonly currentTool: string,
    private readonly selectedItemId: string | null
  ) {}

  static capture(board: SnapshotBoard): WhiteboardItemSnapshot {
    return new WhiteboardItemSnapshot(
      JSON.stringify(board.exportItems()),
      board.getCurrentTool(),
      board.getSelectedItemId()
    );
  }

  restoreIfChanged(board: SnapshotBoard): boolean {
    const itemsChanged = JSON.stringify(board.exportItems()) !== this.serializedItems;
    let rollbackError: WhiteboardRollbackError | null = null;

    try {
      if (itemsChanged) {
        if (!board.canUndo()) {
          rollbackError = new WhiteboardRollbackError(
            'The whiteboard changed during touch input, but no undo snapshot is available.'
          );
        } else {
          board.undo();
          if (JSON.stringify(board.exportItems()) !== this.serializedItems) {
            rollbackError = new WhiteboardRollbackError(
              'The whiteboard undo snapshot did not match the state from before touch input.'
            );
          }
        }
      }
    } finally {
      // Undo rebuilds item instances and clears selection. Restore the public UI
      // state captured with the items without reaching into either controller.
      if (board.getCurrentTool() !== this.currentTool) {
        board.setCurrentTool(this.currentTool, false);
      }
      board.setSelectedItemId(this.selectedItemId);
      board.draw();
    }

    if (rollbackError) throw rollbackError;
    return itemsChanged;
  }
}
