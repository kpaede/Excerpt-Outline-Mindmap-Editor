import { describe, expect, it, vi } from 'vitest';
import { waitForMeasurementStyles } from '../src/view/measurement-styles';

describe('measuring a view before plugin CSS has loaded', () => {
  it('waits for the actual node width instead of caching an unstyled viewport measurement', async () => {
    let maxWidth = 'none';
    const frame = vi.fn(async () => { maxWidth = '300px'; });
    expect(await waitForMeasurementStyles(300, () => maxWidth, frame, () => true)).toBe(true);
    expect(frame).toHaveBeenCalledOnce();
  });
  it('does not defer an already styled measurement', async () => {
    const frame = vi.fn(async () => {});
    expect(await waitForMeasurementStyles(300, () => '300px', frame, () => true)).toBe(true);
    expect(frame).not.toHaveBeenCalled();
  });
  it('abandons obsolete measurements and does not accept a missing stylesheet', async () => {
    const frame = vi.fn(async () => {});
    expect(await waitForMeasurementStyles(300, () => 'none', frame, () => false)).toBe(false);
    expect(frame).not.toHaveBeenCalled();
    expect(await waitForMeasurementStyles(300, () => 'none', frame, () => true)).toBe(false);
    expect(frame).toHaveBeenCalledTimes(30);
  });
});
