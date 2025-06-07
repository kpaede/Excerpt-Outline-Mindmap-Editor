import { App, TFile, MarkdownView } from 'obsidian';
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
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)/);
    const lineIndent = m ? m[1] : '';
    if (lineIndent.length <= indent.length) {
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

  // Always insert as FIRST child - immediately after parent line
  // with one additional tab level
  const childIndent = parent.indent + '\t';
  const newLine = `${childIndent}- `;
  
  // Insert right after the parent line (not after existing children)
  lines.splice(parent.line + 1, 0, newLine);

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

  // Find the end of this node's entire subtree
  const insertIndex = subtreeEnd(lines, node.line, node.indent);
  
  // Create sibling with same indentation and same marker type as current node
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

  const m = lines[node.line].match(/^(\s*[-*+]|\s*\d+\.)\s*(\[[xX \-]\]\s*)?/);
  let prefix = node.indent + node.marker;
  if (m && m[2]) prefix += ' ' + m[2].trim();
  lines[node.line] = `${prefix} ${txt}`;

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

  const baseIndent = node.indent + '\t';
  const end = subtreeEnd(lines, node.line, node.indent);

  lines.splice(node.line, end - node.line);

  for (let i = node.line; i < lines.length; i++) {
    if (lines[i].startsWith(baseIndent)) {
      lines[i] = lines[i].replace(/^\t/, '');
    } else {
      const indentLen = lines[i].match(/^\s*/)?.[0].length ?? 0;
      if (indentLen < baseIndent.length) break;
    }
  }

  await persistLines(app, file, lines);
  const refreshed = await app.vault.read(file);
  return refreshed;
}

/* ── Node entfernen, aber Children behalten und um eine Tab-Ebene reduzieren ───────────────────── */
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

	// Entferne nur die Zeile des aktuellen Knotens
	lines.splice(node.line, 1);

	// Reduziere die Einrückung jedes untergeordneten Knotens (sofern vorhanden)
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
  source: OutlineNode, // Node to be moved
  target: OutlineNode, // Node relative to which the source is moved
  insertAsChild: boolean = true
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const originalLines = fileText.split(/\r?\n/);

  if (source.line < 0 || source.line >= originalLines.length ||
      target.line < 0 || target.line >= originalLines.length) {
    // Invalid line numbers, return original text
    return fileText;
  }

  // 1. Identify the source subtree chunk
  // subtreeEnd returns the line *after* the subtree
  const srcSubtreeEndIndex = subtreeEnd(originalLines, source.line, source.indent);
  const chunkToMove = originalLines.slice(source.line, srcSubtreeEndIndex);

  // 2. Prevent moving a node into its own subtree
  if (target.line >= source.line && target.line < srcSubtreeEndIndex) {
    // Target is inside the source chunk, this is an invalid move
    return fileText;
  }

  // 3. Create a temporary list of lines with the chunk removed
  let lines = [...originalLines];
  lines.splice(source.line, chunkToMove.length);

  // 4. Adjust target line index if source was before target in the original document
  let adjustedTargetLine = target.line;
  if (source.line < target.line) {
    adjustedTargetLine -= chunkToMove.length;
  }
  
  // Safety check for adjustedTargetLine, though other checks should prevent out-of-bounds.
  if (adjustedTargetLine < 0 || adjustedTargetLine >= lines.length) {
      // This implies a problematic state, potentially target was part of source or file structure is unexpected.
      // Fallback to original text to prevent corruption.
      return fileText;
  }

  // 5. Determine the new base indent for the source node and the insertion index
  let newSourceNodeBaseIndent: string;
  let insertAtIndex: number;

  if (insertAsChild) {
    // Source node becomes a child of the target node
    // Add one more tab level to ensure proper child indentation
    newSourceNodeBaseIndent = target.indent + '\t';
    // Insert immediately after the target line
    insertAtIndex = adjustedTargetLine + 1;
  } else {
    // Source node becomes a sibling of the target node
    newSourceNodeBaseIndent = target.indent;
    // Insert after the target's entire subtree in the 'lines' array (where chunk is removed)
    // Use target.indent (from original node data) for subtreeEnd logic
    const targetSubtreeEndInPrunedLines = subtreeEnd(lines, adjustedTargetLine, target.indent);
    insertAtIndex = targetSubtreeEndInPrunedLines;
  }

  // 6. Re-indent the chunk
  const reIndentedChunk = chunkToMove.map(lineInChunk => {
    const match = lineInChunk.match(/^(\s*)(.*)$/);
    const originalLineIndent = match ? match[1] : '';
    const textContentWithMarker = match ? match[2] : ''; // Includes list marker like "- " or "1. "

    let relativeIndentToSource = '';
    // Ensure originalLineIndent starts with source.indent to correctly calculate relative part
    if (originalLineIndent.startsWith(source.indent)) {
      relativeIndentToSource = originalLineIndent.substring(source.indent.length);
    } else {
      // This case implies the line was not correctly part of the source's hierarchy
      // or mixed indentation (e.g. source uses spaces, child uses tabs not prefixed by those spaces).
      // To be safe, we don't add a relative indent, or treat it as a direct child if it's more indented.
      // For simplicity here, we assume it's correctly a child and its indent relative to source.indent is what matters.
      // If originalLineIndent is shorter, substring might error or give weird results.
      // However, subtreeEnd should ensure lines in chunk are >= source.indent.
      // If it's exactly source.indent, substring gives "".
    }
    
    return newSourceNodeBaseIndent + relativeIndentToSource + textContentWithMarker;
  });

  // 7. Insert the re-indented chunk into the 'lines' array
  lines.splice(insertAtIndex, 0, ...reIndentedChunk);

  // 8. Persist changes
  await persistLines(app, file, lines);
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

  const clean = text.replace(/\r?\n/g, ' ').trim();
  const newLine = `${parent.indent}\t- ${clean}`;

  lines.splice(parent.line + 1, 0, newLine);
  await persistLines(app, file, lines);

  const refreshed = await app.vault.read(file);
  return refreshed;
}

export async function createFirstNode(
  app: App,
  file: TFile
): Promise<DocString> {
  const fileText = await app.vault.read(file);
  const lines = fileText.split(/\r?\n/);
  
  // Find where to insert (after frontmatter if present)
  let insertIndex = 0;
  if (lines[0]?.trim() === '---') {
    const frontmatterEnd = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (frontmatterEnd !== -1) {
      insertIndex = frontmatterEnd + 1;
      // Add empty line after frontmatter if it doesn't exist
      if (lines[insertIndex]?.trim() !== '') {
        lines.splice(insertIndex, 0, '');
        insertIndex++;
      }
    }
  }
  
  // Insert the first node
  lines.splice(insertIndex, 0, '- ');
  
  await persistLines(app, file, lines);
  const refreshed = await app.vault.read(file);
  return refreshed;
}
