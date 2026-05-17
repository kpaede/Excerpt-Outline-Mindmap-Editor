# Excerpt-Outline-Mindmap-Editor

BEWARE: STILL IN BETA! Bugs, data loss, and instability are still very possible.

An Obsidian plugin for creating visual mindmaps optimized for literature excerpting. Running on pure Markdown outlines, with a drag-and-drop workflow.

![](demo.gif)

---

## What It Does

Excerpt-Outline-Mindmap-Editor lets you visually structure text excerpts as mindmaps using a  drag-and-drop system.

The underlying data model remains a standard Markdown outline (indented list) — fully compatible with Obsidian’s editor and outline plugins such as [Lineage](https://github.com/ycnmhd/obsidian-lineage).  
There is no proprietary format and no external storage.

---

## Key Features

- Drag-and-drop support for creating and editing hierarchical structures (Outline)
- Each node represents a list item with indentation in a Markdown outline  
- Dragging a node into another creates a parent-child relationship  
- When dragging a node, all its children move with it  
- Hover buttons allow adding new child and sibling nodes directly in the mindmap  
- Node deletion ask for:
  - Removing just the selected node, but keep its children
  - Deleting a node along with all its children
- undo/redo buttons
- layout options are stored in frontmatter of the respective file
- There is a Context Menu via Right Click
- Copy, Paste, Cut and Duplicate via Context Menu and Shortcuts
- Keyboard Navigation (Spatial and Hierarchical)
- you can select various nodes at once

---

## How to Use

1. Create a Markdown file: empty – or with an outline structure.
2. Open the file as a mindmap:
   - Click the three-dot menu in the top-right corner of the editor and select **"Open as mindmap"**,  
   - or right-click the file in the file explorer and choose **"Open as mindmap"**.
3. Use drag and drop to build or restructure your outline visually:

All changes are written to the file as a clean Markdown outline — no custom syntax or hidden metadata. You can open lineage files with this plugin and vice versa. Undo/redo history is preserved between sessions using frontmatter storage.

---

## Used Libraries

- [Cytoscape.js](https://js.cytoscape.org/) – for visual graph rendering  
- [Dagre](https://github.com/dagrejs/dagre) – for automatic hierarchical layout

Thanks to the developers.

---

## Inspiration

- [Lineage](https://github.com/ycnmhd/obsidian-lineage)
- [MarginNote](https://www.marginnote.com/)

---

## Roadmap

- Embedding Mindmaps into Markdown
- Export and print options  

---

## Disclaimer

I vibecode my plugins—and the scope of this work exceeds my programming skills. Because of this, there is always a residual risk when using them. I do this primarily to bridge certain gaps in my own workflow. Should these plugins ever become obsolete because a professional developer used them as inspiration to code something truly solid and sophisticated, I would be absolutely thrilled.

