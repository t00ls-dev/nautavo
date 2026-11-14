import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOUPE,
  loupeCenter,
  placementMode,
  rememberPlacementMode,
} from '../src/point-placement';

const phone = { x: 390, y: 700 };
const half = LOUPE.size / 2 + LOUPE.margin;

describe('loupeCenter', () => {
  it('sits above the marker tip, clear of the finger', () => {
    expect(loupeCenter({ x: 200, y: 400 }, phone)).toEqual({
      x: 200,
      y: 400 - LOUPE.lift,
    });
    // The whole circle stays above the tip.
    expect(400 - LOUPE.lift + LOUPE.size / 2).toBeLessThan(400 - 24);
  });
  it('moves beside the marker near the top, toward the wider side', () => {
    const left = loupeCenter({ x: 80, y: 90 }, phone);
    expect(left.x).toBeGreaterThan(80 + LOUPE.size / 2);
    const right = loupeCenter({ x: 320, y: 90 }, phone);
    expect(right.x).toBeLessThan(320 - LOUPE.size / 2);
  });
  it('never leaves the map', () => {
    for (const tip of [
      { x: 0, y: 0 },
      { x: 390, y: 0 },
      { x: 0, y: 700 },
      { x: 390, y: 700 },
      { x: 10, y: 130 },
    ]) {
      const c = loupeCenter(tip, phone);
      expect(c.x).toBeGreaterThanOrEqual(half);
      expect(c.x).toBeLessThanOrEqual(phone.x - half);
      expect(c.y).toBeGreaterThanOrEqual(half);
      expect(c.y).toBeLessThanOrEqual(phone.y - half);
    }
  });
});

describe('placement preference', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to the loupe and keeps a crosshair choice', () => {
    expect(placementMode()).toBe('loupe');
    rememberPlacementMode('crosshair');
    expect(localStorage.getItem('point-placement')).toBe('crosshair');
    expect(placementMode()).toBe('crosshair');
    rememberPlacementMode('loupe');
    expect(localStorage.getItem('point-placement')).toBeNull();
    expect(placementMode()).toBe('loupe');
  });
  it('ignores unknown stored values', () => {
    localStorage.setItem('point-placement', 'other');
    expect(placementMode()).toBe('loupe');
  });
});
