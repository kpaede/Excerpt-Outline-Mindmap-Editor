import { describe, expect, it } from 'vitest';
import { MeasurementCache } from '../src/view/measurement-cache';

describe('memory bound for measurement source keys', () => {
  it('evicts complete old cached entries by character budget, without shortening keys', () => {
    const cache = new MeasurementCache<number>(10, 100);
    cache.set('aaaa', 1).set('bbbb', 2).set('cccc', 3);
    expect([...cache.keys()]).toEqual(['bbbb', 'cccc']);
    cache.delete('bbbb');
    cache.set('dddddd', 4);
    expect([...cache.keys()]).toEqual(['cccc', 'dddddd']);
    cache.clear(); cache.set('1234567890', 5);
    expect([...cache.keys()]).toEqual(['1234567890']);
  });
  it('does not retain an oversized key and also enforces entry count', () => {
    const cache = new MeasurementCache<number>(100, 2);
    cache.set('A', 1).set('B', 2).set('C', 3);
    expect([...cache.keys()]).toEqual(['B', 'C']);
    cache.set('x'.repeat(101), 9);
    expect([...cache.keys()]).toEqual(['B', 'C']);
    cache.set('B', 4);
    expect(cache.get('B')).toBe(4);
  });
});
