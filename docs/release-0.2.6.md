# 0.2.6

The file and editor menus now identify the plugin as **Open as mindmap (EOME)**.
Switching a mindmap to **Open in editor** keeps that document in the normal
Obsidian view in the chosen tab, including after window changes and workspace
restoration. Newly opened tabs still open marked mindmap files automatically,
even when another tab displays the same file in the editor. Delayed auto-open
requests cannot override a newer document or view choice or steal focus after
loading a large mindmap.

Connection lines now use a complete SVG layer that shares the node overlays'
pan and zoom. Newly added offscreen connections remain present when moving
between different parts of a large map and switching tabs. Cytoscape continues
to calculate the layout and the direct or right-angle routes. Editing an
offscreen child pans its editor into view without changing the zoom.

Background windows no longer depend solely on animation frames to complete
their node overlays. A cancellable timer fallback completes pending updates;
new-node editors start from the completed overlay pass.

Validation: 348 automated tests, ESLint and the production build/startup smoke
passed. Twenty isolated live Obsidian checks cover both line styles, offscreen
child creation, connection visibility after tab changes, viewport preservation,
the persistent editor choice, and automatic opening in a second tab. Test notes
were removed and the previous views restored. Physical mobile devices were not
tested for this release.

Install `main.js`, `manifest.json` and `styles.css` together. Minimum Obsidian
version: 1.8.7.
