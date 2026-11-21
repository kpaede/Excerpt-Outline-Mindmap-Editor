interface NodeEditHooks {
  save(text: string): Promise<void>;
  close(): void;
  refresh(): Promise<void>;
  select(): void;
  error(error: unknown): void;
  saving?(value: boolean): void;
}

/** Keep the draft open until commit; rebuild the preview only after removing the editor. */
export class NodeEditSession {
  private phase: 'editing' | 'saving' | 'closed' = 'editing';
  constructor(private readonly initialText: string, private readonly hooks: NodeEditHooks) {}
  get isEditing(): boolean { return this.phase === 'editing'; }
  private get isClosed(): boolean { return this.phase === 'closed'; }

  async finish(save: boolean, text: string): Promise<void> {
    if (!this.isEditing) return;
    this.phase = 'saving';
    if (save && text !== this.initialText) {
      this.hooks.saving?.(true);
      try { await this.hooks.save(text); }
      catch (error) {
        if (this.isClosed) return;
        this.phase = 'editing';
        this.hooks.saving?.(false);
        this.hooks.error(error);
        return;
      }
    }
    if (this.isClosed) return;
    this.dispose();
    try { await this.hooks.refresh(); }
    catch (error) { this.hooks.error(error); }
    if (save) this.hooks.select();
  }

  dispose(): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.hooks.close();
  }
}
