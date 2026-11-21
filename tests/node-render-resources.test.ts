import { describe, expect, it } from 'vitest';
import { Component } from './obsidian-mock';
import { NodeRenderResources } from '../src/view/node-render-resources';

describe('Markdown render resource lifetime', () => {
  it('unloads obsolete post-processors instead of accumulating them in the view', () => {
    const owner = new Component();
    const resources = new NodeRenderResources(owner as never);
    let cleaned = 0;
    for (let generation = 0; generation < 40; generation++) {
      resources.clear();
      const scope = resources.current();
      expect(resources.current()).toBe(scope);
      scope.register(() => { cleaned++; });
      expect(owner.children).toHaveLength(1);
      expect(cleaned).toBe(generation);
    }
    const old = resources.current();
    resources.clear();
    expect(resources.isCurrent(old)).toBe(false);
    expect(cleaned).toBe(40);
    expect(owner.children).toHaveLength(0);
    resources.clear();
    expect(cleaned).toBe(40);
  });
});
