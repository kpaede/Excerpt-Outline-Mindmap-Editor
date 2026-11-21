import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { cursorIsInMarkdownList, waitForListContext } from '../src/editor/list-context';

function atCursor(text: string) {
  const position = text.indexOf('|');
  return EditorState.create({ doc: text.replace('|', ''), selection: { anchor: position }, extensions: [markdown()] });
}

describe('Enter follows the actual Markdown list context', () => {
  it.each(['- Item|', '* Item|', '+ Item|', '1. Item|', '2) Item|', '- [ ] Task|', '- [x] Task|', '- |', '1. |', '- Parent\n  - Child|', '- Parent\n  - |', '- Parent\n  continuation|', '> - Quoted item|', '|- Item'])('continues the list for %j', text => {
    expect(cursorIsInMarkdownList(atCursor(text))).toBe(true);
  });
  it.each(['Paragraph|', '|', '- Item\n|', '- Item\n\n|', '\\- Escaped|', '~~~md\n- Code only|\n~~~', '```\n1. Code only|\n```', '> Quote|', '# Heading|', '---|'])('saves outside lists for %j', text => {
    expect(cursorIsInMarkdownList(atCursor(text))).toBe(false);
  });
  it('does not save while one of several cursors is in a list', () => {
    const state = EditorState.create({ doc: 'Paragraph\n\n- Item', extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(17)]) });
    expect(cursorIsInMarkdownList(state)).toBe(true);
  });
});

it('recognizes a list after more than 100k characters before background parsing catches up',async()=>{
  const state=atCursor(('Long paragraph with Unicode 日本語.\n\n').repeat(4000)+'- Tail list|');
  expect(state.doc.length).toBeGreaterThan(100000);
  expect(await waitForListContext(()=>state)).toBe(true);
});
it('does not mistake code after a long excerpt for a list',async()=>{
  const state=atCursor(('Paragraph.\n\n').repeat(10000)+'~~~md\n- Code only|\n~~~');
  expect(await waitForListContext(()=>state)).toBe(false);
});

it('cancels pending Enter when the draft or selection changes',async()=>{
 const original=atCursor(('Paragraph.\n\n').repeat(20000)+'- Tail|');let current=original;const pending=waitForListContext(()=>current);current=atCursor('New typing|');expect(await pending).toBeUndefined();
});
