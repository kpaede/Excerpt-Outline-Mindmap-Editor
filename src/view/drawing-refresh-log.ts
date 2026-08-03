/**
 * Opt-in tracing for the "an edited drawing still shows its old state" path.
 *
 * Silent unless someone sets `window.EOME_DEBUG_DRAWING = true` in the
 * developer console. The refresh chain spans a vault event, a debounce, a
 * layout pass and an animation frame, so when it misbehaves the only useful
 * question is which of those links ran - and that cannot be answered from the
 * rendered result alone.
 *
 * Everything is flattened into one string on purpose. The console this has to
 * be read in is the in-app one on a tablet, which renders logged objects as
 * unusable placeholders rather than something expandable.
 */
export function logDrawingRefresh(stage: string, details: Record<string, unknown>): void {
  if (!isDrawingRefreshLogging()) return;

  const parts = Object.entries(details).map(([key, value]) => `${key}=${format(value)}`);
  console.log(`[eome:drawing] ${stage}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`);
}

export function isDrawingRefreshLogging(): boolean {
  return Boolean((globalThis as { EOME_DEBUG_DRAWING?: boolean }).EOME_DEBUG_DRAWING);
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.map(format).join('|')}]`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}
