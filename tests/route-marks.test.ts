import { describe, expect, it } from 'vitest';
import type { Coord, Route } from '../src/core';
import {
  passOf,
  repeatedRanges,
  routePieces,
  splitByRepeat,
} from '../src/route-marks';
import { indexTrack, pointAtDistance } from '../src/track-position';

// About 111.2 m per 0.001°; tracks along the equator or the prime meridian.
const line = (from: number, to: number, step = 0.0005): Coord[] => {
  const n = Math.round(Math.abs(to - from) / step);
  return Array.from({ length: n + 1 }, (_, i) => [
    0,
    from + ((to - from) * i) / n,
  ]);
};

describe('repeated stretches', () => {
  it('marks both passes of an out-and-back, from the start to the turn', () => {
    // 2 km east, then back west on the same road.
    const track = [...line(0, 0.018), ...line(0.018, 0).slice(1)];
    const ranges = repeatedRanges([track]);
    expect(ranges.length).toBe(2);
    const [outbound, back] = ranges;
    expect(outbound.from).toBeLessThan(50);
    expect(outbound.to).toBeGreaterThan(1700);
    expect(back.to).toBeGreaterThan(3900);
    // Near the turn the passes are within 200 m of each other along the track.
    expect(outbound.to).toBeLessThan(2000);
  });

  it('ignores a square loop and a figure-eight crossing', () => {
    const d = 0.009; // about 1 km
    const square: Coord[] = [
      [0, 0],
      [0, d],
      [d, d],
      [d, 0],
      [0, 0],
    ];
    expect(repeatedRanges([square])).toEqual([]);
    const eight: Coord[] = [
      [0, 0],
      [d, d],
      [d, 0],
      [0, d],
      [0, 0],
    ];
    expect(repeatedRanges([eight])).toEqual([]);
  });

  it('keeps parallel roads more than 20 m apart separate', () => {
    // 40 m apart (0.00036°), opposite directions.
    const there = line(0, 0.018);
    const back = line(0.018, 0).map(([, lon]): Coord => [0.00036, lon]);
    expect(repeatedRanges([[...there, ...back]])).toEqual([]);
  });

  it('handles separate GPX segments and empty input', () => {
    const ranges = repeatedRanges([line(0, 0.018), line(0.018, 0)]);
    expect(ranges.length).toBe(2);
    expect(repeatedRanges([])).toEqual([]);
  });
});

describe('drawing helpers', () => {
  it('splits coloring ranges at repeated boundaries', () => {
    expect(
      splitByRepeat(
        [{ from: 0, to: 100, kind: 'day' }],
        [{ from: 30, to: 60, kind: 'repeated', repeated: true }],
      ),
    ).toEqual([
      { from: 0, to: 30, kind: 'day', repeated: false },
      { from: 30, to: 60, kind: 'day', repeated: true },
      { from: 60, to: 100, kind: 'day', repeated: false },
    ]);
  });
});

describe('route pieces between two distances', () => {
  const route = (segments: Coord[][]): Route => ({
    segments,
    steps: [],
    distance: 0,
    duration: 0,
    provider: 'OSRM',
  });
  const length = (coords: Coord[]) =>
    coords
      .slice(1)
      .reduce((sum, c, i) => sum + Math.abs(c[1] - coords[i][1]), 0);

  it('cuts an out-and-back at the progress, flagging the passes', () => {
    // 2 km east and back: the way travelled and the way ahead.
    const outAndBack = route([[...line(0, 0.018), ...line(0.018, 0).slice(1)]]);
    const total = routePieces(outAndBack).reduce(
      (sum, p) => sum + length(p.coords),
      0,
    );
    const travelled = routePieces(outAndBack, 0, 3000),
      ahead = routePieces(outAndBack, 3000);
    expect(travelled.some((p) => p.repeated)).toBe(true);
    expect(ahead.every((p) => p.repeated)).toBe(true);
    const sum = (pieces: { coords: Coord[] }[]) =>
      pieces.reduce((n, p) => n + length(p.coords), 0);
    expect(sum(travelled) + sum(ahead)).toBeCloseTo(total, 9);
    // The way ahead starts at the progress, on the way back.
    expect(ahead[0].coords[0][1]).toBeCloseTo(
      0.018 - (3000 - 2002) / 111195,
      3,
    );
  });

  it('returns a road used once whole, or nothing past its end', () => {
    const once = route([line(0, 0.018)]);
    expect(routePieces(once)).toEqual([
      { repeated: false, coords: once.segments[0] },
    ]);
    expect(routePieces(once, 5000)).toEqual([]);
    const [half] = routePieces(once, 0, 1000);
    expect(half.repeated).toBe(false);
    expect(half.coords.at(-1)![1]).toBeCloseTo(1000 / 111195, 4);
  });
});

describe('weather passes on a road used both ways', () => {
  const passAt = (segments: Coord[][], distance: number) => {
    const index = indexTrack(segments);
    const point = pointAtDistance(index, distance)!;
    return passOf(index, distance, point.coord, point.bearing);
  };
  it('names the outbound and the return of an out-and-back', () => {
    // 2 km east, then back west on the same road.
    const track = [...line(0, 0.018), ...line(0.018, 0).slice(1)];
    expect(passAt([track], 0)).toBe('outbound');
    expect(passAt([track], 500)).toBe('outbound');
    expect(passAt([track], 3500)).toBe('return');
    // The destination of the round trip, arriving westward.
    const end = indexTrack([track]).total;
    expect(passAt([track], end)).toBe('return');
  });
  it('leaves one-way roads and parallel roads unlabelled', () => {
    expect(passAt([line(0, 0.018)], 900)).toBeNull();
    // Back on a parallel road about 100 m north.
    const north = line(0.018, 0).map(([, lon]): Coord => [0.0009, lon]);
    const track = [...line(0, 0.018), ...north];
    expect(passAt([track], 500)).toBeNull();
  });
  it('ignores a point without a direction', () => {
    const track = [...line(0, 0.018), ...line(0.018, 0).slice(1)];
    const index = indexTrack([track]);
    expect(passOf(index, 500, [0, 0.0045], null)).toBeNull();
  });
});
