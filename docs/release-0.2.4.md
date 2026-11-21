# 0.2.4

Fix clipped multiline node previews after lists. Node sizing now uses the same
typography and nested Markdown structure as the visible preview, including on
first opening a mindmap. Nodes grow to fit the complete rendered content.

Markdown formatting and list indentation retain Obsidian's standard behavior.
Editing controls, stored content and checkbox presentation are unchanged.

Validation: 308 automated tests, production build/startup smoke and lint passed.
375 live Obsidian checks cover lists, nested content, three node widths, four
zoom levels, saving, Undo/Redo and content preservation. Large-document coverage
includes a 62,938-character node and a 130-node map with 214,310 characters.

Install `main.js`, `manifest.json` and `styles.css` together. Minimum Obsidian
version: 1.8.7.
