import { Notice, Plugin, TFile } from 'obsidian';
import {
  setDrawingRefreshLogging,
  setDrawingRefreshSink,
} from '../view/drawing-refresh-log';

export const DIAGNOSTICS_PATH = 'EOME drawing diagnostics.md';
const FLUSH_DELAY_MS = 800;

/**
 * Collects the drawing-refresh trace into a note in the vault.
 *
 * The refresh problem shows up on iPad, where Obsidian has no developer
 * console and the available inspectors cannot be read from comfortably. A note
 * syncs like any other file, so the trace can be collected on the device where
 * the problem happens and read wherever the vault is.
 */
class DiagnosticsFile {
  private buffer: string[] = [];
  private flushTimer: number | null = null;
  private writing = false;

  constructor(private readonly plugin: Plugin) {}

  append(line: string): void {
    this.buffer.push(line);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (this.writing) {
      this.scheduleFlush();
      return;
    }

    this.writing = true;
    const chunk = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    try {
      const { vault } = this.plugin.app;
      const existing = vault.getAbstractFileByPath(DIAGNOSTICS_PATH);
      if (existing instanceof TFile) {
        await vault.append(existing, chunk);
      } else {
        await vault.create(DIAGNOSTICS_PATH, chunk);
      }
    } catch (error) {
      console.error('Could not write the drawing diagnostics:', error);
    } finally {
      this.writing = false;
      if (this.buffer.length > 0) this.scheduleFlush();
    }
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }
}

export function registerDrawingDiagnostics(plugin: Plugin): void {
  let file: DiagnosticsFile | null = null;

  const stop = (): void => {
    setDrawingRefreshLogging(false);
    setDrawingRefreshSink(null);
    file?.dispose();
    file = null;
  };

  plugin.addCommand({
    id: 'toggle-drawing-diagnostics',
    name: 'Toggle drawing refresh diagnostics',
    callback: () => {
      if (file) {
        stop();
        new Notice(`Drawing diagnostics off. See "${DIAGNOSTICS_PATH}".`);
        return;
      }

      const started = new DiagnosticsFile(plugin);
      file = started;
      setDrawingRefreshSink((line) => started.append(line));
      setDrawingRefreshLogging(true);
      const build = (globalThis as { EOME_BUILD?: string }).EOME_BUILD ?? 'unknown';
      started.append(`--- started ${new Date().toISOString()} build=${build} ---`);
      new Notice(`Drawing diagnostics on. Writing to "${DIAGNOSTICS_PATH}".`);
    },
  });

  plugin.register(stop);
}
