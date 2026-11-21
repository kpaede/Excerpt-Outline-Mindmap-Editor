import type { CheckboxState, OutlineNode } from '../utils/outline';

export const FORMAT_KEY = 'eome-outline-format';
export class OutlineFormatError extends Error {
  constructor(message: string, public readonly line: number = 0) {
    super(`Line ${line + 1}: ${message}`);
  }
}

export function frontmatterEnd(lines: string[]): number {
  if (lines[0] !== '---') return 0;
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)$/.test(line));
  if (end < 0) throw new OutlineFormatError('Unclosed frontmatter.');
  return end + 1;
}

export function outlineVersion(markdown: string): 1 | 2 {
  const lines = markdown.split(/\r?\n/);
  const end = frontmatterEnd(lines);
  if (!end) return 1;
  const properties = lines.slice(1, end - 1).filter(line => /^(?:eome-outline-format|["']eome-outline-format["'])\s*:/.test(line));
  if (!properties.length) return 1;
  if (properties.length !== 1 || !/^[^:]+:\s*(?:2|"2"|'2')\s*(?:#.*)?$/.test(properties[0])) {
    throw new OutlineFormatError('Unsupported or duplicate eome-outline-format.');
  }
  return 2;
}

let nextId = 0;
export function newNodeId(): string { return `eome-${++nextId}`; }

function decodeFirst(text: string): string {
  return /^\\(?:\\|\[(?: |x|X)\] )/.test(text) ? text.slice(1) : text;
}

export function encodeNodeContent(text: string, checkbox: CheckboxState, indent: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (/\r/.test(lines.join('\n'))) throw new OutlineFormatError('Bare carriage return is unsupported.');
  if (/^(?:\\|\[(?: |x|X)\] )/.test(lines[0])) lines[0] = `\\${lines[0]}`;
  const task = checkbox === 'none' ? '' : checkbox === 'checked' ? '[x] ' : '[ ] ';
  return [`${indent}- ${task}${lines[0]}`, ...lines.slice(1).map(line => `${indent}  ${line}`)];
}

export function parseMultilineOutline(markdown: string): OutlineNode[] {
  if (/\r(?!\n)/.test(markdown)) throw new OutlineFormatError('Bare carriage return is unsupported.');
  const lines = markdown.split(/\r?\n/);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  let current: OutlineNode | undefined;
  let fence: { char: string; length: number } | undefined;
  const closeStack = (depth: number) => {
    while (stack.length > depth) {
      const node = stack.pop()!;
      node.subtreeEnd = Math.max(node.ownEnd!, node.children[node.children.length - 1]?.subtreeEnd ?? 0);
      node.endLine = node.subtreeEnd - 1;
    }
  };
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i];
    if (current && line.startsWith(`${current.indent}  `)) {
      current.text += `\n${line.slice(current.indent.length + 2)}`;
      current.ownEnd = i + 1;
      continue;
    }
    current = undefined;
    if (fence) {
      if (new RegExp(`^${fence.char}{${fence.length},}\\s*$`).test(line)) fence = undefined;
      continue;
    }
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      closeStack(0);
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    const match = line.match(/^(\t*)- (.*)$/);
    if (!match) {
      if (/^[\t ]+\S|^-|^[*+]($|\s)|^\d+\.($|\s)/.test(line)) {
        throw new OutlineFormatError('Expected tabs followed by "- ", or an immediate content continuation with two spaces.', i);
      }
      closeStack(0);
      continue;
    }
    const depth = match[1].length;
    closeStack(depth);
    if (depth > stack.length) throw new OutlineFormatError('A child has no parent at the preceding depth.', i);
    let text = match[2];
    let checkbox: CheckboxState = 'none';
    const task = text.match(/^\[( |x|X)\] (.*)$/);
    if (task) { checkbox = task[1] === ' ' ? 'unchecked' : 'checked'; text = task[2]; }
    current = {
      id: newNodeId(), text: decodeFirst(text), checkbox, indent: match[1], marker: '-',
      line: i, endLine: i, ownEnd: i + 1, subtreeEnd: i + 1, children: [], sourceDoc: markdown, format: 2,
    };
    if (depth) stack[depth - 1].children.push(current);
    else roots.push(current);
    stack.push(current);
  }
  closeStack(0);
  return roots;
}

export function serializeOutline(nodes: OutlineNode[], depth = 0): string {
  const lines: string[] = [];
  const pending = [...nodes].reverse().map(node => ({ node, depth }));
  while (pending.length) {
    const entry = pending.pop()!;
    lines.push(...encodeNodeContent(entry.node.text, entry.node.checkbox, '\t'.repeat(entry.depth)));
    for (let i = entry.node.children.length - 1; i >= 0; i--) pending.push({ node: entry.node.children[i], depth: entry.depth + 1 });
  }
  return lines.join('\n');
}
