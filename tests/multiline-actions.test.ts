import { describe, expect, it } from 'vitest';
import {
  addChildTextInText, addSiblingText, addChildInText, addMarkdownAsChildren, cutPasteMarkdownAsChildren,
  deleteNodeInText, deleteNodeKeepChildrenInText, deleteMultipleNodesInText, deleteMultipleNodesKeepChildren,
  duplicateSubtree, moveSubtreeInText, moveSubtreeToEmptyHeadingInText, setNodeCheckboxInText,
  setNodesCheckbox, writeNodeInText,
} from '../src/domain/mindmap-file';
import { parseMultilineOutline } from '../src/domain/outline-format';
import { flattenOutline, parseOutline } from '../src/utils/outline';
import { getNodesAsMarkdown } from '../src/view/clipboard';
import { document, header, largeTree, mockVault, richText, semantic, thought } from './multiline-fixtures';

const roots = () => [thought(richText, [thought('Child\n' + richText, [thought('Grandchild\n' + richText)])], 'unchecked'), thought('Target\n' + richText, [thought('Existing\nbody')]), thought('Last\n' + richText)];

describe('actual multiline structural operations', () => {
  it('edits own content without changing children, status or surrounding document', () => {
    const input = document(roots());
    const before = parseOutline(input);
    const after = parseOutline(writeNodeInText(input, before[0], '\n[x] literal\n\n' + richText));
    expect(after[0].text).toBe('\n[x] literal\n\n' + richText);
    expect(after[0].checkbox).toBe('unchecked');
    expect(semantic(after[0].children)).toEqual(semantic(before[0].children));
    expect(semantic(after.slice(1))).toEqual(semantic(before.slice(1)));
  });
  it('changes only task state, including a literal task prefix in content', async () => {
    const input = document([thought('[x] literal\n' + richText, roots(), 'none')]);
    let current = input;
    for (const state of ['unchecked', 'checked', 'unchecked', 'none'] as const) {
      const node = parseOutline(current)[0];
      current = setNodeCheckboxInText(current, node, state);
      const parsed = parseOutline(current)[0];
      expect(parsed.checkbox).toBe(state);
      expect(parsed.text).toBe(node.text);
      expect(semantic(parsed.children)).toEqual(semantic(node.children));
    }
    expect(current).toBe(input);
    const vault = mockVault(document(roots()));
    const before = parseOutline(vault.getText());
    await setNodesCheckbox(vault.app, vault.file, flattenOutline(before), 'checked');
    expect(flattenOutline(parseOutline(vault.getText())).map(node => node.text)).toEqual(flattenOutline(before).map(node => node.text));
    expect(flattenOutline(parseOutline(vault.getText())).every(node => node.checkbox === 'checked')).toBe(true);
  });
  for (const asChild of [true, false]) for (const position of ['first', 'last'] as const) for (const sibling of ['before', 'after'] as const) {
    it(`moves the complete subtree (${asChild}, ${position}, ${sibling})`, () => {
      const input = document(roots());
      const before = parseOutline(input);
      const moved = moveSubtreeInText(input, before[0], before[1], asChild, position, sibling);
      const after = parseOutline(moved);
      const expected = roots();
      const source = expected.shift()!;
      if (asChild) expected[0].children.splice(position === 'first' ? 0 : expected[0].children.length, 0, source);
      else expected.splice(sibling === 'before' ? 0 : 1, 0, source);
      expect(semantic(after)).toEqual(semantic(expected));
      expect(moved.startsWith(header)).toBe(true);
    });
  }
  it('outdents and reindents a large complete subtree without losing blank lines', () => {
    const input = document(largeTree(70, 16));
    const before = parseOutline(input);
    const child = before[0].children[0];
    const moved = moveSubtreeInText(input, child, before[1], false, 'first', 'before');
    const after = parseOutline(moved);
    expect(semantic([after[1]])).toEqual(semantic([child]));
    const back = moveSubtreeInText(moved, after[1], after[0], true, 'first');
    expect(back).toBe(input);
  });
  it('inserts first children after all own content and last children after complete subtrees', () => {
    const input = document(roots());
    const first = parseOutline(input)[0];
    const a = parseOutline(addChildTextInText(input, first, 'New\n\n' + richText, 'first'));
    expect(a[0].text).toBe(first.text);
    expect(a[0].children[0].text).toBe('New\n\n' + richText);
    expect(semantic(a[0].children.slice(1))).toEqual(semantic(first.children));
    const b = parseOutline(addChildInText(input, first, 'last'));
    expect(b[0].children.at(-1)?.text).toBe('');
  });
  it('adds multiline sibling content without interpreting it as a task', async () => {
    const vault = mockVault(document(roots()));
    const node = parseOutline(vault.getText())[0];
    await addSiblingText(vault.app, vault.file, node, '[x] literal\n' + richText);
    const after = parseOutline(vault.getText());
    expect(after[1].text).toBe('[x] literal\n' + richText);
    expect(after[1].checkbox).toBe('none');
  });
  it('deletes a subtree and restores it by copying without splitting internal lists', async () => {
    const input = document(roots());
    const before = parseOutline(input);
    const copied = getNodesAsMarkdown(input, [before[0], before[0].children[0]]);
    expect(semantic(parseMultilineOutline(copied))).toEqual(semantic([before[0]]));
    const deleted = deleteNodeInText(input, before[0]);
    expect(semantic(parseOutline(deleted))).toEqual(semantic(before.slice(1)));
    const vault = mockVault(deleted);
    await addMarkdownAsChildren(vault.app, vault.file, parseOutline(deleted)[0], copied);
    const after = parseOutline(vault.getText());
    expect(semantic([after[0].children.at(-1)!])).toEqual(semantic([before[0]]));
  });
  it('duplicates and cuts complete rich-text subtrees', async () => {
    const input = document(roots());
    const vault = mockVault(input);
    await duplicateSubtree(vault.app, vault.file, parseOutline(input)[0]);
    const duplicated = parseOutline(vault.getText());
    expect(semantic([duplicated[0]])).toEqual(semantic([duplicated[1]]));
    const original = semantic([duplicated[0]]);
    await cutPasteMarkdownAsChildren(vault.app, vault.file, [duplicated[0]], duplicated[2], getNodesAsMarkdown(vault.getText(), [duplicated[0]]));
    const after = parseOutline(vault.getText());
    expect(semantic([after[1].children.at(-1)!])).toEqual(original);
    expect(flattenOutline(after)).toHaveLength(flattenOutline(duplicated).length);
  });
  it('deletes only own content and promotes children, also for nested multiselection', async () => {
    const input = document(roots());
    const before = parseOutline(input);
    expect(semantic(parseOutline(deleteNodeKeepChildrenInText(input, before[0]))))
      .toEqual(semantic([...before[0].children, ...before.slice(1)]));
    const vault = mockVault(input);
    await deleteMultipleNodesKeepChildren(vault.app, vault.file, [before[0], before[0].children[0]]);
    expect(semantic(parseOutline(vault.getText()))).toEqual(semantic([...before[0].children[0].children, ...before.slice(1)]));
    expect(semantic(parseOutline(deleteMultipleNodesInText(input, [before[0], before[0].children[0]])))).toEqual(semantic(before.slice(1)));
  });
  it('moves to an empty heading without mistaking a content heading for a section', () => {
    const input = document(roots()) + '\n# Empty\n';
    const before = parseOutline(input);
    const moved = moveSubtreeToEmptyHeadingInText(input, before[0], input.split('\n').length - 2);
    expect(semantic(parseOutline(moved))).toEqual(semantic([...before.slice(1), before[0]]));
  });
  it('preserves CRLF and every content whitespace character through moves', () => {
    const input = document(roots(), '\r\n');
    const before = parseOutline(input);
    const moved = moveSubtreeInText(input, before[0], before[1], true, 'first');
    expect(moved.replace(/\r\n/g, '')).not.toContain('\n');
    expect(semantic([parseOutline(moved)[0].children[0]])).toEqual(semantic([before[0]]));
  });
  it('blocks cycles and stale nodes rather than using shifted line numbers', () => {
    const input = document(roots());
    const before = parseOutline(input);
    expect(moveSubtreeInText(input, before[0], before[0].children[0])).toBe(input);
    expect(() => writeNodeInText(header + '- External\n' + input.slice(header.length), before[0], 'Overwrite')).toThrow(/externally/);
  });
  it('rejects structural paste that would discard outside document text', async () => {
    const vault = mockVault(document([thought('Parent')]));
    const before = vault.getText();
    const fragment = header + '- A\nUnowned prose\n- B';
    await expect(addMarkdownAsChildren(vault.app, vault.file, parseOutline(before)[0], fragment)).rejects.toThrow(/outside thoughts/);
    expect(vault.getText()).toBe(before);
  });
  it('pastes ordinary text as one multiline thought in the explicit structural paste action', async () => {
    const vault = mockVault(document([thought('Parent')]));
    await addMarkdownAsChildren(vault.app, vault.file, parseOutline(vault.getText())[0], 'Paragraph\n\n- internal list');
    expect(parseOutline(vault.getText())[0].children[0].text).toBe('Paragraph\n\n- internal list');
  });
});

describe('long mixed editing sequences against an independent tree model', () => {
  for (const seed of [1, 42, 1234, 65535, 987654]) {
    it(`preserves every content byte and parent relationship over 100 operations (seed ${seed})`, async () => {
      let randomState = seed;
      const random = (limit: number) => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState % limit; };
      const expected = largeTree(8, 4);
      let text = document(expected, seed % 2 ? '\r\n' : '\n');
      const container = (items: typeof expected, target: typeof expected[number]): typeof expected | undefined => {
        if (items.includes(target)) return items;
        for (const node of items) { const found = container(node.children, target); if (found) return found; }
        return undefined;
      };
      for (let step = 0; step < 100; step++) {
        const actual = flattenOutline(parseOutline(text));
        const model = flattenOutline(expected);
        const sourceIndex = random(actual.length);
        const source = actual[sourceIndex];
        const sourceModel = model[sourceIndex];
        const operation = random(7);
        if (operation === 0 && actual.length > 1) {
          const targetIndex = random(actual.length);
          const target = actual[targetIndex];
          const targetModel = model[targetIndex];
          if (flattenOutline([sourceModel]).includes(targetModel)) continue;
          const asChild = random(2) === 0;
          const first = random(2) === 0;
          text = moveSubtreeInText(text, source, target, asChild, first ? 'first' : 'last', first ? 'before' : 'after');
          const sourceContainer = container(expected, sourceModel)!;
          sourceContainer.splice(sourceContainer.indexOf(sourceModel), 1);
          if (asChild) targetModel.children.splice(first ? 0 : targetModel.children.length, 0, sourceModel);
          else { const targetContainer = container(expected, targetModel)!; targetContainer.splice(targetContainer.indexOf(targetModel) + (first ? 0 : 1), 0, sourceModel); }
        } else if (operation === 1) {
          const value = `[x] literal ${step}\n\n${richText}\n \t `;
          text = writeNodeInText(text, source, value);
          sourceModel.text = value;
        } else if (operation === 2) {
          const state = (['none', 'unchecked', 'checked'] as const)[random(3)];
          text = setNodeCheckboxInText(text, source, state);
          sourceModel.checkbox = state;
        } else if (operation === 3) {
          const value = `New ${step}\n\n${richText}`;
          const first = random(2) === 0;
          text = addChildTextInText(text, source, value, first ? 'first' : 'last');
          sourceModel.children.splice(first ? 0 : sourceModel.children.length, 0, thought(value));
        } else if (operation === 4 && actual.length > 3 && sourceModel.children.length < 5) {
          text = deleteNodeInText(text, source);
          const parent = container(expected, sourceModel)!;
          parent.splice(parent.indexOf(sourceModel), 1);
        } else if (operation === 5 && sourceModel.children.length) {
          text = deleteNodeKeepChildrenInText(text, source);
          const parent = container(expected, sourceModel)!;
          parent.splice(parent.indexOf(sourceModel), 1, ...sourceModel.children);
        } else if (operation === 6 && actual.length < 100) {
          const vault = mockVault(text);
          text = await duplicateSubtree(vault.app, vault.file, source);
          const parent = container(expected, sourceModel)!;
          parent.splice(parent.indexOf(sourceModel) + 1, 0, structuredClone(sourceModel));
        }
        expect(semantic(parseOutline(text)), `step ${step}, operation ${operation}`).toEqual(semantic(expected));
      }
    });
  }
});
