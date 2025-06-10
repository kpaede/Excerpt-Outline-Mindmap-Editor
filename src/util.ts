import { Modal, App, Setting } from 'obsidian';

export interface OutlineNode {
  text: string;
  indent: string;
  marker: string;
  line: number;
  endLine: number;
  children: OutlineNode[];
  scaleFactor?: number;
}

export function parseOutline(markdown: string): OutlineNode[] {
  const lines = markdown.split(/\r?\n/);
  const rootNodes: OutlineNode[] = [];
  const levelStack: OutlineNode[] = [];
  const indentLevels: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    
    if (!match) {
      continue; // Skip non-outline lines
    }

    const indentSpaces = match[1] || '';
    const indentNormalized = indentSpaces.replace(/\t/g, '    ');
    const indentLength = indentNormalized.length;

    let level = 0;
    while (level < indentLevels.length && indentLength > indentLevels[level]) {
      level++;
    }

    if (level >= indentLevels.length || indentLevels[level] !== indentLength) {
      indentLevels.splice(level, 0, indentLength);
    }

    const marker = match[2];
    let text = match[3] || '';

    // Remove checkbox markup if present
    if (text.match(/^\[.\]\s/)) {
      const checkboxToken = text.substring(0, 4);
      text = text.substring(checkboxToken.length);
    }

    const node: OutlineNode = {
      text: text,
      indent: indentSpaces,
      marker: marker,
      line: i,
      endLine: i, // Will be updated after parsing all children
      children: [],
    };

    // Clean up stacks when we move to a shallower or equal level
    if (level < levelStack.length) {
      levelStack.splice(level);
      indentLevels.splice(level + 1);
    }

    // Add to appropriate parent or root
    if (level === 0) {
      rootNodes.push(node);
    } else if (level <= levelStack.length && levelStack[level - 1]) {
      levelStack[level - 1].children.push(node);
    } else {
      rootNodes.push(node);
    }

    while (levelStack.length <= level) {
      levelStack.push(node);
    }
    levelStack[level] = node;
  }

  // Calculate endLine for each node after parsing
  function calculateEndLines(nodes: OutlineNode[]): void {
    nodes.forEach(node => {
      if (node.children.length > 0) {
        // Recursively calculate children's endLines first
        calculateEndLines(node.children);
        // This node's endLine is the last child's endLine
        node.endLine = node.children[node.children.length - 1].endLine;
      }
      // If no children, endLine remains the same as line
    });
  }

  calculateEndLines(rootNodes);
  return rootNodes;
}

export function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  const flat: OutlineNode[] = [];
  function walk(arr: OutlineNode[]) {
    arr.forEach((n) => {
      flat.push(n);
      if (n.children) {
        walk(n.children);
      }
    });
  }
  walk(nodes);
  return flat;
}

export class TextInputModal extends Modal {
  result: string | null = null;
  private initialValue: string;
  private onSubmit: (value: string) => void;

  constructor(app: App, initialValue: string, onSubmit: (value: string) => void) {
    super(app);
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Neuen Text eingeben' });

    new Setting(contentEl)
      .setName('Text')
      .addText((text) =>
        text
          .setValue(this.initialValue)
          .onChange((value) => (this.result = value))
      );

    contentEl.createEl('br');

    const buttonEl = contentEl.createEl('button', { text: 'Speichern' });
    buttonEl.addEventListener('click', () => {
      this.close();
      this.onSubmit(this.result ?? this.initialValue);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function isOutlineCompatible(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  
  // Remove frontmatter if present
  let startIndex = 0;
  if (lines[0]?.trim() === '---') {
    const frontmatterEnd = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (frontmatterEnd !== -1) {
      startIndex = frontmatterEnd + 1;
    }
  }
  
  const contentLines = lines.slice(startIndex);
  const nonEmptyLines = contentLines.filter(line => line.trim() !== '');
  
  if (nonEmptyLines.length === 0) {
    return true;
  }
  
  // Check if all non-empty lines are outline items
  for (const line of nonEmptyLines) {
    const isOutlineItem = line.match(/^\s*([-*+]|\d+\.)\s+/);
    if (!isOutlineItem) {
      return false;
    }
  }
  
  return true;
}

export function isEmptyContent(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  
  // Remove frontmatter if present
  let startIndex = 0;
  if (lines[0]?.trim() === '---') {
    const frontmatterEnd = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (frontmatterEnd !== -1) {
      startIndex = frontmatterEnd + 1;
    }
  }
  
  const contentLines = lines.slice(startIndex);
  return contentLines.every(line => line.trim() === '');
}

export function wouldBreakCodeBlock(lines: string[], startCheck: number, endCheck: number): boolean {
  let inCodeBlock = false;
  let codeBlockFence = '';
  
  // Scan the entire range to see if we're breaking a code block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!inCodeBlock) {
      if (line.startsWith('```') || line.startsWith('~~~')) {
        inCodeBlock = true;
        codeBlockFence = line.substring(0, 3);
        
        // If we start a code block in our range but don't end it, that's a problem
        if (i >= startCheck && i < endCheck) {
          let foundEnd = false;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim().startsWith(codeBlockFence) && lines[j].trim().length >= codeBlockFence.length) {
              if (j >= endCheck) {
                return true; // Code block extends beyond our range
              }
              foundEnd = true;
              break;
            }
          }
          if (!foundEnd) return true;
        }
      }
    } else {
      if (line.startsWith(codeBlockFence) && line.length >= codeBlockFence.length) {
        inCodeBlock = false;
        codeBlockFence = '';
      }
    }
  }
  
  return false;
}

export function findSafeMoveBoundaries(lines: string[], start: number, end: number): { start: number; end: number; isSafe: boolean } {
  // The boundaries are already safe since we're working with complete outline nodes
  // that include their full multi-line content
  return { start, end, isSafe: true };
}

export function findSafeInsertionPoint(lines: string[], insertAfterLine: number): { insertLine: number; isSafe: boolean } {
  // Simple insertion after the complete node (including all its lines)
  return { insertLine: insertAfterLine + 1, isSafe: true };
}

export function findCompleteSubtreeRange(lines: string[], node: OutlineNode): { start: number; end: number } {
  const start = node.line;
  let end = node.line;
  
  const baseIndent = node.indent;
  
  for (let i = node.line + 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)/);
    const lineIndent = match ? match[1] : '';
    
    // If we find a line with same or less indentation, we've reached the end
    if (lineIndent.length <= baseIndent.length && line.trim() !== '') {
      break;
    }
    
    // If this line belongs to our subtree, extend the end
    if (lineIndent.startsWith(baseIndent + '\t') || line.trim() === '') {
      end = i;
    }
  }
  
  return { start, end };
}

export function validateMoveOperation(
  lines: string[], 
  sourceNode: OutlineNode, 
  targetNode: OutlineNode
): { isValid: boolean; reason?: string } {
  const sourceRange = findCompleteSubtreeRange(lines, sourceNode);
  const targetRange = findCompleteSubtreeRange(lines, targetNode);
  
  // Check if target is within source subtree
  if (targetNode.line >= sourceRange.start && targetNode.line <= sourceRange.end) {
    return { isValid: false, reason: 'Cannot move node into its own subtree' };
  }
  
  return { isValid: true };
}
