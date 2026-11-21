/** Plugin CSS can arrive after the view during hot reload. Never cache the
 * viewport-wide, unstyled box as a tiny scaled thought. */
export async function waitForMeasurementStyles(
  width: number,
  maxWidth: () => string,
  nextFrame: () => Promise<void>,
  isCurrent: () => boolean
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!isCurrent()) return false;
    if (Math.abs(parseFloat(maxWidth()) - width) < 0.5) return true;
    await nextFrame();
  }
  return false;
}
