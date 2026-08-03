import { describe, expect, it, vi } from 'vitest';
import { AnimationFrameHost, RenderLifecycle } from '../src/view/render-lifecycle';

class FakeAnimationFrames implements AnimationFrameHost {
  private nextHandle = 1;
  private callbacks = new Map<number, FrameRequestCallback>();
  readonly cancelled: number[] = [];

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }

  fire(handle: number): void {
    const callback = this.callbacks.get(handle);
    this.callbacks.delete(handle);
    callback?.(0);
  }
}

describe('RenderLifecycle', () => {
  it('serializes overlapping renders and lets only the latest generation commit', async () => {
    const lifecycle = new RenderLifecycle();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = lifecycle.enqueueLatest(async (render) => {
      events.push('first:start');
      await firstGate;
      if (render.isCurrent()) events.push('first:commit');
      events.push('first:end');
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const second = lifecycle.enqueueLatest(async (render) => {
      events.push('second:start');
      if (render.isCurrent()) events.push('second:commit');
    });

    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:commit',
    ]);
  });

  it('cancels a scheduled overlay frame when rendering is reset', () => {
    const lifecycle = new RenderLifecycle();
    const frames = new FakeAnimationFrames();
    const callback = vi.fn();
    const discarded = vi.fn();
    const generation = lifecycle.currentGeneration();

    expect(lifecycle.scheduleFrame(
      'overlay',
      frames,
      generation,
      () => true,
      callback,
      discarded
    )).toBe(true);

    lifecycle.cancelFrames();
    frames.fire(1);

    expect(frames.cancelled).toEqual([1]);
    expect(discarded).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });

  it('rechecks the live render context immediately before a frame runs', () => {
    const lifecycle = new RenderLifecycle();
    const frames = new FakeAnimationFrames();
    const callback = vi.fn();
    const discarded = vi.fn();
    let connectedToExpectedGraph = true;

    lifecycle.scheduleFrame(
      'geometry',
      frames,
      lifecycle.currentGeneration(),
      () => connectedToExpectedGraph,
      callback,
      discarded
    );
    connectedToExpectedGraph = false;
    frames.fire(1);

    expect(discarded).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });
});
