import { expect, it } from 'vitest';
import { indexTrack } from '../src/track-position';
import {
  METERS_PER_SECOND,
  replayAdvance,
  replayFix,
} from '../src/navigation-replay';

// Two straight legs: 0.01° east, then 0.01° north (about 1.1 km each).
const index = indexTrack([
  [
    [-22.9, -43.2],
    [-22.9, -43.19],
    [-22.89, -43.19],
  ],
]);
const departure = Date.UTC(2026, 10, 14, 12);

it('places the traveler on the track, heading along it, at the passage time', () => {
  const start = replayFix(index, 0, 60, departure)!;
  expect(start.coord[0]).toBeCloseTo(-22.9, 9);
  expect(start.coord[1]).toBeCloseTo(-43.2, 9);
  expect(start.heading).toBeCloseTo(90, 0);
  expect(start.speed).toBeCloseTo(60 / 3.6);
  expect(start.time).toBe(departure);

  const later = replayFix(index, index.total - 100, 60, departure)!;
  expect(later.heading).toBeCloseTo(0, 0);
  // 60 km/h is 1 km a minute.
  expect(later.time - departure).toBeCloseTo(
    ((index.total - 100) / 1000) * 60_000,
    -1,
  );
  // Past the end, the traveler stays at the destination.
  const end = replayFix(index, index.total + 500, 60, departure)!;
  expect(end.coord[0]).toBeCloseTo(-22.89, 6);
  expect(end.time - departure).toBeCloseTo((index.total / 1000) * 60_000, -1);
});

it('advances like Travel the route and stops at the destination', () => {
  // One second at 2× covers 500 m, as in Travel the route.
  expect(replayAdvance(0, 1000, 2, index.total)).toBe(2 * METERS_PER_SECOND);
  expect(replayAdvance(index.total - 10, 1000, 10, index.total)).toBe(
    index.total,
  );
  // A clock that went backwards never moves the traveler back.
  expect(replayAdvance(200, -50, 10, index.total)).toBe(200);
});

it('heads toward the track well ahead, past the small bends of a road', () => {
  // A point every 15 m, alternating 3 m to either side, heading east.
  const bends = indexTrack([
    Array.from({ length: 60 }, (_, i) => [
      -22.9 + (i % 2 ? 0.000027 : -0.000027),
      -43.2 + i * 0.000146,
    ]),
  ]);
  for (let d = 0; d < bends.total - 200; d += 7) {
    const heading = replayFix(bends, d, 60, departure)!.heading!;
    expect(Math.abs(heading - 90)).toBeLessThan(4);
  }
});

it('has nothing to replay on an empty track', () => {
  expect(replayFix(indexTrack([]), 0, 60, departure)).toBeNull();
});
