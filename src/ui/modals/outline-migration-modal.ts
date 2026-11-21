import { Modal, Notice, type App, type Plugin, type TFile } from 'obsidian';
import { previewMigration } from '../../domain/outline-migration';
import { commitDocument, readDocument } from '../../storage/document-writer';

async function backup(app: App, file: TFile, text: string): Promise<void> {
  let index = 0;
  let path: string;
  do { path = `${file.path}.${Date.now()}-${index++}.eome-backup`; } while (app.vault.getAbstractFileByPath(path));
  await app.vault.create(path, text);
  new Notice(`Original saved to ${path}`);
}

class OutlineMigrationModal extends Modal {
  constructor(app: App, private file: TFile, private before: string, private after: string, private restoring = false) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: this.restoring ? 'Preview backup restoration' : 'Preview multiline migration' });
    this.contentEl.createEl('p', { text: 'Review the full result below. Confirming saves a complete backup before changing the file.' });
    const preview = this.contentEl.createEl('textarea', { cls: 'eome-migration-preview' });
    preview.readOnly = true;
    preview.value = this.after;
    const confirm = this.contentEl.createEl('button', { text: this.restoring ? 'Back up and restore' : 'Back up and migrate' });
    confirm.onclick = async () => {
      confirm.disabled = true;
      try {
        if (await readDocument(this.app, this.file) !== this.before) throw new Error('File changed after preview. Open a new preview.');
        await backup(this.app, this.file, this.before);
        await commitDocument(this.app, this.file, this.before, this.after);
        this.close();
      } catch (error) { new Notice(error instanceof Error ? error.message : 'Migration failed.'); confirm.disabled = false; }
    };
    this.contentEl.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
  }
  onClose(): void { this.contentEl.empty(); }
}

class RestoreBackupModal extends Modal {
  constructor(app: App, private file: TFile) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Select a migration backup' });
    const backups = this.app.vault.getFiles().filter(file => file.path.startsWith(this.file.path + '.') && file.path.endsWith('.eome-backup'));
    if (!backups.length) this.contentEl.createEl('p', { text: 'No migration backups found for this file.' });
    for (const file of backups) {
      this.contentEl.createEl('button', { text: file.name }).onclick = async () => {
        const before = await readDocument(this.app, this.file);
        const after = await this.app.vault.read(file);
        this.close();
        new OutlineMigrationModal(this.app, this.file, before, after, true).open();
      };
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

export function registerMigrationCommands(plugin: Plugin): void {
  plugin.addCommand({
    id: 'preview-multiline-outline-migration', name: 'Preview migration to multiline outline',
    callback: async () => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return;
      try {
        const preview = previewMigration(await readDocument(plugin.app, file));
        if (preview.before === preview.after) { new Notice('This file already uses multiline outline format.'); return; }
        const modal = new OutlineMigrationModal(plugin.app, file, preview.before, preview.after);
        modal.open();
        modal.contentEl.createEl('p', { text: `${preview.nodeCount} nodes. Existing children remain children.` });
      } catch (error) { new Notice(error instanceof Error ? error.message : 'Cannot migrate this file.'); }
    },
  });
  plugin.addCommand({
    id: 'restore-multiline-outline-backup', name: 'Restore multiline migration backup',
    callback: () => {
      const file = plugin.app.workspace.getActiveFile();
      if (file) new RestoreBackupModal(plugin.app, file).open();
    },
  });
}
