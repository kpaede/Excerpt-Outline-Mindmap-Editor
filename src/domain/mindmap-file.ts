import type { App, TFile, MarkdownView } from 'obsidian';
import type { OutlineNode } from '../utils/outline';

export type DocString = string;
export type ChildInsertPosition = 'first' | 'last';
export type SiblingInsertPosition = 'before' | 'after';

interface SplitDoc {
  lines: string[];
  newline: '\n' | '\r\n';
}

function splitDoc(fileText: string): SplitDoc {
  return {
    lines: fileText.split(/\r?\n/),
    newline: fileText.includes('\r\n') ? '\r\n' : '\n',
  };
}

function joinDoc(lines: string[], newline: '\n' | '\r\n'): DocString {
  return lines.join(newline);
}

export function isMoveTargetInsideSourceSubtree(source: OutlineNode, target: OutlineNode): boolean {
  return target.line > source.line && target.line <= source.endLine;
}

export interface AddChildOptions {
  inheritParentListType?: boolean;
}

function childLinePrefix(parent: OutlineNode, inheritParentListType: boolean): string {
  const marker = inheritParentListType ? parent.marker : '-';
  const checkboxPrefix = inheritParentListType && parent.checkbox !== 'none' ? ' [ ]' : '';
  return `${parent.indent}\t${marker}${checkboxPrefix}`;
}

function preserveExistingCheckboxPrefix(node: OutlineNode, text: string): string {
  if (node.checkbox === 'none' || /^\[( |x|X)\]\s*/.test(text)) {
    return text;
  }

  const checkboxPrefix = node.checkbox === 'checked' ? '[x]' : '[ ]';
  return text ? `${checkboxPrefix} ${text}` : checkboxPrefix;
}

async function persistLines(
  app: App,
  file: TFile,
  lines: string[],
  newline: '\n' | '\r\n' = '\n'
): Promise<DocString> {
  return persistDoc(app, file, joinDoc(lines, newline));
}

async function persistDoc(app: App, file: TFile, newDoc: DocString): Promise<DocString> {
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
    } catch (err) {
      console.error(`Failed to write mindmap file "${file.path}".`, err);
      throw err;
    }
  }

  return newDoc;
}

async function persistDocIfChanged(app: App, file: TFile, beforeDoc: DocString, afterDoc: DocString): Promise<DocString> {
  if (afterDoc === beforeDoc) {
    return beforeDoc;
  }

  return persistDoc(app, file, afterDoc);
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

export function addChildInText(
  fileText: string,
  parent: OutlineNode,
  childInsertPosition: ChildInsertPosition = 'last',
  options: AddChildOptions = {}
): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const insertIndex = childInsertPosition === 'first' ? parent.line + 1 : parent.endLine + 1;
  const newLine = `${childLinePrefix(parent, options.inheritParentListType ?? false)} `;

  lines.splice(insertIndex, 0, newLine);
  return joinDoc(lines, newline);
}

export async function addChild(
  app: App,
  file: TFile,
  parent: OutlineNode,
  childInsertPosition: ChildInsertPosition = 'last',
  options: AddChildOptions = {}
): Promise<DocString> {
  let fileText: string;
  try {
    fileText = await app.vault.read(file);
  } catch {
    return "";
  }

  return await persistDocIfChanged(app, file, fileText, addChildInText(fileText, parent, childInsertPosition, options));
}

export async function addSibling(
  app: App,
  file: TFile,
  node: OutlineNode,
  siblingInsertPosition: SiblingInsertPosition = 'after'
): Promise<DocString> {
  let fileText: string;
  try {
    fileText = await app.vault.read(file);
  } catch {
    return "";
  }
  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const insertIndex = siblingInsertPosition === 'before'
    ? node.line
    : subtreeEnd(lines, node.line, node.indent);
  const newLine = `${node.indent}${node.marker} `;
  lines.splice(insertIndex, 0, newLine);

  return await persistLines(app, file, lines, newline);
}

export async function writeNode(
  app: App,
  file: TFile,
  node: OutlineNode,
  txt: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, writeNodeInText(fileText, node, txt));
}

export function writeNodeInText(
  fileText: string,
  node: OutlineNode,
  txt: string
): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  // Replace the single line with new content
  const prefix = node.indent + node.marker;
  const newLine = `${prefix} ${preserveExistingCheckboxPrefix(node, txt)}`;
  
  lines[node.line] = newLine;

  return joinDoc(lines, newline);
}

export function addHeadingBeforeNodeInText(
  fileText: string,
  node: OutlineNode,
  headingText: string = '# Heading'
): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line > lines.length) {
    return fileText;
  }

  lines.splice(node.line, 0, headingText);
  return joinDoc(lines, newline);
}

export async function addHeadingBeforeNode(
  app: App,
  file: TFile,
  node: OutlineNode,
  headingText: string = '# Heading'
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, addHeadingBeforeNodeInText(fileText, node, headingText));
}

export function writeHeadingInText(
  fileText: string,
  line: number,
  headingText: string
): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (line < 0 || line >= lines.length) {
    return fileText;
  }

  lines[line] = headingText;
  return joinDoc(lines, newline);
}

export function deleteHeadingInText(fileText: string, line: number): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (line < 0 || line >= lines.length) {
    return fileText;
  }

  if (!/^#{1,6}\s+\S/.test(lines[line].trim())) {
    return fileText;
  }

  lines.splice(line, 1);
  return joinDoc(lines, newline);
}

export async function writeHeading(
  app: App,
  file: TFile,
  line: number,
  headingText: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, writeHeadingInText(fileText, line, headingText));
}

export async function deleteHeading(
  app: App,
  file: TFile,
  line: number
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, deleteHeadingInText(fileText, line));
}

export async function writeMultipleNodes(
  app: App,
  file: TFile,
  nodes: OutlineNode[],
  transform: (node: OutlineNode) => string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const { lines, newline } = splitDoc(fileText);

  const sortedNodes = [...nodes].sort((a, b) => b.line - a.line);
  sortedNodes.forEach((node) => {
    if (node.line < 0 || node.line >= lines.length) {
      return;
    }

    const newText = transform(node);
    const prefix = node.indent + node.marker;
    lines[node.line] = `${prefix} ${newText}`;
  });

  return await persistLines(app, file, lines, newline);
}

export async function deleteNode(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, deleteNodeInText(fileText, node));
}

export function deleteNodeInText(fileText: string, node: OutlineNode): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const end = subtreeEnd(lines, node.line, node.indent);
  lines.splice(node.line, end - node.line);

  return joinDoc(lines, newline);
}

export async function deleteMultipleNodes(
  app: App,
  file: TFile,
  nodes: OutlineNode[]
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, deleteMultipleNodesInText(fileText, nodes));
}

export function deleteMultipleNodesInText(fileText: string, nodes: OutlineNode[]): DocString {
  const { lines, newline } = splitDoc(fileText);

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

  return joinDoc(lines, newline);
}

export async function deleteMultipleNodesKeepChildren(
  app: App,
  file: TFile,
  nodes: OutlineNode[]
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const { lines, newline } = splitDoc(fileText);

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

  return await persistLines(app, file, nextLines, newline);
}

export async function deleteNodeKeepChildren(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, deleteNodeKeepChildrenInText(fileText, node));
}

export function deleteNodeKeepChildrenInText(fileText: string, node: OutlineNode): DocString {
  const { lines, newline } = splitDoc(fileText);

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

  return joinDoc(lines, newline);
}

export async function moveSubtree(
  app: App,
  file: TFile,
  source: OutlineNode,
  target: OutlineNode,
  insertAsChild: boolean = true,
  childInsertPosition: ChildInsertPosition = 'first',
  siblingInsertPosition: SiblingInsertPosition = 'after',
  beforeState?: string
): Promise<DocString> {
  const fileText = beforeState || await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, moveSubtreeInText(
    fileText,
    source,
    target,
    insertAsChild,
    childInsertPosition,
    siblingInsertPosition
  ));
}

export function moveSubtreeInText(
  fileText: string,
  source: OutlineNode,
  target: OutlineNode,
  insertAsChild: boolean = true,
  childInsertPosition: ChildInsertPosition = 'first',
  siblingInsertPosition: SiblingInsertPosition = 'after'
): DocString {
  const { lines: originalLines, newline } = splitDoc(fileText);

  if (source.line < 0 || source.line >= originalLines.length ||
      target.line < 0 || target.line >= originalLines.length) {
    return fileText;
  }

  if (source.line === target.line) {
    return fileText;
  }

  // Moving a node relative to one of its own descendants would create an
  // impossible outline cycle once the source subtree is removed.
  const sourceEnd = subtreeEnd(originalLines, source.line, source.indent);
  if (target.line > source.line && target.line < sourceEnd) {
    return fileText;
  }

  // Extract source subtree
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
    insertionPoint = childInsertPosition === 'first'
      ? adjustedTargetLine + 1
      : subtreeEnd(linesAfterRemoval, adjustedTargetLine, target.indent);
  } else if (siblingInsertPosition === 'before') {
    insertionPoint = adjustedTargetLine;
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
  
  return joinDoc(finalLines, newline);
}

function indentMovedLines(sourceLines: string[], oldIndent: string, newIndent: string): string[] {
  return sourceLines.map((line) => {
    if (line.trim() === '') return line;

    if (line.startsWith(oldIndent)) {
      return `${newIndent}${line.slice(oldIndent.length)}`;
    }

    return `${newIndent}${line.replace(/^\s+/, '')}`;
  });
}

export function moveSubtreeToEmptyHeadingInText(
  fileText: string,
  source: OutlineNode,
  headingLine: number
): DocString {
  const { lines: originalLines, newline } = splitDoc(fileText);

  if (
    source.line < 0 ||
    source.line >= originalLines.length ||
    headingLine < 0 ||
    headingLine >= originalLines.length ||
    !/^#{1,6}\s+\S/.test(originalLines[headingLine].trim())
  ) {
    return fileText;
  }

  const sourceEnd = subtreeEnd(originalLines, source.line, source.indent);
  if (headingLine >= source.line && headingLine < sourceEnd) {
    return fileText;
  }

  const sourceLines = originalLines.slice(source.line, sourceEnd);
  const linesAfterRemoval = [
    ...originalLines.slice(0, source.line),
    ...originalLines.slice(sourceEnd),
  ];
  const adjustedHeadingLine = headingLine > source.line
    ? headingLine - (sourceEnd - source.line)
    : headingLine;
  const adjustedSourceLines = indentMovedLines(sourceLines, source.indent, '');

  linesAfterRemoval.splice(adjustedHeadingLine + 1, 0, ...adjustedSourceLines);
  return joinDoc(linesAfterRemoval, newline);
}

export function addEmptyNodeToHeadingInText(
  fileText: string,
  headingLine: number
): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (
    headingLine < 0 ||
    headingLine >= lines.length ||
    !/^#{1,6}\s+\S/.test(lines[headingLine].trim())
  ) {
    return fileText;
  }

  lines.splice(headingLine + 1, 0, '- ');
  return joinDoc(lines, newline);
}

export async function addEmptyNodeToHeading(
  app: App,
  file: TFile,
  headingLine: number
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, addEmptyNodeToHeadingInText(fileText, headingLine));
}

export async function moveSubtreeToEmptyHeading(
  app: App,
  file: TFile,
  source: OutlineNode,
  headingLine: number
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, moveSubtreeToEmptyHeadingInText(fileText, source, headingLine));
}

export async function addChildText(
  app: App,
  file: TFile,
  parent: OutlineNode,
  text: string,
  childInsertPosition: ChildInsertPosition = 'last',
  options: AddChildOptions = {}
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  return await persistDocIfChanged(app, file, fileText, addChildTextInText(fileText, parent, text, childInsertPosition, options));
}

export function addChildTextInText(
  fileText: string,
  parent: OutlineNode,
  text: string,
  childInsertPosition: ChildInsertPosition = 'last',
  options: AddChildOptions = {}
): DocString {
  const { lines, newline } = splitDoc(fileText);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const insertIndex = childInsertPosition === 'first' ? parent.line + 1 : parent.endLine + 1;
  
  // Create child with proper indentation
  const newLine = `${childLinePrefix(parent, options.inheritParentListType ?? false)} ${text}`;
  
  lines.splice(insertIndex, 0, newLine);

  return joinDoc(lines, newline);
}

export async function addSiblingText(
  app: App,
  file: TFile,
  target: OutlineNode,
  text: string,
  siblingInsertPosition: SiblingInsertPosition = 'after'
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const { lines, newline } = splitDoc(fileText);

  if (target.line < 0 || target.line >= lines.length) {
    return fileText;
  }

  const insertIndex = siblingInsertPosition === 'before'
    ? target.line
    : subtreeEnd(lines, target.line, target.indent);
  const newLine = `${target.indent}${target.marker} ${text}`;

  lines.splice(insertIndex, 0, newLine);

  return await persistLines(app, file, lines, newline);
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
  const { lines, newline } = splitDoc(fileText);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const pastedLines = preparePastedOutlineLines(text, parent.indent + '\t');
  if (pastedLines.length === 0) return fileText;

  lines.splice(parent.endLine + 1, 0, ...pastedLines);

  return await persistLines(app, file, lines, newline);
}

export async function cutPasteMarkdownAsChildren(
  app: App,
  file: TFile,
  sourceNodes: OutlineNode[],
  parent: OutlineNode,
  text: string
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const { lines, newline } = splitDoc(fileText);

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

  return await persistLines(app, file, keptLines, newline);
}

export async function duplicateSubtree(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const subtreeLines = lines.slice(node.line, node.endLine + 1);
  lines.splice(node.endLine + 1, 0, ...subtreeLines);

  return await persistLines(app, file, lines, newline);
}
