# 0.2.5

Mindmaps now follow Obsidian's light and dark themes consistently. Connection
lines, heading frames, node backgrounds, code blocks and Zotero source icons
remain readable, and open views and code-block embeds update their colors when
the theme changes. SVG/PDF exports retain the displayed connection color.

Choose **Layout options → Connection lines → Right angles (90°)** for horizontal
and vertical connection segments. **Direct** remains the default. The setting is
saved per mindmap, follows the selected tree direction, and applies to code-block
embeds and SVG/PDF exports. Layout sliders remain connected after changing a
dropdown in the same menu.

Embedded hosts can set the public, per-view `supportsStructuralHeadings` option
to `false`. This hides **Add heading for this tree** and blocks direct calls to
that action. Standalone views keep the default `true`. The capability is never
saved to Markdown or plugin settings; headings inside multiline entries remain
editable.

Validation: 322 automated tests, ESLint and the production build/startup smoke
passed. Local Chrome checks cover light/dark colors and right-angle routes in
all four tree directions, including close and aligned nodes and the exported
polyline coordinates. These browser checks use a local fixture; this release
has not been checked on physical mobile devices.

Install `main.js`, `manifest.json` and `styles.css` together. Minimum Obsidian
version: 1.8.7.
