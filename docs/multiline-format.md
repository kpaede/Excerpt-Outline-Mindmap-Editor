# EOME multiline outline, version 2

The frontmatter property `eome-outline-format: 2` opts a document into this
grammar. Missing means legacy; opening never migrates or rewrites a file.
Unknown versions and malformed version-2 input are read-only in EOME.

* A node starts with exactly zero or more **tabs**, then `- `, then its first
  content line. The number of tabs is its depth. Depth starts at zero and may
  increase by at most one; siblings and ancestors must exist.
* Immediately following continuation lines start with the node's exact
  structural tabs plus **two spaces**. Remove only that prefix. Everything
  remaining belongs to the content, including lists, headings, fences, tabs,
  spaces, HTML comments and empty lines. Content precedes children.
* The next structural start begins a new node. A line without a continuation
  prefix ends the current content. Unindented document text, headings and blank
  separator lines remain outside nodes and are preserved. Indented orphan lines,
  noncanonical list markers and missing parents are errors, never repaired.
  Frontmatter and top-level fenced code are outside the tree.
* Only `[ ] `, `[x] ` or `[X] ` immediately after `- ` sets the node task state.
  A literal content start matching that syntax is escaped with one backslash.
  An initial backslash is itself escaped with one backslash. Decode only these
  two cases, once, on the first content line. Continuations need no escaping.
* Empty nodes are `- `. Content is split/joined on LF, preserving leading,
  internal and trailing empty lines and all content whitespace. CRLF input is
  accepted; edits retain the document newline style. Bare CR is unsupported.
* Source ranges are `[line, ownEnd)` for content and `[line, subtreeEnd)` for
  the complete subtree. The old `endLine` is a compatibility alias for
  `subtreeEnd - 1`. Separators and text outside these ranges are never moved.
* Node IDs exist in the editing session, independently of line positions.
  They are not extra Markdown markers. Concurrent changes are checked against
  the complete source snapshot before a node operation is committed.

Example (the indentation before `- Child` is a tab):

```markdown
---
eome-outline-format: 2
---
- [ ] First paragraph
  
  Second paragraph
  - An internal list item
	- Child
```

## Migration and recovery

Use **Preview migration to multiline outline**. The preview shows the entire
result and the legacy tree counts. Only explicitly confirming creates a unique
`.eome-backup` file containing the complete original, then commits against the
preview's original snapshot. If the file changes meanwhile, migration stops.
Migration parses the old hierarchy first; space-indented legacy children remain
children. Unsupported legacy continuation text is rejected instead of guessed.
Repeating migration on version 2 is a no-op. Use **Restore multiline migration
backup** to choose a backup and preview restoration; restoration also checks the
current snapshot and creates a safety backup first.

## Lineage boundary

The tab/continuation syntax follows Lineage's outline representation. EOME's
literal-task/backslash escape is an EOME extension. Do not assume it is decoded
by Lineage. Its parser and UI writing path must be tested separately; EOME's
lossless guarantees do not apply to another editor's whitespace normalization.

## Editing and resource limits

Enter continues or exits native Markdown lists; outside lists it saves the embedded editor. Shift+Enter inserts a literal line break.
Ctrl/Cmd+Enter remains a save shortcut; Escape cancels. The structural paste action outside the editor is explicit.
The normal editor paste preserves multiline content. File writes use a serialized
compare-and-swap through `Vault.process`, and check simultaneously open Markdown
editors. A changed source rejects the entire operation; the open draft remains.

Node previews grow to their complete measured height without internal scrollbars.
Only the active text editor uses a bounded scrolling surface. Large maps initially focus the first thought at a readable zoom;
**Fit to view** still provides the complete overview. The toolbar reports the
number of actual thoughts and the maximum child depth.

Task-only changes reuse Markdown DOM and layout. Render post-processors belong
to one disposable overlay generation; temporary measurement renderers are
unloaded after use. Plain-text measurements yield in batches and obsolete
measurement passes stop early. The measurement cache evicts complete entries
above 2,000,000 key characters or 1,000 entries. Undo retains at most 20 complete
commands within an 8,000,000-character snapshot budget. The most recent complete command is retained even when it alone exceeds the
budget; older complete entries are evicted. No saved or historical document is shortened.

Session IDs survive ordinary edits, line shifts and distinguishable subtree
moves. No identity markers are inserted into Markdown. A wholly external rewrite
of indistinguishable duplicate subtrees cannot reveal their previous identities
or the author's intention; only the newly valid structure can be read.


## Inline editor correction, 21 November 2026

A successful commit used to request overlays while the editor was still open.
The overlay guard skipped that request. Closing the editor then left old DOM
content and stale source snapshots behind. A mouse reopen could consequently
show old content and reject its next save as an external change, although the
first save was already on disk.

An edit session now commits first, closes the editor, and then refreshes the
preview. Mouse actions resolve their node against the current editing model.
An edit's source snapshot remains immutable until commit. The editor becomes
read-only during a pending write and becomes editable again on a real conflict.
The expanded editor owns its complete border and height, independently of the
small graph box for a newly created empty thought.

## Enter and long documents

EOME recognizes both CommonMark ListItem nodes and Obsidian HyperMD list tokens.
It never treats an unfinished syntax tree as proof that the cursor is outside a
list. Parsing for Enter proceeds in bounded slices and yields between them. A
changed draft, moved selection, closed editor or completed save cancels the
pending decision. Ordinary typing does not invoke this work. Ctrl/Cmd+Enter
remains an immediate explicit save independent of list context.

Own commands provide identity mappings even for identical empty nodes. Complete
recent source snapshots retain identity mappings for Undo/Redo. A file switch
clears file-specific history, selection, cut state, settings and measurements;
external changes with different contents are never suppressed by the local-write
flag. Settings load before the new file is drawn.
