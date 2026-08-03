/**
 * Opt-in tracing for the "an edited drawing still shows its old state" path.
 *
 * Silent unless someone sets `window.EOME_DEBUG_DRAWING = true` in the
 * developer console. The refresh chain spans a vault event, a debounce, a
 * layout pass and an animation frame, so when it misbehaves the only useful
 * question is which of those links ran - and that cannot be answered from the
 * rendered result alone.
 */
export function logDrawingRefresh(stage: string, details: Record<string, unknown>): void {
  if (!(globalThis as { EOME_DEBUG_DRAWING?: boolean }).EOME_DEBUG_DRAWING) return;
  console.log(`[eome:drawing] ${stage}`, details);
}

export function isDrawingRefreshLogging(): boolean {
  return Boolean((globalThis as { EOME_DEBUG_DRAWING?: boolean }).EOME_DEBUG_DRAWING);
}
