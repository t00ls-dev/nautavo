import { describe, expect, it } from 'vitest';
import { insertionIndex } from '../src/route-drag';

describe('insertionIndex', () => {
  it('puts the stop after the last route point before it', () => {
    const positions = [0, 1000, 5000, 9000];
    expect(insertionIndex(positions, 500)).toBe(1);
    expect(insertionIndex(positions, 1000)).toBe(2);
    expect(insertionIndex(positions, 4999)).toBe(2);
    expect(insertionIndex(positions, 8000)).toBe(3);
  });
  it('keeps it between the start and the destination', () => {
    expect(insertionIndex([0, 9000], 0)).toBe(1);
    expect(insertionIndex([0, 9000], 9000)).toBe(1);
    expect(insertionIndex([100, 1000, 9000], 50)).toBe(1);
    expect(insertionIndex([0, 1000, 9000], 9500)).toBe(2);
  });
  it('skips points the track does not pass', () => {
    // The second point is far from the track: the stop comes right after
    // the last point the track passes before it.
    expect(insertionIndex([0, null, 5000, 9000], 3000)).toBe(1);
    expect(insertionIndex([0, null, 5000, 9000], 6000)).toBe(3);
  });
  it('follows the order of a loop that passes a place twice', () => {
    // An out-and-back: the turnaround point at 4000, the return after it.
    expect(insertionIndex([0, 4000, 8000], 6000)).toBe(2);
  });
});
