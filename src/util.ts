import { Modal, App, Setting } from 'obsidian';

export interface OutlineNode {
  text: string;
  indent: string;
  marker: string;
  line: number;
  children: OutlineNode[];
}

export function parseOutline(markdown: string): OutlineNode[] {
  const lines = markdown.split(/\r?\n/);
  const rootNodes: OutlineNode[] = [];
  const levelStack: OutlineNode[] = []; // Stack of parent nodes by nesting level
  const indentLevels: number[] = []; // Ordered list of indent lengths we've seen

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!match) continue;

    const indentSpaces = match[1] || '';
    const indentNormalized = indentSpaces.replace(/\t/g, '    ');
    const indentLength = indentNormalized.length;

    // Find the correct nesting level for this indentation
    let level = 0;
    while (level < indentLevels.length && indentLength > indentLevels[level]) {
      level++;
    }
    // After the loop:
    // - If indentLength matches an existing indentLevels[level], this node is at that 'level'.
    // - If indentLength is new and fits between indentLevels[level-1] and indentLevels[level],
    //   it will be inserted at 'level', and this node will be at 'level'.
    // - If indentLength is new and greater than all existing indentLevels,
    //   'level' will be indentLevels.length, and it will be inserted there.

    // If this is a new indentation level, add it at the correct position
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
      children: [],
    };

    // Clean up stacks when we move to a shallower or equal level
    if (level < levelStack.length) {
      levelStack.splice(level);
      // Also clean up deeper indentation levels
      indentLevels.splice(level + 1);
    }

    // Add to appropriate parent or root
    if (level === 0) {
      rootNodes.push(node);
    } else if (level <= levelStack.length && levelStack[level - 1]) {
      levelStack[level - 1].children.push(node);
    } else {
      // Fallback: add to root if parent chain is broken
      rootNodes.push(node);
    }

    // Extend stack if needed and set current node
    while (levelStack.length <= level) {
      levelStack.push(node); // Temporary placeholder
    }
    levelStack[level] = node;
  }

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
  
  // If no content lines, it's compatible (empty)
  if (nonEmptyLines.length === 0) {
    return true;
  }
  
  // Check if all non-empty lines are list items
  return nonEmptyLines.every(line => {
    return line.match(/^\s*([-*+]|\d+\.)\s+/);
  });
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
