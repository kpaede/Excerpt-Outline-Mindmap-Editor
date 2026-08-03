import { describe, expect, it, vi } from 'vitest';
import { eventPathContainsSelector, eventTargetsObsidianMenu } from '../src/view/menu-dismissal';

function eventWithPath(...path: unknown[]): Event {
  return {
    target: path[0] ?? null,
    composedPath: () => path,
  } as unknown as Event;
}

describe('context menu dismissal event routing', () => {
  it('keeps the menu open for a retargeted event whose composed path contains the menu', () => {
    const retargetedHost = { closest: vi.fn(() => null) };
    const menu = { matches: vi.fn((selector: string) => selector === '.menu') };

    expect(eventTargetsObsidianMenu(eventWithPath(retargetedHost, menu))).toBe(true);
  });

  it('dismisses for an empty-canvas event', () => {
    const canvas = { closest: vi.fn(() => null), matches: vi.fn(() => false) };

    expect(eventTargetsObsidianMenu(eventWithPath(canvas))).toBe(false);
  });

  it('finds toolbar controls anywhere in a composed path', () => {
    const toolbarButton = {
      closest: vi.fn((selector: string) => selector.includes('.vertical-toolbar') ? {} : null),
    };

    expect(eventPathContainsSelector(eventWithPath({}, toolbarButton), '.vertical-toolbar, .node-options-menu'))
      .toBe(true);
  });

  it('falls back to event.target when composedPath is unavailable', () => {
    const event = {
      target: { closest: (selector: string) => selector === '.menu' ? {} : null },
    } as unknown as Event;

    expect(eventTargetsObsidianMenu(event)).toBe(true);
  });
});
