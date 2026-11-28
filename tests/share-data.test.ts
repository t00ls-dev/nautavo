import { describe, expect, it } from 'vitest';
import type { Climb } from '../src/climbs';
import type { Coord } from '../src/core';
import {
  shareClimbs,
  stripIndices,
  trimEnds,
  weatherSummary,
  type ShareWeather,
} from '../src/share-data';
import { frameView } from '../src/share-map';

const HOUR = 3_600_000;
const sample = (
  hour: number,
  temperature: number | null,
  extra: Partial<ShareWeather> = {},
): ShareWeather => ({
  time: hour * HOUR,
  distance: hour * 20_000,
  temperature,
  icon: 'weather-sun',
  relation: 'Crosswind',
  wind: 10,
  rain: false,
  ...extra,
});
const celsius = (c: number) => `${c}\u00a0°C`;
const clock = (time: number) => `${time / HOUR}:00`;

describe('share image data (#45)', () => {
  it('keeps the first and last weather samples and spreads the rest in time', () => {
    expect(stripIndices([0, 1, 2])).toEqual([0, 1, 2]);
    const times = [0, 1, 2, 3, 4, 5, 6, 9].map((h) => h * HOUR);
    expect(stripIndices(times)).toEqual([0, 3, 6, 7]);
  });

  it('sums up the weather: range, rain and the first strong headwind', () => {
    expect(weatherSummary([], celsius, clock)).toEqual([]);
    expect(
      weatherSummary([sample(7, 18), sample(9, 27)], celsius, clock),
    ).toEqual(['18–27 °C', 'no rain expected']);
    expect(
      weatherSummary(
        [
          sample(7, 20),
          sample(8, 20, { relation: 'Headwind', wind: 10 }),
          sample(9, 20, { rain: true }),
          sample(11, 20, { relation: 'Headwind', wind: 22 }),
        ],
        celsius,
        clock,
      ),
    ).toEqual(['20 °C', 'rain possible around 9:00', 'headwind around 11:00']);
  });

  it('labels the hardest climbs in route order', () => {
    const climb = (start: number, score: number) =>
      ({ start, end: start + 1000, score }) as Climb;
    const picked = shareClimbs([
      climb(0, 5),
      climb(5000, 30),
      climb(9000, 25),
      climb(12000, 20),
    ]);
    expect(picked.map((c) => c.start)).toEqual([5000, 9000]);
  });

  it('hides the first and last 500 m of the track', () => {
    // About 111 m per thousandth of a degree of latitude.
    const line: Coord[] = Array.from({ length: 31 }, (_, i) => [i * 0.001, 0]);
    const trimmed = trimEnds([line])!;
    const first = trimmed[0][0][0],
      last = trimmed[0].at(-1)![0];
    expect(first).toBeCloseTo(0.005, 3);
    expect(last).toBeCloseTo(0.025, 3);
    expect(trimEnds([line.slice(0, 8)])).toBeNull();
  });

  it('frames a track in the free part of the map', () => {
    const view = frameView(
      [
        [-1, -1],
        [1, 1],
      ],
      400,
      400,
      { top: 100, side: 20, bottom: 20 },
    );
    expect(view.lon).toBeCloseTo(0, 6);
    // The larger top padding moves the track down: the center is north of it.
    expect(view.lat).toBeGreaterThan(0);
    expect(view.zoom).toBeGreaterThan(4);
    expect(view.zoom).toBeLessThan(8);
  });
});
