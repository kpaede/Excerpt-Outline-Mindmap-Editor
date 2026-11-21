import { Component } from 'obsidian';

/** Markdown post-processors belong to one overlay generation, not the whole view. */
export class NodeRenderResources {
  private scope: Component | null = null;
  constructor(private readonly owner: Component) {}

  current(): Component {
    if (!this.scope) this.scope = this.owner.addChild(new Component());
    return this.scope;
  }

  isCurrent(scope: Component): boolean { return scope === this.scope; }

  clear(): void {
    if (this.scope) this.owner.removeChild(this.scope);
    this.scope = null;
  }
}
