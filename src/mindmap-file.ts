import { App, TFile, MarkdownView, Notice } from 'obsidian';
import { OutlineNode } from './util';

export type DocString = string;

async function persistLines(app: App, file: TFile, lines: string[]): Promise<void> {
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

  await persistLines(app, file, lines);

  let refreshed: string;
  try {
    refreshed = await app.vault.read(file);
  } catch (err) {
    refreshed = lines.join('\n');
  }
  return refreshed;
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

  await persistLines(app, file, lines);

  let refreshed: string;
  try {
    refreshed = await app.vault.read(file);
  } catch (err) {
    refreshed = lines.join('\n');
  }
  return refreshed;
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

  await persistLines(app, file, lines);
  const refreshed = await app.vault.read(file);
  return refreshed;
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

  await persistLines(app, file, lines);
  const refreshed = await app.vault.read(file);
  return refreshed;
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

  await persistLines(app, file, lines);
  const refreshed = await app.vault.read(file);
  return refreshed;
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
  
  await persistLines(app, file, finalLines);
  const refreshed = await app.vault.read(file);
  return refreshed;
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

  await persistLines(app, file, lines);
  const refreshed = await app.vault.read(file);
  return refreshed;
}
