import { outlineToJsonCanvas } from '../src/domain/json-canvas';
import { describe, expect, it } from 'vitest';
import { flattenOutline, isOutlineCompatible, parseOutline } from '../src/utils/outline';
import { encodeNodeContent, outlineVersion, serializeOutline } from '../src/domain/outline-format';
import { previewMigration } from '../src/domain/outline-migration';
import { OutlineSession } from '../src/domain/outline-session';
import { parseHeadingSections } from '../src/utils/heading-sections';
import { addChildTextInText, writeNodeInText } from '../src/domain/mindmap-file';
import { document, header, largeTree, richText, semantic, thought } from './multiline-fixtures';

describe('versioned multiline outline grammar', () => {
  const contents = ['', '\n', '\n\n', ' ', '\t', 'text  ', '  leading\n\t  indentation  \n\n', '[x] literal', '[ ] literal', '[X] literal', '\\[x] literal', '\\literal', '\\\\literal', richText];
  for (const eol of ['\n', '\r\n']) for (const state of ['none', 'unchecked', 'checked'] as const) {
    it(`round-trips exact content, tasks and complete hierarchy (${JSON.stringify(eol)}, ${state})`, () => {
      const roots = contents.map(text => thought(text, [thought(richText, [thought('Grandchild\n\n')])], state));
      const input = document(roots, eol);
      const parsed = parseOutline(input);
      expect(semantic(parsed)).toEqual(semantic(roots));
      expect(semantic(parseOutline(document(parsed, eol)))).toEqual(semantic(roots));
      expect(isOutlineCompatible(input)).toBe(true);
    });
  }
  it('never treats internal lists, headings, comments, code or frontmatter tags as nodes', () => {
    const input = document([thought(richText, [thought('Real child')])]);
    expect(flattenOutline(parseOutline(input))).toHaveLength(2);
    expect(parseHeadingSections(input)).toEqual([]);
    const withSection = header + '# Outer heading\n' + serializeOutline(parseOutline(input));
    expect(parseHeadingSections(withSection).map(section => section.text)).toEqual(['Outer heading']);
  });
  it('keeps own content and subtree ranges separate and exclusive', () => {
    const input = document([thought('One\n\nTwo\n', [thought('Child\nbody')]), thought('Next')]);
    const [parent, next] = parseOutline(input);
    expect(parent.ownEnd).toBe(parent.children[0].line);
    expect(parent.subtreeEnd).toBe(next.line);
    expect(parent.endLine).toBe(next.line - 1);
  });
  it('preserves a large deeply nested tree over repeated read/write cycles', () => {
    const roots = largeTree(100, 24);
    let text = document(roots);
    expect(text.length).toBeGreaterThan(150_000);
    for (let i = 0; i < 8; i++) {
      const parsed = parseOutline(text);
      expect(semantic(parsed)).toEqual(semantic(roots));
      text = document(parsed);
    }
  });
  it.each(['\t\t- orphan', '* alternate marker', '-missing space', '\tbad continuation', '- Root\n\t\t- skipped', '- Root\n\t- child\n  late parent content'])('rejects ambiguous input: %s', bad => {
    expect(() => parseOutline(header + bad)).toThrow();
    expect(isOutlineCompatible(header + bad)).toBe(false);
  });
  it('preserves document parts outside node ranges including fenced structural examples', () => {
    const input = header + 'Preamble\n```md\n- example only\n```\n# Section\n- Node\n  body\n\nAfterword\n';
    const nodes = parseOutline(input);
    expect(nodes).toHaveLength(1);
    const edited = writeNodeInText(input, nodes[0], 'Edited\n\nmore');
    expect(edited).toBe(input.replace('- Node\n  body', '- Edited\n  \n  more'));
  });
  it('detects unknown versions, duplicate markers and bare CR without changing text', () => {
    for (const input of ['---\neome-outline-format: 3\n---\n- X', '---\neome-outline-format: 2\neome-outline-format: 2\n---\n- X', header + '- A\rb']) {
      expect(() => parseOutline(input)).toThrow();
    }
    expect(outlineVersion('- key\neome-outline-format: 99\nlast')).toBe(1);
  });
  it('does not change legacy hierarchy or migrate on open', () => {
    const input = '- Parent\n  - Child\n    + Grandchild\n- Next';
    expect(outlineVersion(input)).toBe(1);
    expect(parseOutline(input)[0].children[0].children[0].text).toBe('Grandchild');
    expect(() => writeNodeInText(input, parseOutline(input)[0], 'a\nb')).toThrow(/migration/);
  });
  it.each(['\n', '\r\n'])('migrates legacy spaces, tabs, numbered markers, tasks, headings and blanks (%j)', eol => {
    const input = ['---', 'title: Original', 'tags:', '  - untouched', '---', '', '# Section', '- [x] Parent', '  * Child  ', '    1. Grandchild', '\t+ Other child', '- [ ] ', '- \\literal', '', '# Empty heading', ''].join(eol);
    const before = parseOutline(input);
    const preview = previewMigration(input);
    expect(semantic(parseOutline(preview.after))).toEqual(semantic(before));
    expect(preview.before).toBe(input);
    expect(preview.after).toContain('title: Original' + eol + 'tags:' + eol + '  - untouched');
    expect(previewMigration(preview.after).after).toBe(preview.after);
  });
  it('rejects unsafe legacy migration instead of discarding continuations', () => {
    expect(() => previewMigration('- Old\n  continuation')).toThrow(/ambiguous/);
  });
  it('keeps editing IDs stable across multiline edits, task changes and line shifts', () => {
    const session = new OutlineSession();
    let input = document([thought('A', [thought('Child')]), thought('B')]);
    const first = session.parse(input);
    const ids = flattenOutline(first).map(node => node.id);
    input = writeNodeInText(input, first[0], richText);
    const after = session.parse(input);
    expect(flattenOutline(after).map(node => node.id)).toEqual(ids);
    const added = addChildTextInText(input, after[0], 'New\ncontent', 'first');
    expect(session.parse(added)[0].children[1].id).toBe(ids[1]);
  });
  it('encodes status independently from every first-line escape', () => {
    expect(encodeNodeContent('[x] literal\n- inner', 'unchecked', '\t')).toEqual(['\t- [ ] \\[x] literal', '\t  - inner']);
  });
  it('preserves complete whitespace in the Canvas export too', () => {
    const roots = parseOutline(document([thought(richText), thought('')]));
    const canvas = outlineToJsonCanvas(roots);
    expect(canvas.nodes[0].text).toBe(richText);
    expect(canvas.nodes[1].text).toBe('');
  });
  it('does not create heading sections from examples in outside fenced code', () => {
    const input = header + '~~~md\n# Example only\n- no thought\n~~~\n# Real section\n- Real thought';
    expect(parseHeadingSections(input).map(section => section.text)).toEqual(['Real section']);
  });

  it('keeps identities for repeated own text when distinct subtrees are reordered', () => {
    const session = new OutlineSession();
    const roots = [thought('Same title', [thought('A')]), thought('Same title', [thought('B')])];
    const first = session.parse(document(roots));
    const ids = first.map(node => node.id);
    const moved = session.parse(document([...roots].reverse()));
    expect(moved.map(node => node.id)).toEqual([...ids].reverse());
  });

});

it('does not give a newly inserted empty node the identity of an existing empty node', () => {
  const session = new OutlineSession();
  const before = document([thought('A'), thought('', [], 'none')]);
  const old = session.parse(before);
  const existingId = old[1].id;
  const after = session.parse(before.replace('- A\n- ', '- A\n- \n- '), new Map([[old[0].line, old[0].id!], [old[1].line + 1, existingId!]]));
  expect(after[2].id).toBe(existingId);
  expect(after[1].id).not.toBe(existingId);
});
