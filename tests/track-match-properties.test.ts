import { describe, expect, it } from 'vitest';
import type { Coord } from '../src/core';
import { compareTrack, rebuildTrack, safeResult } from '../src/track-match';
import { at } from './local-frame';

/**
 * Generated rides checked against the properties the app relies on, so a
 * shape no hand-written test thought of still cannot cut a track: following
 * the matched road covers the whole recording and every route point, and a
 * repair changes nothing outside the glitches it replaces. A seeded random
 * generator keeps every case reproducible: a failure names its seed.
 */

/** Mulberry32: small, fast and deterministic. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type XY = [number, number];
/** A road as meters: straight runs, turns, out-and-back spurs and laps. */
function roadShape(rnd: () => number): XY[] {
  const out: XY[] = [[0, 0]];
  let heading = 0;
  const step = (length: number) => {
    const [x, y] = out.at(-1)!;
    out.push([x + Math.cos(heading) * length, y + Math.sin(heading) * length]);
  };
  for (let n = 0; n < 6 + Math.floor(rnd() * 6); n++) {
    const kind = rnd();
    if (kind < 0.2) {
      // Out-and-back up a dead end, then on the way it came.
      const turn = rnd() < 0.5 ? 1 : -1;
      heading += (turn * Math.PI) / 2;
      const length = 300 + rnd() * 1500;
      step(length);
      heading += Math.PI;
      step(length);
      heading += (turn * Math.PI) / 2;
    } else if (kind < 0.3) {
      // Two laps of a small loop.
      const side = 200 + rnd() * 400;
      for (let lap = 0; lap < 2; lap++)
        for (let k = 0; k < 4; k++) {
          step(side);
          heading += Math.PI / 2;
        }
    } else {
      if (rnd() < 0.5) heading += ((rnd() < 0.5 ? 1 : -1) * Math.PI) / 2;
      step(200 + rnd() * 1500);
    }
  }
  return out;
}
/** Points every `spacing` meters along the shape. */
function densify(shape: XY[], spacing: number): XY[] {
  const out: XY[] = [shape[0]];
  for (let i = 1; i < shape.length; i++) {
    const [ax, ay] = shape[i - 1],
      [bx, by] = shape[i];
    const length = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(length / spacing));
    for (let k = 1; k <= n; k++)
      out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}
/** Each direction of travel drawn on its own side, as a matcher returns it. */
function lanes(points: XY[], width: number): XY[] {
  return points.map(([x, y], i) => {
    const [px, py] = points[Math.max(0, i - 1)],
      [nx, ny] = points[Math.min(points.length - 1, i + 1)];
    const dx = nx - px,
      dy = ny - py,
      d = Math.hypot(dx, dy) || 1;
    return [x + (dy / d) * width, y - (dx / d) * width];
  });
}
const toCoords = (points: XY[]): Coord[] => points.map(([x, y]) => at(x, y));
const key = (c: Coord) => `${c[0]},${c[1]}`;

describe('generated rides', () => {
  for (let seed = 1; seed <= 300; seed++)
    it(`seed ${seed}: never cuts the track, and repairs only glitches`, () => {
      const rnd = random(seed);
      const shape = roadShape(rnd);
      const spacing = rnd() < 0.3 ? 30 + rnd() * 50 : 5 + rnd() * 10;
      const noise = rnd() * 8;
      const recordedXY = densify(shape, spacing).map(
        ([x, y]) =>
          [x + (rnd() - 0.5) * noise, y + (rnd() - 0.5) * noise] as XY,
      );
      // Glitches: a spike or a zigzag while stopped, at random places.
      const glitches = Math.floor(rnd() * 3);
      for (let g = 0; g < glitches; g++) {
        const i = 5 + Math.floor(rnd() * (recordedXY.length - 10));
        const [x, y] = recordedXY[i];
        if (rnd() < 0.5) recordedXY.splice(i, 0, [x + 300, y + 300]);
        else
          recordedXY.splice(
            i,
            0,
            [x + 40, y - 30],
            [x - 35, y + 45],
            [x + 50, y + 20],
          );
      }
      const recorded = toCoords(recordedXY);
      const matched = toCoords(lanes(densify(shape, 50), 2));
      const runs = compareTrack([recorded], [matched]);
      const glitchRuns = runs.filter((r) => r.kind === 'glitch');
      // Without glitches, the whole ride is on the road.
      if (!glitches) expect(runs.every((r) => r.kind === 'same')).toBe(true);

      const followed = rebuildTrack([recorded], [matched], runs);
      expect(
        safeResult(
          [recorded],
          followed.segments,
          [recorded.at(-1)!],
          glitchRuns,
        ),
      ).toBe(true);

      const repaired = rebuildTrack([recorded], [matched], runs);
      expect(
        safeResult(
          [recorded],
          repaired.segments,
          [recorded.at(-1)!],
          glitchRuns,
        ),
      ).toBe(true);
      // Every recorded point outside a replaced glitch is kept exactly.
      const kept = new Set(repaired.segments.flat().map(key));
      let along = 0;
      const index: number[] = [0];
      for (let i = 1; i < recorded.length; i++) {
        const [a, b] = [recordedXY[i - 1], recordedXY[i]];
        along += Math.hypot(b[0] - a[0], b[1] - a[1]);
        index.push(along);
      }
      recorded.forEach((c, i) => {
        const inGlitch = glitchRuns.some(
          (r) => index[i] >= r.from - 1 && index[i] <= r.to + 1,
        );
        if (!inGlitch) expect(kept.has(key(c))).toBe(true);
      });
    });
});
