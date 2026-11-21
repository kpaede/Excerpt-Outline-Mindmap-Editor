import { describe, expect, it } from 'vitest';
import { CommandHistory, type MindmapCommand } from '../src/history/command-history';
import { commitDocument } from '../src/storage/document-writer';
import { parseOutline } from '../src/utils/outline';
import { writeNode, writeNodeInText, moveSubtreeInText } from '../src/domain/mindmap-file';
import { document, largeTree, mockVault, richText, thought } from './multiline-fixtures';

function command(beforeState: string, afterState: string): MindmapCommand {
  return { type: 'edit-node', timestamp: Date.now(), beforeState, afterState, nodeInfo: { line: 0, text: 'Test', indent: '', marker: '-' } };
}

describe('lossless history and guarded writes', () => {
  it('restores twelve undo/redo states far beyond the old 50,000 character limit', async () => {
    const vault = mockVault(document(largeTree(64, 16)));
    const history = new CommandHistory(vault.app);
    const states = [vault.getText()];
    expect(states[0].length).toBeGreaterThan(100_000);
    for (let i = 0; i < 12; i++) {
      const before = vault.getText();
      const nodes = parseOutline(before);
      const after = i % 2 ? moveSubtreeInText(before, nodes.at(-1)!, nodes[0], false, 'first', 'before')
        : writeNodeInText(before, nodes[0], `Edit ${i}\n\n${richText}`);
      await commitDocument(vault.app, vault.file, before, after);
      history.executeCommand(command(before, after));
      states.push(after);
    }
    for (let i = states.length - 2; i >= 0; i--) {
      expect(await history.undo(vault.file)).toBe(states[i]);
      expect(vault.getText()).toBe(states[i]);
    }
    expect(history.canUndo()).toBe(false);
    for (let i = 1; i < states.length; i++) {
      expect(await history.redo(vault.file)).toBe(states[i]);
      expect(vault.getText()).toBe(states[i]);
    }
  });
  it('keeps complete megabyte-sized documents with tail sentinels across undo and redo', async () => {
    const content = ('Paragraph ä 日本語 🧠 with trailing spaces.  \n\n- internal item\n').repeat(25_000) + '\nEND OF COMPLETE EXCERPT';
    const before = document([thought(content, [thought('Real child at end\n\n')], 'unchecked')]);
    expect(before.length).toBeGreaterThan(1_000_000);
    const vault = mockVault(before);
    const node = parseOutline(before)[0];
    const after = writeNodeInText(before, node, content + '\nAnother paragraph');
    const history = new CommandHistory(vault.app);
    await commitDocument(vault.app, vault.file, before, after);
    history.executeCommand(command(before, after));
    expect(await history.undo(vault.file)).toBe(before);
    expect(parseOutline(vault.getText())[0].text).toBe(content);
    expect(await history.redo(vault.file)).toBe(after);
    expect(parseOutline(vault.getText())[0].children[0].text).toBe('Real child at end\n\n');
  });
  it('discards entire old entries to bound memory and never truncates snapshots', () => {
    const vault = mockVault('');
    const history = new CommandHistory(vault.app);
    const large = 'Text\n'.repeat(100_000);
    for (let i = 0; i < 30; i++) history.executeCommand(command(large + i, large + (i + 1)));
    const state = history.getHistoryState();
    expect(state.undoStack.length).toBeLessThan(20);
    for (const entry of state.undoStack) {
      expect(entry.beforeState.length).toBeGreaterThan(500_000);
      expect(entry.beforeState).not.toContain('[truncated]');
    }
    history.restoreHistoryState({ undoStack: [command('old...[truncated]', 'next')], redoStack: [] });
    expect(history.canUndo()).toBe(false);
  });
  it('does not overwrite an external modification while editing or while committing', async () => {
    const input = document([thought('Original\n' + richText)]);
    const vault = mockVault(input);
    const target = parseOutline(input)[0];
    const external = input + '\nExternal addition';
    vault.external(external);
    await expect(writeNode(vault.app, vault.file, target, 'Draft')).rejects.toThrow(/externally/);
    expect(vault.getText()).toBe(external);
    vault.external(input);
    vault.race(() => vault.external(external));
    await expect(writeNode(vault.app, vault.file, target, 'Draft')).rejects.toThrow(/externally/);
    expect(vault.getText()).toBe(external);
  });
  it('detects unsaved changes in a simultaneously open Markdown editor', async () => {
    const input = document([thought('Original')]);
    const vault = mockVault(input);
    vault.views.push({ view: { file: vault.file, editor: { getValue: () => input + '\nUnsaved editor change' } } });
    await expect(writeNode(vault.app, vault.file, parseOutline(input)[0], 'Draft')).rejects.toThrow(/externally/);
    expect(vault.getText()).toBe(input);
  });
  it('serializes concurrent commits and rejects an obsolete second snapshot', async () => {
    const vault = mockVault('Before');
    const results = await Promise.allSettled([
      commitDocument(vault.app, vault.file, 'Before', 'First'),
      commitDocument(vault.app, vault.file, 'Before', 'Second'),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(vault.getText()).toBe('First');
  });
  it('refuses undo after external changes and preserves history position', async () => {
    const vault = mockVault('After');
    const history = new CommandHistory(vault.app);
    history.executeCommand(command('Before', 'After'));
    vault.external('External');
    expect(await history.undo(vault.file)).toBeNull();
    expect(vault.getText()).toBe('External');
    expect(history.canUndo()).toBe(true);
    vault.external('After');
    expect(await history.undo(vault.file)).toBe('Before');
    vault.external('External 2');
    expect(await history.redo(vault.file)).toBeNull();
    expect(vault.getText()).toBe('External 2');
  });
});

it('does not confuse a clean LF editor view of a CRLF file with an external edit', async () => {
  const before = document([thought('Original')], '\r\n');
  const vault = mockVault(before);
  vault.views.push({ view: { file: vault.file, editor: { getValue: () => before.replace(/\r\n/g, '\n') } } });
  await expect(writeNode(vault.app, vault.file, parseOutline(before)[0], 'Edited')).resolves.toContain('Edited');
});

it('retains the persisted zoom through undo/redo instead of reporting a false external conflict',async()=>{const before='---\neome-outline-format: 2\nexcerpt-outline-mindmap: zoomFactor:0.65\n---\n- Before\n  full content  ';const after=before.replace('- Before','- After');const vault=mockVault(after.replace('zoomFactor:0.65','zoomFactor:0.7'));const h=new CommandHistory(vault.app);h.executeCommand(command(before,after));h.retainSavedZoom(.7);expect(await h.undo(vault.file)).toBe(before.replace('zoomFactor:0.65','zoomFactor:0.7'));expect(await h.redo(vault.file)).toBe(vault.getText());expect(vault.getText()).toBe(after.replace('zoomFactor:0.65','zoomFactor:0.7'));});
