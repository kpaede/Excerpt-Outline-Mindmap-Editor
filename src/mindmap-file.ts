import { App, TFile, MarkdownView, Notice } from 'obsidian';
import { OutlineNode } from './util';

export type DocString = string;

async function persistLines(app: App, file: TFile, lines: string[]): Promise<DocString> {
  const newDoc = lines.join('\n');
  let writtenViaEditor = false;
  app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
    const view = leaf.view as MarkdownView;
    if (view.file && view.file.path === file.path) {
      view.editor.setValue(newDoc);
      writtenViaEditor = true;
    }
  });

  if (!writtenViaEditor) {
    try {
      await app.vault.modify(file, newDoc);
    } catch (err) {}
  }

  return newDoc;
}

function subtreeEnd(lines: string[], start: number, indent: string): number {
  const baseIndentLength = indent.length;
  
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)/);
    const lineIndent = match ? match[1] : '';
    
    if (lineIndent.length <= baseIndentLength && line.trim() !== '') {
      return i;
    }
  }
  return lines.length;
}

export async function addChild(
  app: App,
  file: TFile,
  parent: OutlineNode
): Promise<DocString> {
  let fileText: string;
  try {
    fileText = await app.vault.read(file);
  } catch (err) {
    return "";
  }
  const lines = fileText.split(/\r?\n/);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const insertIndex = parent.line + 1;
  const childIndent = parent.indent + '\t';
  const newLine = `${childIndent}- `;
  
  lines.splice(insertIndex, 0, newLine);

  return await persistLines(app, file, lines);
}

export async function addSibling(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  let fileText: string;
  try {
    fileText = await app.vault.read(file);
  } catch (err) {
    return "";
  }
  const lines = fileText.split(/\r?\n/);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const insertIndex = subtreeEnd(lines, node.line, node.indent);
  const newLine = `${node.indent}${node.marker} `;
  lines.splice(insertIndex, 0, newLine);

  return await persistLines(app, file, lines);
}

export async function writeNode(
  app: App,
  file: TFile,
  node: OutlineNode,
  txt: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  // Replace the single line with new content
  const prefix = node.indent + node.marker;
  const newLine = `${prefix} ${txt}`;
  
  lines[node.line] = newLine;

  return await persistLines(app, file, lines);
}

export async function deleteNode(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  let lines = fileText.split(/\r?\n/);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const end = subtreeEnd(lines, node.line, node.indent);
  lines.splice(node.line, end - node.line);

  return await persistLines(app, file, lines);
}

export async function deleteMultipleNodes(
  app: App,
  file: TFile,
  nodes: OutlineNode[]
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  let lines = fileText.split(/\r?\n/);

  // Filter out nodes that are descendants of other nodes in the list
  const topLevelNodes = nodes.filter(n => {
    // If any other node in the list contains this node, filter it out
    return !nodes.some(other => other !== n && n.line > other.line && n.line <= other.endLine);
  });

  // Sort descending by line number to safely splice from bottom to top
  topLevelNodes.sort((a, b) => b.line - a.line);

  for (const node of topLevelNodes) {
    if (node.line >= 0 && node.line < lines.length) {
      const end = subtreeEnd(lines, node.line, node.indent);
      lines.splice(node.line, end - node.line);
    }
  }

  return await persistLines(app, file, lines);
}

export async function deleteMultipleNodesKeepChildren(
  app: App,
  file: TFile,
  nodes: OutlineNode[]
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);

  const selectedLines = new Set(nodes.map((node) => node.line));
  const sortedNodes = [...nodes].sort((a, b) => b.indent.length - a.indent.length);

  const nextLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (selectedLines.has(i)) continue;

    let line = lines[i];
    const deletedAncestors = sortedNodes.filter((node) => i > node.line && i <= node.endLine);

    for (const ancestor of deletedAncestors) {
      const childPrefix = `${ancestor.indent}\t`;
      if (line.startsWith(childPrefix)) {
        line = `${ancestor.indent}${line.slice(childPrefix.length)}`;
      }
    }

    nextLines.push(line);
  }

  return await persistLines(app, file, nextLines);
}

export async function deleteNodeKeepChildren(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  let lines = fileText.split(/\r?\n/);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  // Remove only the single node line
  lines.splice(node.line, 1);

  // Reduce indentation of each child node
  for (let i = node.line; i < lines.length; i++) {
    if (lines[i].startsWith(node.indent + '\t')) {
      lines[i] = lines[i].replace(new RegExp(`^${node.indent}\\t`), node.indent);
    } else {
      const m = lines[i].match(/^(\s*)/);
      const currentIndent = m ? m[1] : '';
      if (currentIndent.length <= node.indent.length) break;
    }
  }

  return await persistLines(app, file, lines);
}

export async function moveSubtree(
  app: App,
  file: TFile,
  source: OutlineNode,
  target: OutlineNode,
  insertAsChild: boolean = true,
  isOptimizedMove: boolean = false,
  beforeState?: string
): Promise<DocString> {
  const fileText = beforeState || await app.vault.read(file);
  const originalLines = fileText.split(/\r?\n/);

  if (source.line < 0 || source.line >= originalLines.length ||
      target.line < 0 || target.line >= originalLines.length) {
    return fileText;
  }

  if (source.line === target.line) {
    return fileText;
  }

  // Extract source subtree
  const sourceEnd = subtreeEnd(originalLines, source.line, source.indent);
  const sourceLines = originalLines.slice(source.line, sourceEnd);
  
  // Remove source subtree from original position
  const linesAfterRemoval = [...originalLines.slice(0, source.line), ...originalLines.slice(sourceEnd)];
  
  // Adjust target line number after removal
  let adjustedTargetLine = target.line;
  if (target.line > source.line) {
    adjustedTargetLine -= (sourceEnd - source.line);
  }
  
  // Calculate insertion point
  let insertionPoint: number;
  if (insertAsChild) {
    insertionPoint = adjustedTargetLine + 1;
  } else {
    const targetEnd = subtreeEnd(linesAfterRemoval, adjustedTargetLine, target.indent);
    insertionPoint = targetEnd;
  }
  
  // Calculate new indentation
  const newIndent = insertAsChild ? target.indent + '\t' : target.indent;
  const indentDiff = newIndent.length - source.indent.length;
  
  // Adjust indentation of moved lines
  const adjustedSourceLines = sourceLines.map((line) => {
    if (line.trim() === '') return line;
    
    if (indentDiff > 0) {
      return '\t'.repeat(indentDiff) + line;
    } else if (indentDiff < 0) {
      const removeCount = Math.abs(indentDiff);
      return line.replace(new RegExp(`^\t{0,${removeCount}}`), '');
    }
    return line;
  });
  
  // Insert at calculated position
  const finalLines = [
    ...linesAfterRemoval.slice(0, insertionPoint),
    ...adjustedSourceLines,
    ...linesAfterRemoval.slice(insertionPoint)
  ];
  
  return await persistLines(app, file, finalLines);
}

export async function addChildText(
  app: App,
  file: TFile,
  parent: OutlineNode,
  text: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  // Insert after the complete parent node
  const insertIndex = parent.endLine + 1;
  
  // Create child with proper indentation
  const childIndent = parent.indent + '\t';
  const newLine = `${childIndent}- ${text}`;
  
  lines.splice(insertIndex, 0, newLine);

  return await persistLines(app, file, lines);
}

function preparePastedOutlineLines(text: string, indent: string): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '');

  if (rawLines.length === 0) return [];

  const outlineItems = rawLines
    .map((line, index) => {
      const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (!match) return null;

      return {
        index,
        indent: match[1] ?? '',
        marker: match[2],
        text: match[3] ?? '',
      };
    })
    .filter((item): item is { index: number; indent: string; marker: string; text: string } => item !== null);

  if (outlineItems.length === 0) {
    return rawLines.map((line) => `${indent}- ${line.trim()}`);
  }

  const indentColumns = (value: string): number => {
    let columns = 0;

    for (const char of value) {
      columns += char === '\t' ? 4 : 1;
    }

    return columns;
  };

  const rawIndentLevels: number[] = [];

  outlineItems.forEach((item) => {
    const columns = indentColumns(item.indent);

    if (!rawIndentLevels.includes(columns)) {
      rawIndentLevels.push(columns);
      rawIndentLevels.sort((a, b) => a - b);
    }
  });

  const levelForColumns = (columns: number): number => {
    const exactLevel = rawIndentLevels.indexOf(columns);
    if (exactLevel !== -1) return exactLevel;

    return rawIndentLevels.filter((levelColumns) => levelColumns < columns).length;
  };

  const outlineByLine = new Map(outlineItems.map((item) => [item.index, item]));
  const normalizedLines: string[] = [];
  let lastOutlineLevel = 0;

  rawLines.forEach((line, index) => {
    const item = outlineByLine.get(index);

    if (item) {
      lastOutlineLevel = levelForColumns(indentColumns(item.indent));
      normalizedLines.push(`${indent}${'\t'.repeat(lastOutlineLevel)}${item.marker} ${item.text}`);
      return;
    }

    normalizedLines.push(`${indent}${'\t'.repeat(lastOutlineLevel + 1)}- ${line.trim()}`);
  });

  return normalizedLines;
}

export async function addMarkdownAsChildren(
  app: App,
  file: TFile,
  parent: OutlineNode,
  text: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const pastedLines = preparePastedOutlineLines(text, parent.indent + '\t');
  if (pastedLines.length === 0) return fileText;

  lines.splice(parent.endLine + 1, 0, ...pastedLines);

  return await persistLines(app, file, lines);
}

export async function cutPasteMarkdownAsChildren(
  app: App,
  file: TFile,
  sourceNodes: OutlineNode[],
  parent: OutlineNode,
  text: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const topLevelNodes = sourceNodes
    .filter((node) => !sourceNodes.some((other) => (
      other !== node &&
      node.line > other.line &&
      node.line <= other.endLine
    )))
    .sort((a, b) => a.line - b.line);

  if (topLevelNodes.some((node) => parent.line >= node.line && parent.line <= node.endLine)) {
    return fileText;
  }

  const pastedLines = preparePastedOutlineLines(text, parent.indent + '\t');
  if (pastedLines.length === 0) return fileText;

  const deletedRanges = topLevelNodes.map((node) => ({ start: node.line, end: node.endLine }));
  const keptLines: string[] = [];
  let adjustedParentEndLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const isDeleted = deletedRanges.some((range) => i >= range.start && i <= range.end);
    if (isDeleted) continue;

    keptLines.push(lines[i]);

    if (i <= parent.endLine) {
      adjustedParentEndLine = keptLines.length - 1;
    }
  }

  if (adjustedParentEndLine < 0) return fileText;

  keptLines.splice(adjustedParentEndLine + 1, 0, ...pastedLines);

  return await persistLines(app, file, keptLines);
}

export async function duplicateSubtree(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const subtreeLines = lines.slice(node.line, node.endLine + 1);
  lines.splice(node.endLine + 1, 0, ...subtreeLines);

  return await persistLines(app, file, lines);
}
