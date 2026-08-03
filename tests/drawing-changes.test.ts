import { describe, expect, it } from 'vitest';
import { canonicalizeDrawing } from '../src/drawing/drawing-changes';

describe('comparing two states of a drawing', () => {
  it('treats an untouched drawing as unchanged', () => {
    const items = [{ id: 'a', type: 'pen', data: { path: [[1, 2]] } }];
    expect(canonicalizeDrawing(items)).toBe(canonicalizeDrawing(items));
  });

  // The whiteboard rebuilds items on import, so it may write their properties
  // back in a different order than it received them.
  it('ignores the order of object keys', () => {
    const before = [{ id: 'a', type: 'pen', data: { x: 1, y: 2 } }];
    const after = [{ type: 'pen', data: { y: 2, x: 1 }, id: 'a' }];
    expect(canonicalizeDrawing(after)).toBe(canonicalizeDrawing(before));
  });

  it('sorts keys at every depth', () => {
    const before = [{ a: { b: { c: 1, d: 2 } } }];
    const after = [{ a: { b: { d: 2, c: 1 } } }];
    expect(canonicalizeDrawing(after)).toBe(canonicalizeDrawing(before));
  });

  it('keeps array order significant', () => {
    const before = [{ id: 'a' }, { id: 'b' }];
    const after = [{ id: 'b' }, { id: 'a' }];
    expect(canonicalizeDrawing(after)).not.toBe(canonicalizeDrawing(before));
  });

  it('detects an added stroke', () => {
    const before = [{ id: 'a', type: 'pen' }];
    const after = [{ id: 'a', type: 'pen' }, { id: 'b', type: 'pen' }];
    expect(canonicalizeDrawing(after)).not.toBe(canonicalizeDrawing(before));
  });

  it('detects a changed value', () => {
    const before = [{ id: 'a', data: { path: [[1, 2]] } }];
    const after = [{ id: 'a', data: { path: [[1, 3]] } }];
    expect(canonicalizeDrawing(after)).not.toBe(canonicalizeDrawing(before));
  });

  it('detects a removed stroke', () => {
    expect(canonicalizeDrawing([])).not.toBe(canonicalizeDrawing([{ id: 'a' }]));
  });

  it('treats two empty drawings as identical', () => {
    expect(canonicalizeDrawing([])).toBe(canonicalizeDrawing([]));
  });

  it('preserves null and nested arrays', () => {
    const items = [{ id: 'a', data: { path: [[1, 2], [3, 4]], label: null } }];
    expect(JSON.parse(canonicalizeDrawing(items))).toEqual(items);
  });
});
