import { describe, expect, it } from 'vitest';
import {
  addChildInText,
  addChildTextInText,
  deleteMultipleNodesInText,
  moveSubtreeInText,
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

  it('moves a subtree as a child of another node', () => {
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
});
