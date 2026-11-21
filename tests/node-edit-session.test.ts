import { describe, expect, it, vi } from 'vitest';
import { NodeEditSession } from '../src/editor/node-edit-session';
import { DocumentConflictError } from '../src/storage/document-writer';

function setup(save = async (_text: string) => {}) {
  const events: string[] = [];
  const hooks = {
    save: vi.fn(async (text: string) => { events.push('save'); await save(text); events.push('saved'); }),
    close: vi.fn(() => { events.push('close'); }),
    refresh: vi.fn(async () => { events.push('refresh'); }),
    select: vi.fn(() => { events.push('select'); }),
    error: vi.fn(),
    saving: vi.fn((value: boolean) => { events.push(value ? 'readonly' : 'editable'); }),
  };
  return { session: new NodeEditSession('Initial', hooks), hooks, events };
}

describe('complete the actual inline edit before rebuilding its preview', () => {
  it('commits multiline content, closes the editor, then refreshes the preview', async () => {
    const { session, hooks, events } = setup();
    await session.finish(true, 'Paragraph\n\n- internal\n  - nested');
    expect(hooks.save).toHaveBeenCalledWith('Paragraph\n\n- internal\n  - nested');
    expect(events).toEqual(['readonly', 'save', 'saved', 'close', 'refresh', 'select']);
    expect(session.isEditing).toBe(false);
  });
  it('keeps a conflicting draft editable and permits a later retry', async () => {
    let reject = true;
    const { session, hooks, events } = setup(async () => { if (reject) throw new DocumentConflictError(); });
    await session.finish(true, 'Draft\n- list');
    expect(session.isEditing).toBe(true);
    expect(hooks.close).not.toHaveBeenCalled();
    expect(hooks.refresh).not.toHaveBeenCalled();
    expect(events).toEqual(['readonly', 'save', 'editable']);
    reject = false;
    await session.finish(true, 'Draft\n- list');
    expect(hooks.close).toHaveBeenCalledOnce();
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });
  it('does not race a second Enter or blur against an in-progress write', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { session, hooks } = setup(async () => pending);
    const first = session.finish(true, 'Long draft');
    await session.finish(true, 'Long draft');
    await session.finish(false, 'Long draft');
    expect(hooks.save).toHaveBeenCalledOnce();
    expect(hooks.close).not.toHaveBeenCalled();
    release(); await first;
    expect(hooks.close).toHaveBeenCalledOnce();
  });
  it('cancels without writing and refreshes external changes after closing', async () => {
    const { session, hooks, events } = setup();
    await session.finish(false, 'Uncommitted\ntext');
    expect(hooks.save).not.toHaveBeenCalled();
    expect(events).toEqual(['close', 'refresh']);
    expect(hooks.select).not.toHaveBeenCalled();
  });
  it('does not rewrite an unchanged node and cleans up only once', async () => {
    const { session, hooks } = setup();
    await session.finish(true, 'Initial');
    session.dispose();
    await session.finish(true, 'Something later');
    expect(hooks.save).not.toHaveBeenCalled();
    expect(hooks.close).toHaveBeenCalledOnce();
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });
});
