# 0.2.3 beta

This release is intended for independent review. The plugin and release tag are
`0.2.3`; GitHub marks the release as a prerelease. The stable `main` branch keeps
its existing `0.2.2` manifest until a stable promotion is requested.

The release includes multiline thought editing, explicit migration and backups,
classic single-line editing, guarded document writes, complete undo snapshots,
and the documented regression/performance fixes. Keyboard instructions are in
README. The inline instruction row and tooltip are removed from the editor.

Short editors use their content and the existing node height rather than a tall
instruction-driven minimum. An already queued overlay paint cannot replace a
newly opened editor, and a completed previous edit cannot steal focus from the
next one.

Validation: 308 automated tests, TypeScript/esbuild with startup smoke, ESLint,
and live Obsidian tests of short, long and classic editor sizing and content
preservation. Detailed data-model, interaction and performance audit reports are
also included under `docs/`. Those earlier reports retain their historical
measurement counts; this file records the final beta gate.

Install the three release assets together: `main.js`, `manifest.json`, and
`styles.css`. For beta installations using BRAT, select the `0.2.3` release.
Migration of an older outline remains explicit and creates a complete backup.
The prior Lineage and physical mobile-testing limitations still apply.
