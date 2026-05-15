import { App, TFile } from 'obsidian';
import { OutlineNode } from './util';

export interface MindmapCommand {
  type: 'add-child' | 'add-sibling' | 'edit-node' | 'delete-node' | 'delete-node-keep-children' | 'move-subtree' | 'add-child-text';
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
  metadata?: any;
}

export class CommandHistory {
  private history: MindmapCommand[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 20; // Limit to 20 commands
  private maxContentLength: number = 50000; // Limit content size per command
  
  constructor(private app: App) {}

  public executeCommand(command: MindmapCommand): void {
    // Limit content length to prevent huge frontmatter
    const truncatedCommand = {
      ...command,
      beforeState: command.beforeState.length > this.maxContentLength 
        ? command.beforeState.substring(0, this.maxContentLength) + '...[truncated]'
        : command.beforeState,
      afterState: command.afterState.length > this.maxContentLength
        ? command.afterState.substring(0, this.maxContentLength) + '...[truncated]'
        : command.afterState
    };
    
    // Remove any commands after current index
    this.history.splice(this.currentIndex + 1);
    
    // Add new command
    this.history.push(truncatedCommand);
    this.currentIndex = this.history.length - 1;
    
    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      const removeCount = this.history.length - this.maxHistorySize;
      this.history.splice(0, removeCount);
      this.currentIndex -= removeCount;
    }
  }

  public canUndo(): boolean {
    return this.currentIndex >= 0;
  }

  public canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  public async undo(file: TFile): Promise<string | null> {
    if (!this.canUndo()) return null;

    const command = this.history[this.currentIndex];
    
    // Move to redo stack
    this.currentIndex--;
    
    // Restore previous state
    try {
      await this.app.vault.modify(file, command.beforeState);
      return command.beforeState;
    } catch (error) {
      console.error('Undo failed:', error);
      // Move command back to current index if restore failed
      this.currentIndex++;
      return null;
    }
  }

  public async redo(file: TFile): Promise<string | null> {
    if (!this.canRedo()) return null;

    const command = this.history[this.currentIndex + 1];
    
    // Move back to undo stack
    this.currentIndex++;
    
    // Restore next state
    try {
      await this.app.vault.modify(file, command.afterState);
      return command.afterState;
    } catch (error) {
      console.error('Redo failed:', error);
      // Move command back to current index if restore failed
      this.currentIndex--;
      return null;
    }
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
      default:
        return 'Redo last action';
    }
  }

  public clear(): void {
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
    
    this.history = [...undoStack, ...redoStack];
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
