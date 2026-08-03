type SelectorTarget = {
  closest?: (selector: string) => unknown;
  matches?: (selector: string) => boolean;
};

function canMatchSelector(value: unknown): value is SelectorTarget {
  return typeof value === 'object' && value !== null;
}

/**
 * Uses the composed event path so dismissal also works when Obsidian renders a
 * menu through a portal or WebKit retargets Pencil events across a shadow root.
 */
export function eventPathContainsSelector(event: Event, selector: string): boolean {
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : [event.target];

  return path.some((candidate) => {
    if (!canMatchSelector(candidate)) return false;
    if (typeof candidate.matches === 'function' && candidate.matches(selector)) return true;
    return typeof candidate.closest === 'function' && Boolean(candidate.closest(selector));
  });
}

export function eventTargetsObsidianMenu(event: Event): boolean {
  return eventPathContainsSelector(event, '.menu');
}
