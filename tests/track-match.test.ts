import { describe, expect, it } from 'vitest';
import { meters, type Coord } from '../src/core';
import {
  alignedPiece,
  compareTrack,
  coveredShare,
  rebuildTrack,
  safeResult,
  type MatchRun,
} from '../src/track-match';
import { at, north, road } from './local-frame';
/** Kinds in order, consecutive repeats collapsed. */
const kinds = (runs: MatchRun[]) =>
  runs
    .filter((r) => r.to - r.from > 1)
    .map((r) => r.kind)
    .filter((k, i, all) => k !== all[i - 1]);
const length = (segments: Coord[][]) =>
  segments.reduce(
    (n, s) => n + s.slice(1).reduce((m, c, i) => m + meters(s[i], c), 0),
    0,
  );

describe('compareTrack', () => {
  it('finds a clean track on the road all along', () => {
    const track = road(0, 2000);
    expect(kinds(compareTrack([track], [road(0, 2000, 50)]))).toEqual(['same']);
  });

  it('repairs a spike: one point far away that comes back', () => {
    const track = [...road(0, 1000), at(1005, 400), ...road(1010, 2000)];
    const runs = compareTrack([track], [road(0, 2000, 50)]);
    expect(kinds(runs)).toEqual(['same', 'glitch', 'same']);
    const fixed = rebuildTrack([track], [road(0, 2000, 50)], runs);
    expect(length(fixed.segments)).toBeCloseTo(2000, -1);
  });

  it('repairs a zigzag while stopped at a junction', () => {
    const zigzag = [at(1000, 40), at(1010, -30), at(1000, 60), at(1005, -40)];
    const track = [...road(0, 1000), ...zigzag, ...road(1010, 2000)];
    const runs = compareTrack([track], [road(0, 2000, 50)]);
    expect(kinds(runs)).toContain('glitch');
    expect(kinds(runs)).not.toContain('off');
    const fixed = rebuildTrack([track], [road(0, 2000, 50)], runs);
    // Nothing stays farther from the road than the GPS tolerance (30 m).
    for (const c of fixed.segments.flat())
      expect(Math.abs(north(c))).toBeLessThanOrEqual(31);
  });

  it('keeps a ride up a side entrance and back, which is no glitch', () => {
    // Stopped beside the road: 70 m up a driveway and back on the same line.
    const depths = [10, 20, 30, 40, 50, 60, 70];
    const entrance = [...depths, ...depths.reverse().slice(1)].map((y) =>
      at(1000, y),
    );
    const track = [...road(0, 1000), ...entrance, ...road(1000, 2000)];
    const runs = compareTrack([track], [road(0, 2000, 50)]);
    expect(kinds(runs)).not.toContain('glitch');
    const kept = rebuildTrack([track], [road(0, 2000, 50)], runs);
    expect(Math.max(...kept.segments.flat().map(north))).toBeCloseTo(70, 0);
  });

  it('repairs a signal gap: a straight jump across a bend of the road', () => {
    // The road bends north and back; the recording jumps straight across.
    const bend = [
      ...road(0, 1000),
      ...[50, 100].map((y) => at(1000, y)),
      ...[1100, 1200].map((x) => at(x, 100)),
      ...[50].map((y) => at(1200, y)),
      ...road(1200, 2000),
    ];
    const track = [...road(0, 1000), ...road(1200, 2000)];
    const runs = compareTrack([track], [bend]);
    expect(kinds(runs)).toEqual(['same', 'glitch', 'same']);
    const fixed = rebuildTrack([track], [bend], runs);
    expect(length(fixed.segments)).toBeCloseTo(2200, -2);
  });

  it('never puts a much longer road in place of a straight jump', () => {
    // The only road across goes 1 km around a block (a one-way street).
    const around = [
      ...road(0, 1000),
      ...[100, 200, 300, 400, 500].map((y) => at(1000, y)),
      ...[1100, 1200].map((x) => at(x, 500)),
      ...[400, 300, 200, 100].map((y) => at(1200, y)),
      ...road(1200, 2000),
    ];
    const track = [...road(0, 1000), ...road(1200, 2000)];
    const runs = compareTrack([track], [around]);
    expect(kinds(runs)).not.toContain('glitch');
    expect(length(rebuildTrack([track], [around], runs).segments)).toBeCloseTo(
      2000,
      -1,
    );
  });

  it('keeps the straight line where the recording starts and ends', () => {
    // Indoors, the GPS jumps 150 m across the block to the street and back.
    const home = at(1000, 150);
    const track = [home, ...road(1000, 3000), home];
    const matched = road(1000, 3000, 50);
    const runs = compareTrack([track], [matched]);
    expect(kinds(runs)).not.toContain('glitch');
    const kept = rebuildTrack([track], [matched], runs).segments.flat();
    expect(kept[0]).toEqual(home);
    expect(kept.at(-1)).toEqual(home);
  });

  it('keeps the recorded line where the road is drawn beside it', () => {
    // The matched road runs 10 m to the side, as a matcher draws lanes.
    const track = road(0, 5000, 10);
    const beside = road(0, 5000, 50, 10);
    const runs = compareTrack([track], [beside]);
    expect(kinds(runs)).toEqual(['same']);
    const kept = rebuildTrack([track], [beside], runs).segments.flat();
    expect(kept).toEqual(track);
  });

  it('keeps and flags a stretch with no road: an unmapped path', () => {
    const path = [
      ...road(0, 1000),
      ...[100, 200, 300, 400].map((y) => at(1000 + y, y)),
      ...[300, 200, 100].map((y) => at(1800 - y, y)),
      ...road(1800, 3000),
    ];
    const runs = compareTrack([path], [road(0, 3000, 50)]);
    expect(kinds(runs)).toEqual(['same', 'off', 'same']);
    const kept = rebuildTrack([path], [road(0, 3000, 50)], runs);
    expect(kept.segments.flat()).toEqual(
      expect.arrayContaining([at(1400, 400)]),
    );
  });

  it('follows the recorded road of an out-and-back, never a parallel one', () => {
    const out = road(0, 3000);
    const back = [...out].reverse();
    const track = [...out, ...back.slice(1)];
    const matched = [...road(0, 3000, 50), ...road(0, 3000, 50).reverse()];
    const runs = compareTrack([track], [matched]);
    expect(kinds(runs)).toEqual(['same']);
    const followed = rebuildTrack([track], [matched], runs);
    // Every point stays on the recorded road (y = 0), not the parallel one.
    for (const c of followed.segments.flat())
      expect(Math.abs(north(c))).toBeLessThan(1);
  });

  it('keeps an out-and-back spur in the middle of a ride on its road', () => {
    // East 2 km, north 1.5 km up a dead end and back, then east 2 km more.
    // As in real rides, the recorded way back runs nearer the road's way out
    // than its way back: the nearest pass alone would pull the comparison
    // back along the spur and lose the road after it.
    const spur = (x: number, from: number, to: number, step: number) => {
      const out: Coord[] = [];
      for (let y = from; step > 0 ? y <= to : y >= to; y += step)
        out.push(at(x, y));
      return out;
    };
    const ride = (step: number, back: number) => [
      ...road(0, 2000, step),
      ...spur(2000, step, 1500, step),
      ...spur(back, 1500 - step, step, -step),
      ...road(2000, 4000, step),
    ];
    const recorded = ride(10, 1999),
      matched = ride(50, 1996);
    const runs = compareTrack([recorded], [matched]);
    expect(kinds(runs)).toEqual(['same']);
    const followed = rebuildTrack([recorded], [matched], runs);
    expect(length(followed.segments)).toBeCloseTo(7000, -2);
    expect(Math.max(...followed.segments.flat().map(north))).toBeGreaterThan(
      1490,
    );
  });
  it('never corrects a stretch that passes a route point', () => {
    const track = [...road(0, 1000), at(1005, 400), ...road(1010, 2000)];
    const runs = compareTrack([track], [road(0, 2000, 50)], undefined, [
      at(1005, 400),
    ]);
    expect(kinds(runs)).not.toContain('glitch');
  });
  it('marks stretches of failed pieces unknown and keeps them', () => {
    const track = road(0, 2000);
    const runs = compareTrack(
      [track],
      [road(0, 1000, 50)],
      [
        { from: 0, to: 1000, status: 'matched' },
        { from: 1000, to: 2000, status: 'failed' },
      ],
    );
    expect(kinds(runs)).toEqual(['same', 'unknown']);
  });

  it('keeps recorded elevation and interpolates it across a repair', () => {
    const track = [...road(0, 1000), at(1005, 400), ...road(1010, 2000)];
    const elevations = [track.map((_, i) => i)];
    const runs = compareTrack([track], [road(0, 2000, 50)]);
    const fixed = rebuildTrack([track], [road(0, 2000, 50)], runs, elevations);
    expect(fixed.elevations![0]).toHaveLength(fixed.segments[0].length);
    expect(fixed.elevations![0][0]).toBe(0);
    expect(fixed.elevations![0].every((h) => h !== null)).toBe(true);
  });
});

describe('alignedPiece', () => {
  const both = { start: false, end: false };
  /** A recording that wanders up to 12 m around the road. */
  const noisy = road(0, 5000, 10).map((_, i) =>
    at(i * 10, 12 * Math.sin((i * 10 * Math.PI) / 200)),
  );
  const matched = [road(0, 5000, 50)];

  it('lets the road stand for a noisy recording of it', () => {
    expect(alignedPiece([noisy], matched, [], [], both)).toEqual({
      head: 0,
      tail: 0,
    });
  });

  it('refuses a road longer than the ride: a detour', () => {
    const detour = [
      ...road(0, 2500, 50),
      ...[100, 200].map((y) => at(2500, y)),
      ...[200, 100].map((y) => at(2600, y)),
      ...road(2600, 5000, 50),
    ];
    expect(alignedPiece([noisy], [detour], [], [], both)).toBeNull();
  });

  it('refuses a road that folds part of the ride away', () => {
    const out = road(0, 2500, 10);
    const ride = [...out, ...[...out].reverse()];
    expect(alignedPiece([ride], [road(0, 2500, 50)], [], [], both)).toBeNull();
  });

  it('refuses a road that misses a route point the ride went to', () => {
    const stop = at(2500, 120);
    const ride = [...road(0, 2500), stop, ...road(2510, 5000)];
    expect(alignedPiece([ride], matched, [stop], [], both)).toBeNull();
  });

  it('refuses a road in parts: the matcher lost the track between them', () => {
    const parts = [road(0, 2000, 50), road(2100, 5000, 50)];
    expect(alignedPiece([noisy], parts, [], [], both)).toBeNull();
  });

  it('takes the street at the start, past the GPS line from indoors', () => {
    // Indoors, 250 m from the street: a straight line until the GPS found it.
    const ride = [at(0, 250), ...road(0, 5000)];
    expect(alignedPiece([ride], matched, [], [], both)).toBeNull();
    const ends = alignedPiece([ride], matched, [], [], {
      start: true,
      end: false,
    });
    expect(ends?.head).toBeGreaterThan(150);
    expect(ends?.tail).toBe(0);
  });

  it('carries recorded elevation along the road', () => {
    const ride = road(0, 2000, 10);
    const heights = [ride.map((_, i) => i)];
    const runs = [
      { kind: 'aligned' as const, from: 0, to: 2000, mFrom: 0, mTo: 2000 },
    ];
    const built = rebuildTrack([ride], [road(0, 2000, 50)], runs, heights);
    const h = built.elevations![0];
    expect(h[0]).toBe(0);
    expect(h.at(-1)).toBeCloseTo(200, 0);
    expect(h[Math.floor(h.length / 2)]).toBeCloseTo(100, -1);
  });
});

describe('coveredShare', () => {
  it('weighs points, so a long glitch counts little and an early stop much', () => {
    const zigzag = [at(1000, 300), at(1010, -300), at(1000, 300)];
    const glitchy = [...road(0, 1000, 10), ...zigzag, ...road(1010, 2000, 10)];
    // The zigzag adds 1.8 km to a 2 km ride, yet the road covers it.
    expect(coveredShare(glitchy, [road(0, 2000, 50)])).toBeGreaterThan(0.98);
    // A matcher that stopped halfway covers about half.
    expect(coveredShare(road(0, 2000, 10), [road(0, 1000, 50)])).toBeCloseTo(
      0.5,
      1,
    );
  });
});

describe('safeResult', () => {
  const spur = (to: number) => {
    const out: Coord[] = [];
    for (let y = 10; y <= to; y += 10) out.push(at(2000, y));
    return [...out, ...[...out].reverse().slice(1)];
  };
  const ride = [...road(0, 2000), ...spur(1500), ...road(2010, 4000)];
  it('accepts a result that covers the whole track', () => {
    expect(safeResult([ride], [ride], [at(2000, 1500)])).toBe(true);
  });
  it('refuses a result that cuts an out-and-back spur, with or without a stop on it', () => {
    const cut = [...road(0, 4000)];
    expect(safeResult([ride], [cut], [])).toBe(false);
    expect(safeResult([ride], [cut], [at(2000, 1500)])).toBe(false);
  });
  it('refuses a result that leaves a route point behind', () => {
    const stop = at(3000, 20);
    const track = road(0, 4000);
    const elsewhere = [...road(0, 2500), at(3000, 300), ...road(3500, 4000)];
    expect(safeResult([track], [elsewhere], [stop])).toBe(false);
  });
  it('refuses a long detour', () => {
    const detour = [...road(0, 2000), at(2000, 2000), ...road(2000, 4000)];
    expect(safeResult([road(0, 4000)], [detour], [])).toBe(false);
  });
  it('accepts a corrected glitch, which is the change it was asked to make', () => {
    const track = [...road(0, 1000), at(1005, 400), ...road(1010, 2000)];
    const runs = compareTrack([track], [road(0, 2000, 50)]);
    const fixed = rebuildTrack([track], [road(0, 2000, 50)], runs);
    expect(
      safeResult(
        [track],
        fixed.segments,
        [],
        runs.filter((r) => r.kind === 'glitch'),
      ),
    ).toBe(true);
  });
});
