import { describe, expect, it } from 'vitest';
import {
  addChildInText,
  addChildTextInText,
  addEmptyNodeToHeadingInText,
  addHeadingBeforeNodeInText,
  addMarkdownAsChildren,
  cutPasteMarkdownAsChildren,
  deleteHeadingInText,
  deleteMultipleNodesInText,
  deleteMultipleNodesKeepChildren,
  moveSubtreeToEmptyHeadingInText,
  moveSubtreeInText,
  writeHeadingInText,
  writeMultipleNodes,
  writeNodeInText,
} from '../src/domain/mindmap-file';
import type { CheckboxState, OutlineNode } from '../src/utils/outline';

function node(
  text: string,
  line: number,
  endLine: number,
  indent: string = '',
  checkbox: CheckboxState = 'none',
  marker: string = '-'
): OutlineNode {
  return {
    text,
    line,
    endLine,
    indent,
    marker,
    checkbox,
    children: [],
  };
}

function mockApp(initialText: string) {
  let text = initialText;

  return {
    app: {
      vault: {
        read: async () => text,
        modify: async (_file: unknown, newText: string) => {
          text = newText;
        },
      },
      workspace: {
        getLeavesOfType: () => [],
      },
    },
    file: {},
    getText: () => text,
  };
}

describe('mindmap file text operations', () => {
  it('adds a plain bullet child by default', () => {
    const input = '- [x] Parent';
    const parent = node('Parent', 0, 0, '', 'checked');

    expect(addChildInText(input, parent)).toBe('- [x] Parent\n\t- ');
  });

  it('can inherit the parent checkbox type for new children', () => {
    const input = '- [x] Parent';
    const parent = node('Parent', 0, 0, '', 'checked');

    expect(addChildInText(input, parent, 'last', { inheritParentListType: true }))
      .toBe('- [x] Parent\n\t- [ ] ');
  });

  it('can inherit the parent checkbox type when adding child text', () => {
    const input = '- [ ] Parent';
    const parent = node('Parent', 0, 0, '', 'unchecked');

    expect(addChildTextInText(input, parent, 'Child', 'last', { inheritParentListType: true }))
      .toBe('- [ ] Parent\n\t- [ ] Child');
  });

  it('preserves an existing checkbox when editing node text', () => {
    const input = '- [ ] Old text';
    const target = node('Old text', 0, 0, '', 'unchecked');

    expect(writeNodeInText(input, target, 'New text')).toBe('- [ ] New text');
  });

  it('does not double-prefix checkbox text supplied by callers', () => {
    const input = '- [ ] Old text';
    const target = node('Old text', 0, 0, '', 'unchecked');

    expect(writeNodeInText(input, target, '[x] New text')).toBe('- [x] New text');
  });

  it('adds a heading before the selected root node', () => {
    const input = [
      '- Root',
      '\t- Child',
      '- Second',
    ].join('\n');

    expect(addHeadingBeforeNodeInText(input, node('Root', 0, 1), '# Heading')).toBe([
      '# Heading',
      '- Root',
      '\t- Child',
      '- Second',
    ].join('\n'));
  });

  it('edits heading lines as raw markdown', () => {
    const input = [
      '# Old heading',
      '- Root',
    ].join('\n');

    expect(writeHeadingInText(input, 0, '## New heading')).toBe([
      '## New heading',
      '- Root',
    ].join('\n'));
  });

  it('deletes a heading line without deleting its nodes', () => {
    const input = [
      '# Heading',
      '- Node',
      '\t- Child',
    ].join('\n');

    expect(deleteHeadingInText(input, 0)).toBe([
      '- Node',
      '\t- Child',
    ].join('\n'));
  });

  it('moves a subtree as the first node inside an empty heading', () => {
    const input = [
      '# Source',
      '- Parent',
      '\t- Child',
      '# Empty',
    ].join('\n');

    expect(moveSubtreeToEmptyHeadingInText(input, node('Parent', 1, 2), 3)).toBe([
      '# Source',
      '# Empty',
      '- Parent',
      '\t- Child',
    ].join('\n'));
  });

  it('adds a new empty node inside an empty heading', () => {
    const input = [
      '# Empty',
      '# Next',
      '- Node',
    ].join('\n');

    expect(addEmptyNodeToHeadingInText(input, 0)).toBe([
      '# Empty',
      '- ',
      '# Next',
      '- Node',
    ].join('\n'));
  });

  it('moves a subtree to the upper-left drop zone as sibling before target', () => {
    const input = [
      '- A',
      '\t- A child',
      '- B',
      '\t- B child',
      '- C',
    ].join('\n');
    const source = node('B', 2, 3);
    const target = node('A', 0, 1);

    expect(moveSubtreeInText(input, source, target, false, 'first', 'before')).toBe([
      '- B',
      '\t- B child',
      '- A',
      '\t- A child',
      '- C',
    ].join('\n'));
  });

  it('moves a subtree to the upper-right drop zone as sibling after target subtree', () => {
    const input = [
      '- A',
      '\t- A child',
      '- B',
      '\t- B child',
      '- C',
    ].join('\n');
    const source = node('C', 4, 4);
    const target = node('A', 0, 1);

    expect(moveSubtreeInText(input, source, target, false, 'first', 'after')).toBe([
      '- A',
      '\t- A child',
      '- C',
      '- B',
      '\t- B child',
    ].join('\n'));
  });

  it('moves a subtree to the lower-left drop zone as first child', () => {
    const input = [
      '- A',
      '- B',
      '\t- B child',
      '- C',
    ].join('\n');
    const source = node('C', 3, 3);
    const target = node('B', 1, 2);

    expect(moveSubtreeInText(input, source, target, true, 'first')).toBe([
      '- A',
      '- B',
      '\t- C',
      '\t- B child',
    ].join('\n'));
  });

  it('moves a subtree to the lower-right drop zone as last child', () => {
    const input = [
      '- A',
      '\t- B',
      '\t\t- B child',
      '- C',
    ].join('\n');
    const source = node('B', 1, 2, '\t');
    const target = node('C', 3, 3);

    expect(moveSubtreeInText(input, source, target, true, 'last')).toBe([
      '- A',
      '- C',
      '\t- B',
      '\t\t- B child',
    ].join('\n'));
  });

  it('blocks moving a node onto itself', () => {
    const input = [
      '- A',
      '\t- B',
      '- C',
    ].join('\n');
    const source = node('A', 0, 1);

    expect(moveSubtreeInText(input, source, source, false, 'first', 'after')).toBe(input);
  });

  it('blocks moving a node into its own subtree', () => {
    const input = [
      '- A',
      '\t- B',
      '\t\t- C',
      '- D',
    ].join('\n');
    const source = node('A', 0, 2);
    const target = node('C', 2, 2, '\t\t');

    expect(moveSubtreeInText(input, source, target, true, 'last')).toBe(input);
  });

  it('deletes selected ancestors only once when descendants are also selected', () => {
    const input = [
      '- A',
      '\t- B',
      '\t\t- C',
      '- D',
    ].join('\n');
    const selected = [
      node('A', 0, 2),
      node('B', 1, 2, '\t'),
    ];

    expect(deleteMultipleNodesInText(input, selected)).toBe('- D');
  });

  it('deletes multiple nodes while keeping and outdenting their children', async () => {
    const input = [
      '- A',
      '\t- B',
      '\t\t- C',
      '\t- D',
      '- E',
    ].join('\n');
    const selected = [
      node('A', 0, 3),
      node('B', 1, 2, '\t'),
    ];
    const { app, file, getText } = mockApp(input);

    await deleteMultipleNodesKeepChildren(app as never, file as never, selected);

    expect(getText()).toBe([
      '- C',
      '- D',
      '- E',
    ].join('\n'));
  });

  it('adds pasted markdown as normalized child outline items', async () => {
    const input = [
      '- Parent',
      '- Sibling',
    ].join('\n');
    const parent = node('Parent', 0, 0);
    const { app, file, getText } = mockApp(input);

    await addMarkdownAsChildren(app as never, file as never, parent, [
      '- First',
      '  - Second',
      'plain continuation',
    ].join('\n'));

    expect(getText()).toBe([
      '- Parent',
      '\t- First',
      '\t\t- Second',
      '\t\t\t- plain continuation',
      '- Sibling',
    ].join('\n'));
  });

  it('cuts selected nodes and pastes them as children elsewhere', async () => {
    const input = [
      '- A',
      '\t- A child',
      '- B',
      '- C',
    ].join('\n');
    const source = node('A', 0, 1);
    const parent = node('C', 3, 3);
    const { app, file, getText } = mockApp(input);

    await cutPasteMarkdownAsChildren(
      app as never,
      file as never,
      [source],
      parent,
      [
        '- A',
        '\t- A child',
      ].join('\n')
    );

    expect(getText()).toBe([
      '- B',
      '- C',
      '\t- A',
      '\t\t- A child',
    ].join('\n'));
  });

  it('blocks cut-pasting selected nodes into their own subtree', async () => {
    const input = [
      '- A',
      '\t- B',
      '\t\t- C',
      '- D',
    ].join('\n');
    const source = node('A', 0, 2);
    const parent = node('C', 2, 2, '\t\t');
    const { app, file, getText } = mockApp(input);

    await cutPasteMarkdownAsChildren(app as never, file as never, [source], parent, '- A');

    expect(getText()).toBe(input);
  });

  it('preserves CRLF line endings when editing text operations', () => {
    const input = [
      '- A',
      '\t- B',
      '- C',
    ].join('\r\n');
    const source = node('B', 1, 1, '\t');
    const target = node('C', 2, 2);

    expect(moveSubtreeInText(input, source, target, true, 'last')).toBe([
      '- A',
      '- C',
      '\t- B',
    ].join('\r\n'));
  });

  it('preserves frontmatter while inserting outline children', () => {
    const input = [
      '---',
      'excerpt-outline-mindmap: rankDir:LR',
      'tags:',
      '  - mindmap',
      '---',
      '- Parent',
    ].join('\n');
    const parent = node('Parent', 5, 5);

    expect(addChildTextInText(input, parent, 'Child')).toBe([
      '---',
      'excerpt-outline-mindmap: rankDir:LR',
      'tags:',
      '  - mindmap',
      '---',
      '- Parent',
      '\t- Child',
    ].join('\n'));
  });

  it('converts a plain node to an unchecked task without changing its text', () => {
    const input = '- Plain node';
    const target = node('Plain node', 0, 0);

    expect(writeNodeInText(input, target, '[ ] Plain node')).toBe('- [ ] Plain node');
  });

  it('converts multiple nodes to checked tasks', async () => {
    const input = [
      '- A',
      '- B',
    ].join('\n');
    const nodes = [
      node('A', 0, 0),
      node('B', 1, 1),
    ];
    const { app, file, getText } = mockApp(input);

    await writeMultipleNodes(
      app as never,
      file as never,
      nodes,
      (outlineNode) => `[x] ${outlineNode.text}`
    );

    expect(getText()).toBe([
      '- [x] A',
      '- [x] B',
    ].join('\n'));
  });
});
