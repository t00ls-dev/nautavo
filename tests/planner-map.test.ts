import { describe, expect, it } from 'vitest';
import { clearInsets } from '../src/planner-map';

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});
// A 390 × 844 phone map, as the planner lays it out.
const map = box(0, 0, 390, 844);
const sheet = box(0, 380, 390, 844),
  header = box(8, 8, 234, 52),
  tools = box(336, 10, 380, 288),
  credits = box(282, 326, 326, 370);

describe('clearInsets', () => {
  it('avoids each cover from the edge that costs the least map', () => {
    expect(clearInsets(map, [sheet, header, tools])).toEqual({
      top: 52,
      right: 54,
      bottom: 464,
      left: 0,
    });
  });
  it('reuses an edge already avoided when that costs less', () => {
    // The credits button sits just above the sheet: the bottom grows by 54
    // px (6% of the height) rather than the right by 54 (14% of the width).
    expect(clearInsets(map, [credits, tools, sheet]).bottom).toBe(518);
    expect(clearInsets(map, [credits, tools, sheet]).right).toBe(54);
  });
  it('ignores boxes outside the map, such as the desktop side panel', () => {
    const wide = box(400, 0, 1440, 900);
    expect(clearInsets(wide, [box(0, 0, 400, 900)])).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});
