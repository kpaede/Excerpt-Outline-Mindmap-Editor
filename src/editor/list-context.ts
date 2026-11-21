import type { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

/** Use the editor's Markdown tree; a dash in code or escaped text is no list. */
export function cursorIsInMarkdownList(state: EditorState): boolean | null {
  // Long pasted documents may only have a partially parsed tree. Complete it
  // up to the cursor on Enter, with a bounded budget, rather than mis-saving
  // a list at the end of the document. This never runs on ordinary typing.
  const cursor = Math.max(...state.selection.ranges.map(range => range.head));
  const tree = ensureSyntaxTree(state, cursor, 20);
  if (!tree) return null;
  return state.selection.ranges.some(range => {
    const line = state.doc.lineAt(range.head);
    const end = line.from + line.text.replace(/[ \t]+$/, '').length;
    if (end === line.from) return false;
    const position = Math.min(range.head, end);
    let node = tree.resolveInner(position, position === line.from ? 1 : -1);
    for (;;) {
      // Obsidian uses HyperMD's token tree; ordinary Markdown uses ListItem.
      if (node.name === 'ListItem' || /(?:^|_)HyperMD-list-line(?:_|$)/.test(node.name)) return true;
      if (!node.parent) return false;
      node = node.parent;
    }
  });
}

/** Yield between parser slices; never treat an unfinished tree as "not a list". */
export async function waitForListContext(readState: () => EditorState, isActive = () => true): Promise<boolean | undefined> {
  const initial = readState();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!isActive()) return undefined;
    const state = readState();
    if (state.doc !== initial.doc || !state.selection.eq(initial.selection)) return undefined;
    const context = cursorIsInMarkdownList(state);
    if (context !== null) return context;
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  }
  throw new Error('The editor is still parsing. Your draft is retained; Ctrl/Cmd+Enter can save it.');
}
