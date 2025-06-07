import { Modal, App } from 'obsidian';

export type DeleteOption = "full" | "single" | null;

export class DeleteNodeModal extends Modal {
  private onConfirm: (result: DeleteOption) => void;

  constructor(app: App, onConfirm: (result: DeleteOption) => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    
    const container = contentEl.createDiv();
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    
    const fullBtn = container.createEl("button", { text: "Delete node and all children" });
    const singleBtn = container.createEl("button", { text: "Delete only current node (keep children)" });
    const cancelBtn = container.createEl("button", { text: "Cancel" });
    
    fullBtn.onclick = () => { this.close(); this.onConfirm("full"); };
    singleBtn.onclick = () => { this.close(); this.onConfirm("single"); };
    cancelBtn.onclick = () => { this.close(); this.onConfirm(null); };
  }

  onClose() {
    this.contentEl.empty();
  }
}
