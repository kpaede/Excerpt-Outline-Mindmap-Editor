/**
 * The plugin addresses its realm through `window` rather than `globalThis`,
 * because in an Obsidian pop-out window those are different objects and only
 * `window` is the one the code is running in. Node has a single realm and no
 * `window` binding, so the tests point it at the realm they do have.
 */
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}
