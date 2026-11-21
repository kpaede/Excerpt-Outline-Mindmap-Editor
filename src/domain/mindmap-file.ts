import type { App, TFile } from 'obsidian';
import { parseOutline, flattenOutline, type OutlineNode, type CheckboxState } from '../utils/outline';
import { encodeNodeContent, frontmatterEnd, outlineVersion, serializeOutline } from './outline-format';
import { commitDocument, readDocument, DocumentConflictError } from '../storage/document-writer';

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

async function persistDocIfChanged(app: App, file: TFile, beforeDoc: DocString, afterDoc: DocString): Promise<DocString> {
  if (afterDoc === beforeDoc) return beforeDoc;
  return commitDocument(app, file, beforeDoc, afterDoc);
}

function assertNode(fileText: string, node: OutlineNode): void {
  if (node.sourceDoc !== undefined && node.sourceDoc !== fileText) throw new DocumentConflictError();
  if (node.sourceDoc === fileText && node.format === 2) return;
  if (outlineVersion(fileText) === 2) parseOutline(fileText);
  else if (fileText.split(/\r?\n/).slice(node.line + 1, node.endLine + 1).some(line => /^#{1,6}\s+\S/.test(line.trim()))) {
    throw new Error('Legacy subtree crosses a document heading. Review its indentation in Markdown before editing. Original retained.');
  }
}

function subtreeEnd(lines: string[], start: number, _indent: string): number {
  const node = flattenOutline(parseOutline(lines.join('\n'))).find(node => node.line === start);
  return node?.subtreeEnd ?? start + 1;
}

function ownEnd(node: OutlineNode): number { return node.ownEnd ?? node.line + 1; }
function contentLines(fileText: string, node: OutlineNode, text: string, checkbox = node.checkbox): string[] {
  if (outlineVersion(fileText) === 2) return encodeNodeContent(text, checkbox, node.indent);
  if (/[\r\n]/.test(text)) throw new Error('Preview migration to multiline outline before adding multiline content.');
  return [`${node.indent}${node.marker} ${preserveExistingCheckboxPrefix(node, text)}`];
}

export function addChildInText(
  fileText: string,
  parent: OutlineNode,
  childInsertPosition: ChildInsertPosition = 'last',
  options: AddChildOptions = {}
): DocString {
  assertNode(fileText, parent);

  const { lines, newline } = splitDoc(fileText);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const insertIndex = childInsertPosition === 'first' ? ownEnd(parent) : parent.endLine + 1;
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
  const fileText = await readDocument(app, file);

  return await persistDocIfChanged(app, file, fileText, addChildInText(fileText, parent, childInsertPosition, options));
}

export async function addSibling(
  app: App,
  file: TFile,
  node: OutlineNode,
  siblingInsertPosition: SiblingInsertPosition = 'after'
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  assertNode(fileText, node);
  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const insertIndex = siblingInsertPosition === 'before'
    ? node.line
    : subtreeEnd(lines, node.line, node.indent);
  const newLine = `${node.indent}${node.marker} `;
  lines.splice(insertIndex, 0, newLine);

  return await persistDocIfChanged(app, file, fileText, joinDoc(lines, newline));
}

export async function writeNode(
  app: App,
  file: TFile,
  node: OutlineNode,
  txt: string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  assertNode(fileText, node);

  return await persistDocIfChanged(app, file, fileText, writeNodeInText(fileText, node, txt));
}

export function writeNodeInText(
  fileText: string,
  node: OutlineNode,
  txt: string
): DocString {
  assertNode(fileText, node);

  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  lines.splice(node.line, ownEnd(node) - node.line, ...contentLines(fileText, node, txt));

  return joinDoc(lines, newline);
}

export function addHeadingBeforeNodeInText(
  fileText: string,
  node: OutlineNode,
  headingText: string = '# Heading'
): DocString {
  assertNode(fileText, node);

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
  const fileText = await readDocument(app, file);
  assertNode(fileText, node);

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
  headingText: string,
  expectedDoc?: string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  if (expectedDoc !== undefined && expectedDoc !== fileText) throw new DocumentConflictError();
  return await persistDocIfChanged(app, file, fileText, writeHeadingInText(fileText, line, headingText));
}

export async function deleteHeading(
  app: App,
  file: TFile,
  line: number,
  expectedDoc?: string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  if (expectedDoc !== undefined && expectedDoc !== fileText) throw new DocumentConflictError();
  return await persistDocIfChanged(app, file, fileText, deleteHeadingInText(fileText, line));
}

export async function writeMultipleNodes(
  app: App,
  file: TFile,
  nodes: OutlineNode[],
  transform: (node: OutlineNode) => string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  nodes.forEach(n => assertNode(fileText, n));

  const { lines, newline } = splitDoc(fileText);

  const sortedNodes = [...nodes].sort((a, b) => b.line - a.line);
  sortedNodes.forEach((node) => {
    if (node.line < 0 || node.line >= lines.length) {
      return;
    }

    const newText = transform(node);
    assertNode(fileText, node);
    const replacement = outlineVersion(fileText) === 2
      ? encodeNodeContent(newText, node.checkbox, node.indent)
      : [`${node.indent}${node.marker} ${newText}`];
    lines.splice(node.line, ownEnd(node) - node.line, ...replacement);
  });

  return await persistDocIfChanged(app, file, fileText, joinDoc(lines, newline));
}

export async function deleteNode(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  assertNode(fileText, node);

  return await persistDocIfChanged(app, file, fileText, deleteNodeInText(fileText, node));
}

export function deleteNodeInText(fileText: string, node: OutlineNode): DocString {
  assertNode(fileText, node);

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
  const fileText = await readDocument(app, file);
  nodes.forEach(n => assertNode(fileText, n));

  return await persistDocIfChanged(app, file, fileText, deleteMultipleNodesInText(fileText, nodes));
}

export function deleteMultipleNodesInText(fileText: string, nodes: OutlineNode[]): DocString {
  nodes.forEach(n => assertNode(fileText, n));

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
  const fileText = await readDocument(app, file);
  nodes.forEach(n => assertNode(fileText, n));

  const { lines, newline } = splitDoc(fileText);

  const selectedLines = new Set(nodes.reduce<number[]>((all, node) => all.concat(Array.from({ length: ownEnd(node) - node.line }, (_, i) => node.line + i)), []));
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

  return await persistDocIfChanged(app, file, fileText, joinDoc(nextLines, newline));
}

export async function deleteNodeKeepChildren(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  assertNode(fileText, node);

  return await persistDocIfChanged(app, file, fileText, deleteNodeKeepChildrenInText(fileText, node));
}

export function deleteNodeKeepChildrenInText(fileText: string, node: OutlineNode): DocString {
  assertNode(fileText, node);

  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const end = subtreeEnd(lines, node.line, node.indent);
  const children = lines.slice(ownEnd(node), end).map(line =>
    line.startsWith(node.indent + '\t') ? node.indent + line.slice(node.indent.length + 1) : line);
  lines.splice(node.line, end - node.line, ...children);

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
  const fileText = beforeState || await readDocument(app, file);
  assertNode(fileText, source);
  assertNode(fileText, target);

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
  assertNode(fileText, source);
  assertNode(fileText, target);

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
      ? adjustedTargetLine + ownEnd(target) - target.line
      : subtreeEnd(linesAfterRemoval, adjustedTargetLine, target.indent);
  } else if (siblingInsertPosition === 'before') {
    insertionPoint = adjustedTargetLine;
  } else {
    const targetEnd = subtreeEnd(linesAfterRemoval, adjustedTargetLine, target.indent);
    insertionPoint = targetEnd;
  }
  
  // Calculate new indentation
  const newIndent = insertAsChild ? target.indent + '\t' : target.indent;
  const adjustedSourceLines = sourceLines.map(line =>
    newIndent + line.slice(source.indent.length));

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
    if (line === '') return line;

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
  assertNode(fileText, source);

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
  headingLine: number,
  expectedDoc?: string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  if (expectedDoc !== undefined && expectedDoc !== fileText) throw new DocumentConflictError();
  return await persistDocIfChanged(app, file, fileText, addEmptyNodeToHeadingInText(fileText, headingLine));
}

export async function moveSubtreeToEmptyHeading(
  app: App,
  file: TFile,
  source: OutlineNode,
  headingLine: number,
  expectedDoc?: string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  if (expectedDoc !== undefined && expectedDoc !== fileText) throw new DocumentConflictError();
  assertNode(fileText, source);

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
  const fileText = await readDocument(app, file);
  assertNode(fileText, parent);

  return await persistDocIfChanged(app, file, fileText, addChildTextInText(fileText, parent, text, childInsertPosition, options));
}

export function addChildTextInText(
  fileText: string,
  parent: OutlineNode,
  text: string,
  childInsertPosition: ChildInsertPosition = 'last',
  options: AddChildOptions = {}
): DocString {
  assertNode(fileText, parent);

  const { lines, newline } = splitDoc(fileText);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  const insertIndex = childInsertPosition === 'first' ? ownEnd(parent) : parent.endLine + 1;
  
  if (outlineVersion(fileText) === 1 && /[\r\n]/.test(text)) throw new Error('Preview migration to multiline outline before adding multiline content.');

  // Create child with proper indentation
  const newLine = outlineVersion(fileText) === 2
    ? encodeNodeContent(text, options.inheritParentListType && parent.checkbox !== 'none' ? 'unchecked' : 'none', parent.indent + '\t').join(newline)
    : `${childLinePrefix(parent, options.inheritParentListType ?? false)} ${text}`;
  
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
  const fileText = await readDocument(app, file);
  assertNode(fileText, target);

  const { lines, newline } = splitDoc(fileText);

  if (target.line < 0 || target.line >= lines.length) {
    return fileText;
  }

  const insertIndex = siblingInsertPosition === 'before'
    ? target.line
    : subtreeEnd(lines, target.line, target.indent);
  const newLine = contentLines(fileText, { ...target, checkbox: 'none' }, text).join(newline);

  lines.splice(insertIndex, 0, newLine);

  return await persistDocIfChanged(app, file, fileText, joinDoc(lines, newline));
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
  text: string,
  sourceFormat?: 1 | 2
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  assertNode(fileText, parent);

  const { lines, newline } = splitDoc(fileText);

  if (parent.line < 0 || parent.line >= lines.length) {
    return fileText;
  }

  sourceFormat ??= outlineVersion(text) === 2 ? 2 : undefined;
  const pastedLines = outlineVersion(fileText) === 2
    ? multilinePasteLines(text, parent.indent + '\t', sourceFormat)
    : sourceFormat === 2 ? legacyPastedLines(text, parent.indent + '\t') : preparePastedOutlineLines(text, parent.indent + '\t');
  if (pastedLines.length === 0) return fileText;

  lines.splice(parent.endLine + 1, 0, ...pastedLines);

  return await persistDocIfChanged(app, file, fileText, joinDoc(lines, newline));
}

export async function cutPasteMarkdownAsChildren(
  app: App,
  file: TFile,
  sourceNodes: OutlineNode[],
  parent: OutlineNode,
  _text: string
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  sourceNodes.forEach(n => assertNode(fileText, n));
  assertNode(fileText, parent);

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

  // Move the current parsed subtrees. A clipboard snapshot may be older
  // than edits made after Cut and must never replace their newer content.
  const pastedLines = topLevelNodes.reduce<string[]>((result, node) => result.concat(
    lines.slice(node.line, node.endLine + 1).map(line => line.startsWith(node.indent)
      ? parent.indent + '\t' + line.slice(node.indent.length) : line)
  ), []);
  if (!pastedLines.length) return fileText;

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

  return await persistDocIfChanged(app, file, fileText, joinDoc(keptLines, newline));
}

export async function duplicateSubtree(
  app: App,
  file: TFile,
  node: OutlineNode
): Promise<DocString> {
  const fileText = await readDocument(app, file);
  assertNode(fileText, node);

  const { lines, newline } = splitDoc(fileText);

  if (node.line < 0 || node.line >= lines.length) {
    return fileText;
  }

  const subtreeLines = lines.slice(node.line, node.endLine + 1);
  lines.splice(node.endLine + 1, 0, ...subtreeLines);

  return await persistDocIfChanged(app, file, fileText, joinDoc(lines, newline));
}


function multilinePasteLines(text: string, indent: string, sourceFormat?: 1 | 2): string[] {
  let roots: OutlineNode[];
  let parsedSource = text;
  if (outlineVersion(text) === 2 || sourceFormat === 1) roots = parseOutline(text);
  else {
    // This is the explicit outline-paste action, outside the text editor.
    // Strict tab outlines may include continuation lines. Plain prose is one node.
    const canonical = `---\neome-outline-format: 2\n---\n${text}`;
    if (/^(?:\t*)- /.test(text)) {
      parsedSource = canonical;
      roots = parseOutline(canonical);
    } else if (/^\s*[-*+]|^\s*\d+\./.test(text)) {
      if (!text.split(/\r?\n/).every(line => /^\s*(?:[-*+]|\d+\.)(?:\s.*)?$/.test(line))) {
        throw new Error('Ambiguous outline paste. Paste this text inside the node editor instead.');
      }
      roots = parseOutline(text);
    } else return encodeNodeContent(text, 'none', indent);
  }
  const sourceLines = parsedSource.split(/\r?\n/);
  const owned = new Set<number>();
  flattenOutline(roots).forEach(node => {
    for (let line = node.line; line < ownEnd(node); line++) owned.add(line);
  });
  if (!roots.length || sourceLines.some((line, index) => index >= frontmatterEnd(sourceLines) && line !== '' && !owned.has(index))) {
    throw new Error('Outline paste contains document text outside thoughts. Paste it inside the node editor to retain everything.');
  }
  return serializeOutline(roots).split('\n').map(line => indent + line);
}

export function setNodeCheckboxInText(fileText: string, node: OutlineNode, checkbox: CheckboxState): string {
  assertNode(fileText, node);
  const { lines, newline } = splitDoc(fileText);
  if (outlineVersion(fileText) === 2) {
    lines.splice(node.line, ownEnd(node) - node.line, ...encodeNodeContent(node.text, checkbox, node.indent));
  } else {
    const task = checkbox === 'none' ? '' : checkbox === 'checked' ? '[x] ' : '[ ] ';
    lines[node.line] = `${node.indent}${node.marker} ${task}${node.text}`;
  }
  return joinDoc(lines, newline);
}

export async function setNodesCheckbox(app: App, file: TFile, nodes: OutlineNode[], checkbox: CheckboxState): Promise<string> {
  const before = await readDocument(app, file);
  nodes.forEach(node => assertNode(before, node));
  let after = before;
  for (const node of [...nodes].sort((a, b) => b.line - a.line)) {
    after = setNodeCheckboxInText(after, { ...node, sourceDoc: after }, checkbox);
  }
  return persistDocIfChanged(app, file, before, after);
}


function legacyPastedLines(text: string, indent: string): string[] {
  const source = outlineVersion(text) === 2 ? text : `---\neome-outline-format: 2\n---\n${text}`;
  const roots = parseOutline(source);
  const owned = new Set<number>();
  flattenOutline(roots).forEach(node => { for (let line = node.line; line < ownEnd(node); line++) owned.add(line); });
  const lines = source.split(/\r?\n/);
  if (!roots.length || lines.some((line, index) => index >= frontmatterEnd(lines) && line !== '' && !owned.has(index))) {
    throw new Error('Clipboard contains document text outside thoughts. Paste it inside the node editor to retain everything.');
  }
  const result: string[] = [];
  const visit = (node: OutlineNode, prefix: string) => {
    if (/[\r\n]/.test(node.text) || (node.checkbox === 'none' && /^\[( |x|X)\]\s/.test(node.text))) {
      throw new Error('This clipboard contains multiline thought content. Preview migration of the target file before pasting.');
    }
    const task = node.checkbox === 'checked' ? '[x] ' : node.checkbox === 'unchecked' ? '[ ] ' : '';
    result.push(`${prefix}- ${task}${node.text}`);
    node.children.forEach(child => visit(child, prefix + '\t'));
  };
  roots.forEach(node => visit(node, indent));
  return result;
}
