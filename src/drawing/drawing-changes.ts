/**
 * Serialises drawing items so two snapshots of a board can be compared.
 *
 * Object keys are emitted in sorted order because the whiteboard rebuilds
 * items when they are imported and nothing guarantees it writes their
 * properties back in the order they arrived. A raw JSON comparison would
 * report an untouched drawing as modified and ask the user to save a change
 * they never made.
 *
 * The snapshot to compare against is taken from the board itself once the
 * drawing has been imported - not from the items the editor was opened with -
 * so anything the import/export round trip normalises is already part of the
 * baseline rather than showing up as an edit.
 */
export function canonicalizeDrawing(items: readonly unknown[]): string {
  return JSON.stringify(items.map(canonicalValue));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalValue(source[key]);
    }
    return sorted;
  }
  return value;
}
