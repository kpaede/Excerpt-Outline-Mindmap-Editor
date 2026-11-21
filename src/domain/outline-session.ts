import { flattenOutline, parseOutline, type OutlineNode } from '../utils/outline';
import { newNodeId } from './outline-format';
import { carrySavedZoom } from '../storage/zoom-settings-change';

/** Editing identities survive content edits, line shifts and subtree moves. */
export class OutlineSession {
  private source = '';
  private roots: OutlineNode[] = [];
  private identities = new Map<string, Map<number, string>>();

  retainSavedZoom(zoom: number): void {
    const updated = new Map<string, Map<number, string>>();
    for (const [source, ids] of this.identities) {
      const next = carrySavedZoom(source, zoom);
      const headerLines = (text: string) => text.startsWith('---')
        ? (text.match(/^---\r?\n[\s\S]*?^(?:---|\.\.\.)(?=\r?$)/m)?.[0].split(/\r?\n/).length ?? 0) : 0;
      const shift = headerLines(next) - headerLines(source);
      updated.set(next, shift ? new Map(Array.from(ids, ([line, id]) => [line + shift, id])) : ids);
    }
    this.identities = updated;
  }

  parse(source: string, knownIds?: ReadonlyMap<number, string>): OutlineNode[] {
    if (source === this.source && this.roots.length && !knownIds) return this.roots;
    const roots = parseOutline(source);
    const old = flattenOutline(this.roots);
    const next = flattenOutline(roots);
    const used = new Set<OutlineNode>();
    const assigned = new Set<OutlineNode>();
    const beforeLines = this.source.split(/\r?\n/);
    const afterLines = source.split(/\r?\n/);
    let prefix = 0;
    while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++;
    let suffix = 0;
    while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix &&
      beforeLines[beforeLines.length - suffix - 1] === afterLines[afterLines.length - suffix - 1]) suffix++;
    // Intern exact subtree signatures rather than hashes. Repeated own text
    // must not exchange identities when distinct subtrees change order.
    const interned = new Map<string, number>();
    const subtree = new Map<OutlineNode, number>();
    for (const collection of [old, next]) {
      for (let i = collection.length - 1; i >= 0; i--) {
        const node = collection[i];
        const signature = JSON.stringify([node.text, node.checkbox, node.children.map(child => subtree.get(child))]);
        if (!interned.has(signature)) interned.set(signature, interned.size);
        subtree.set(node, interned.get(signature)!);
      }
    }
    const match = (signature: (node: OutlineNode) => string | number) => {
      const candidates = new Map<string | number, OutlineNode[]>();
      for (const node of old) {
        if (used.has(node)) continue;
        const key = signature(node);
        const entries = candidates.get(key) ?? [];
        entries.push(node); candidates.set(key, entries);
      }
      for (const node of next) {
        if (assigned.has(node)) continue;
        const previous = candidates.get(signature(node))?.shift();
        if (previous) { node.id = previous.id; used.add(previous); assigned.add(node); }
      }
    };
    match(node => subtree.get(node)!);
    match(node => JSON.stringify([node.text, node.checkbox]));
    // Remaining nodes represent edits. Match their position after accounting for
    // the common suffix's line displacement; never derive identity from line alone.
    const oldEdited = old.filter(node => !used.has(node) && node.line <= beforeLines.length - suffix && (node.ownEnd ?? node.line + 1) >= prefix);
    const oldIds = new Set(old.map(node => node.id));
    const matchedIds = new Set(next.filter(node => oldIds.has(node.id)).map(node => node.id));
    const newEdited = next.filter(node => !matchedIds.has(node.id) && node.line <= afterLines.length - suffix && (node.ownEnd ?? node.line + 1) >= prefix);
    if (oldEdited.length === newEdited.length) {
      newEdited.forEach((node, index) => { node.id = oldEdited[index].id; });
    }
    const identities = knownIds ?? this.identities.get(source);
    if (identities) {
      const assignedIds = new Set(identities.values());
      for (const node of next) {
        const id = identities.get(node.line);
        if (id) node.id = id;
        else if (node.id && assignedIds.has(node.id)) node.id = newNodeId();
      }
    }
    this.identities.delete(source);
    this.identities.set(source, new Map(next.filter(node => node.id).map(node => [node.line, node.id!])));
    let characters = Array.from(this.identities.keys()).reduce((count, key) => count + key.length, 0);
    while (this.identities.size > 1 && (this.identities.size > 21 || characters > 8_000_000)) {
      const oldest = this.identities.keys().next().value!;
      characters -= oldest.length; this.identities.delete(oldest);
    }
    this.source = source;
    this.roots = roots;
    return roots;
  }
}
