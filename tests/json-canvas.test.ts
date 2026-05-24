import { describe, expect, it } from 'vitest';
import { outlineToJsonCanvas, validateJsonCanvas } from '../src/domain/json-canvas';
import type { CheckboxState, OutlineNode } from '../src/utils/outline';

function sequentialIds() {
  let index = 0;
  return () => {
    index++;
    return index.toString(16).padStart(16, '0');
  };
}

function node(
  text: string,
  line: number,
  children: OutlineNode[] = [],
  checkbox: CheckboxState = 'none'
): OutlineNode {
  return {
    text,
    line,
    endLine: line,
    indent: '',
    marker: '-',
    checkbox,
    children,
  };
}

describe('JSON Canvas export', () => {
  it('converts outline nodes into text nodes and parent-child edges', () => {
    const canvas = outlineToJsonCanvas([
      node('Root', 0, [
        node('Child A', 1),
        node('Child B', 2),
      ]),
    ], { idFactory: sequentialIds() });

    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.edges).toHaveLength(2);
    expect(canvas.nodes.map((node) => node.text)).toEqual(['Root', 'Child A', 'Child B']);
    expect(canvas.edges[0]).toMatchObject({
      fromNode: '0000000000000001',
      fromSide: 'right',
      toNode: '0000000000000002',
      toSide: 'left',
      toEnd: 'arrow',
    });
    expect(canvas.edges[1]).toMatchObject({
      fromNode: '0000000000000001',
      toNode: '0000000000000003',
    });
    validateJsonCanvas(canvas);
  });

  it('preserves task checkbox state in canvas text nodes', () => {
    const canvas = outlineToJsonCanvas([
      node('Todo', 0, [], 'unchecked'),
      node('Done', 1, [], 'checked'),
    ], { idFactory: sequentialIds() });

    expect(canvas.nodes.map((node) => node.text)).toEqual(['- [ ] Todo', '- [x] Done']);
    validateJsonCanvas(canvas);
  });

  it('lays child nodes to the right of their parent', () => {
    const canvas = outlineToJsonCanvas([
      node('Root', 0, [
        node('Child', 1),
      ]),
    ], { idFactory: sequentialIds() });

    const root = canvas.nodes[0];
    const child = canvas.nodes[1];

    expect(child.x).toBeGreaterThan(root.x);
    expect(canvas.edges[0].fromNode).toBe(root.id);
    expect(canvas.edges[0].toNode).toBe(child.id);
    validateJsonCanvas(canvas);
  });
});
