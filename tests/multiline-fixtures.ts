import type { OutlineNode, CheckboxState } from '../src/utils/outline';
import { serializeOutline } from '../src/domain/outline-format';

export const header = '---\neome-outline-format: 2\ncustom: keep me\ntags:\n  - research\n---\n';
export function thought(text: string, children: OutlineNode[] = [], checkbox: CheckboxState = 'none'): OutlineNode {
  return { text, children, checkbox, indent: '', marker: '-', line: 0, endLine: 0 };
}
export function semantic(nodes: OutlineNode[]): unknown {
  return nodes.map(node => ({ text: node.text, checkbox: node.checkbox, children: semantic(node.children) }));
}
export function document(nodes: OutlineNode[], eol = '\n'): string {
  return (header + serializeOutline(nodes)).replace(/\n/g, eol);
}
export const richText = [
  '', '', '  First paragraph with trailing spaces.  ', '', 'Second paragraph.', '',
  '- internal bullet', '  - nested bullet', '\t* tabbed internal bullet', '* star', '+ plus',
  '1. first', '2. second', '   1. nested', '> quote', '> continued', '',
  '# Content heading', '## Another heading', '- [ ] internal task', '- [x] done internally',
  '```ts', '\t- code resembling a child', '- [x] code task', '<!--section: 1-->',
  '\t  indented code', '```', '', '~~~md', '# not a section', '~~~',
  'Unicode: äöü ß 日本語 🧠 e\u0301', '[[Link#Heading|alias]] [web](https://example.org)',
  '![[embedded-note]] ![[drawing.svg]]', '| a | b |', '| - | - |', '| 1 | 2 |', '', '',
].join('\n');
export function largeTree(depth = 60, width = 12): OutlineNode[] {
  const chain = thought('Deepest\n\n' + richText, [], 'unchecked');
  let current = chain;
  for (let i = 0; i < depth; i++) current = thought(`Depth ${i}\n${richText}`, [current, thought(`Sibling ${i}\n${richText}`)], i % 2 ? 'checked' : 'none');
  return [current, ...Array.from({ length: width }, (_, i) => thought(`Branch ${i}\n${richText.repeat(5)}`, [thought(`Leaf ${i}\n${richText}`)]))];
}
export function mockVault(initial: string) {
  let text = initial;
  const file = { path: 'EOME tests.md' };
  const views: { view: { file: typeof file; editor: { getValue(): string } } }[] = [];
  let beforeProcess: (() => void) | undefined;
  const app = {
    workspace: { getLeavesOfType: () => views },
    vault: {
      read: async () => text,
      modify: async (_file: unknown, value: string) => { text = value; },
      process: async (_file: unknown, update: (value: string) => string) => {
        beforeProcess?.(); beforeProcess = undefined;
        text = update(text);
      },
    },
  };
  return {
    app: app as never, file: file as never, getText: () => text,
    external: (value: string) => { text = value; }, views,
    race: (run: () => void) => { beforeProcess = run; },
  };
}
