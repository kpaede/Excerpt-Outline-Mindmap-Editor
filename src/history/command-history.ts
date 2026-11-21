import { App, TFile } from 'obsidian';
import { OutlineNode } from '../utils/outline';
import { commitDocument } from '../storage/document-writer';
import { carrySavedZoom } from '../storage/zoom-settings-change';

export interface MindmapCommand {
  type: 'add-child' | 'add-sibling' | 'edit-node' | 'delete-node' | 'delete-node-keep-children' | 'move-subtree' | 'add-child-text' | 'toggle-checkbox' | 'add-heading' | 'edit-heading' | 'delete-heading';
  timestamp: number;
  beforeState: string;
  afterState: string;
  nodeInfo: {
    line: number;
    text: string;
    indent: string;
    marker: string;
  };
  targetInfo?: {
    line: number;
    text: string;
    indent: string;
    marker: string;
  };
  metadata?: Record<string, unknown>;
}

export class CommandHistory {
  private history: MindmapCommand[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 20; // Limit to 20 commands
  private maxHistoryCharacters = 8_000_000;
  
  private restoreTail: Promise<void> = Promise.resolve();
  private restoring = false;
  private generation = 0;
  private deferredCommands: { command: MindmapCommand; generation: number }[] = [];

  constructor(private app: App) {}

  public executeCommand(command: MindmapCommand): void {
    if (this.restoring) { this.deferredCommands.push({ command, generation: this.generation }); return; }
    // Remove any commands after current index
    this.history.splice(this.currentIndex + 1);
    
    // Add new command
    this.history.push(command);
    this.currentIndex = this.history.length - 1;
    
    while (this.history.length > 1 && (this.history.length > this.maxHistorySize ||
      this.history.reduce((size, item) => size + item.beforeState.length + item.afterState.length, 0) > this.maxHistoryCharacters)) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  public canUndo(): boolean {
    return this.currentIndex >= 0;
  }

  public retainSavedZoom(zoom: number): void {
    for (const command of this.history) {
      command.beforeState = carrySavedZoom(command.beforeState, zoom);
      command.afterState = carrySavedZoom(command.afterState, zoom);
    }
  }

  public canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  public undo(file: TFile): Promise<string | null> { return this.restore(file, false); }
  public redo(file: TFile): Promise<string | null> { return this.restore(file, true); }

  private restore(file: TFile, redo: boolean): Promise<string | null> {
    const generation = this.generation;
    const operation = this.restoreTail.then(async () => {
      if (generation !== this.generation) return null;
      const index = redo ? this.currentIndex + 1 : this.currentIndex;
      const command = this.history[index];
      if (!command) return null;
      this.restoring = true;
      try {
        const result = await commitDocument(this.app, file,
          redo ? command.beforeState : command.afterState,
          redo ? command.afterState : command.beforeState);
        if (generation === this.generation) this.currentIndex = redo ? index : index - 1;
        return result;
      } catch (error) {
        console.error(redo ? 'Redo failed:' : 'Undo failed:', error);
        return null;
      } finally {
        this.restoring = false;
        const commands = this.deferredCommands.splice(0);
        for (const entry of commands) if (entry.generation === this.generation) this.executeCommand(entry.command);
      }
    });
    this.restoreTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  public getUndoDescription(): string | null {
    if (!this.canUndo()) return null;
    
    const command = this.history[this.currentIndex];
    switch (command.type) {
      case 'add-child':
        return `Undo add child to "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'add-sibling':
        return `Undo add sibling to "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'edit-node':
        return `Undo edit "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'delete-node':
        return `Undo delete "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'delete-node-keep-children':
        return `Undo delete node "${command.nodeInfo.text.substring(0, 20)}..." (kept children)`;
      case 'move-subtree':
        return `Undo move "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'add-child-text':
        return `Undo add text child to "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'add-heading':
        return `Undo add heading before "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'edit-heading':
        return `Undo edit heading "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'delete-heading':
        return `Undo delete heading "${command.nodeInfo.text.substring(0, 20)}..."`;
      default:
        return 'Undo last action';
    }
  }

  public getRedoDescription(): string | null {
    if (!this.canRedo()) return null;
    
    const command = this.history[this.currentIndex + 1];
    switch (command.type) {
      case 'add-child':
        return `Redo add child to "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'add-sibling':
        return `Redo add sibling to "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'edit-node':
        return `Redo edit "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'delete-node':
        return `Redo delete "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'delete-node-keep-children':
        return `Redo delete node "${command.nodeInfo.text.substring(0, 20)}..." (kept children)`;
      case 'move-subtree':
        return `Redo move "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'add-child-text':
        return `Redo add text child to "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'add-heading':
        return `Redo add heading before "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'edit-heading':
        return `Redo edit heading "${command.nodeInfo.text.substring(0, 20)}..."`;
      case 'delete-heading':
        return `Redo delete heading "${command.nodeInfo.text.substring(0, 20)}..."`;
      default:
        return 'Redo last action';
    }
  }

  public clear(): void {
    this.generation++;
    this.history = [];
    this.currentIndex = -1;
  }

  public getHistoryState(): { undoStack: MindmapCommand[]; redoStack: MindmapCommand[] } {
    return {
      undoStack: this.history.slice(0, this.currentIndex + 1),
      redoStack: this.history.slice(this.currentIndex + 1)
    };
  }

  public restoreHistoryState(state: { undoStack: MindmapCommand[]; redoStack: MindmapCommand[] }): void {
    // Validate the state object and arrays before restoring
    if (!state || typeof state !== 'object') {
      console.warn('Invalid history state object, initializing empty history');
      this.clear();
      return;
    }
    
    const undoStack = Array.isArray(state.undoStack) ? state.undoStack : [];
    const redoStack = Array.isArray(state.redoStack) ? state.redoStack : [];
    
    // Older releases persisted truncated snapshots. Never restore them.
    const entries = [...undoStack, ...redoStack];
    if (entries.some(entry => !entry || typeof entry !== 'object' || typeof entry.beforeState !== 'string' || typeof entry.afterState !== 'string' ||
      entry.beforeState.endsWith('...[truncated]') || entry.afterState.endsWith('...[truncated]'))) {
      this.clear(); return;
    }
    this.generation++;
    this.history = entries;
    this.currentIndex = undoStack.length - 1;
  }

  public static createNodeInfo(node: OutlineNode): { line: number; text: string; indent: string; marker: string } {
    return {
      line: node.line,
      text: node.text.substring(0, 50), // Reduced from 100 to 50 characters
      indent: node.indent,
      marker: node.marker
    };
  }
}
