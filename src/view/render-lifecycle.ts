export interface RenderTaskContext {
  readonly generation: number;
  isCurrent(): boolean;
}

export interface AnimationFrameHost {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

interface PendingFrame {
  host: AnimationFrameHost;
  handle: number;
  onDiscard?: () => void;
}

/**
 * Owns the ordering and deferred work for a single rendered mindmap.
 *
 * A newly requested render invalidates older work immediately, but starts only
 * after the previous async render has unwound. This avoids interleaved DOM
 * measurement while still making the newest document snapshot authoritative.
 */
export class RenderLifecycle {
  private generation = 0;
  private renderTail: Promise<void> = Promise.resolve();
  private readonly frames = new Map<string, PendingFrame>();

  currentGeneration(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  enqueueLatest(operation: (context: RenderTaskContext) => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    this.cancelFrames();

    const context: RenderTaskContext = {
      generation,
      isCurrent: () => this.isCurrent(generation),
    };
    const task = this.renderTail
      .catch(() => undefined)
      .then(() => operation(context));

    // A failed render must not permanently block later document snapshots.
    this.renderTail = task.then(() => undefined, () => undefined);
    return task;
  }

  scheduleFrame(
    key: string,
    host: AnimationFrameHost,
    generation: number,
    isStillValid: () => boolean,
    callback: () => void,
    onDiscard?: () => void
  ): boolean {
    if (this.frames.has(key)) return false;

    const pending: PendingFrame = { host, handle: 0, onDiscard };
    pending.handle = host.requestAnimationFrame(() => {
      if (this.frames.get(key) !== pending) return;
      this.frames.delete(key);

      if (!this.isCurrent(generation) || !isStillValid()) {
        onDiscard?.();
        return;
      }
      callback();
    });

    this.frames.set(key, pending);
    return true;
  }

  cancelFrames(): void {
    const pendingFrames = Array.from(this.frames.values());
    this.frames.clear();
    pendingFrames.forEach((pending) => {
      pending.host.cancelAnimationFrame(pending.handle);
      pending.onDiscard?.();
    });
  }

  invalidate(): void {
    this.generation++;
    this.cancelFrames();
  }
}
