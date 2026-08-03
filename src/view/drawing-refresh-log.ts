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
type DrawingRefreshSink = (line: string) => void;

let sink: DrawingRefreshSink | null = null;
let enabled = false;

/**
 * Sends the trace somewhere other than the console. Obsidian on iOS has no
 * developer console, so a trace that can only be read in one cannot be
 * collected on the device where the problem actually shows up.
 */
export function setDrawingRefreshSink(next: DrawingRefreshSink | null): void {
  sink = next;
}

export function setDrawingRefreshLogging(on: boolean): void {
  enabled = on;
}

export function logDrawingRefresh(stage: string, details: Record<string, unknown>): void {
  if (!isDrawingRefreshLogging()) return;

  const parts = Object.entries(details).map(([key, value]) => `${key}=${format(value)}`);
  const line = `${new Date().toISOString().slice(11, 23)} ${stage}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`;
  console.log(`[eome:drawing] ${line}`);
  sink?.(line);
}

export function isDrawingRefreshLogging(): boolean {
  return enabled || Boolean((globalThis as { EOME_DEBUG_DRAWING?: boolean }).EOME_DEBUG_DRAWING);
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.map(format).join('|')}]`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}
