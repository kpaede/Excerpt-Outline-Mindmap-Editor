# Node sizing after lists

Live regression checked in **Testprogramm 2**, 2026-11-21.

## Cause and correction

The temporary measurement box was attached to `document.body`, with Markdown
rendered directly into that box. The actual preview inherits typography from the
mindmap view and renders Markdown in a nested `.mindmap-node-content` element.
In the reported case, measurement used a 20.8px line height while the preview
used 22.4px. This underestimated list height and clipped the final continuation.

Measurement now uses the same view, outer overlay class, inner content class and
font as the preview. Its content can grow naturally during measurement; the
resulting height is rounded up. The wrapper is prepared before measurement,
including when Obsidian supplies file content before `onOpen` finishes.
Existing measurement caching and batched rendering remain in place.

No Markdown storage, keyboard behavior, checkbox behavior or preview scrolling
rules were changed. The published 0.2.3 release and its assets were not modified.

## Verification

Run `node scripts/vault-node-content-sizing.mjs` with Obsidian open. The script
creates isolated fixtures, rejects active node drafts, closes its own test tabs
and returns to the original note. Detailed output is in
[node-content-sizing-results.json](node-content-sizing-results.json).

- **375 live checks passed**, including 182 preview-height samples.
- Fourteen content cases: the two reported examples, unordered and ordered
  lists, nested and loose lists, task lists, wrapped continuations, inline code,
  fenced code, quotes, headings, tables, a 62,938-character node and empty text.
- Preview content fits at widths 220, 300 and 420px and zooms 0.65, 1, 1.5 and 2.
  A 1px allowance accounts for integer DOM rounding.
- Saving a paragraph after the list preserves other nodes. Undo restores the
  exact source, including whitespace; Redo restores the saved edit.
- The original user note is byte-for-byte unchanged. Its reported list now has
  219px available for 219px of content; the nested-list case has 163px available
  for 163px of content. Both were also inspected in a screenshot.
- Short, long and classic editor checks passed separately: their heights remain
  46, 638 and 88px respectively before and after typing.
- All **308 automated tests**, production build and lint passed.

## Performance observations

An additional fixture contains **130 nodes and 214,310 characters**, with five
levels of outline nesting and nested lists inside the nodes. Every node tail is
retained. The observed first render was 355ms; a cached redraw was 99ms.
One hundred viewport interaction frames caused **zero new measurements and zero
preview rebuilds**. Geometry updates averaged 0.96ms (95th percentile 2.5ms).

These are measurements from one desktop session, not a general smoothness
guarantee. Frame intervals still had outliers (mean 22.8ms, 95th percentile
73.5ms, maximum 242ms); this change addresses content sizing and does not claim
to resolve every source of viewport stutter.
