import { describe, expect, it } from 'vitest';
import { importTrackFile, readTrackFile } from '../src/core';
import {
  activityAdvance,
  activityOf,
  activityProfile,
  distanceAt,
  movingPoints,
  smoothedSeries,
  zoneLimits,
  zoneRanges,
  playedAt,
  playedLength,
  timeAtPlayed,
  valuesAt,
  type Activity,
} from '../src/activity';
import { Fit, le, semi, type Field } from './fit-fixture';
import {
  ACTIVITY_START,
  activityGpx,
  iso,
  ride,
  type Sample,
} from './activity-fixture';
import { at } from './local-frame';

const bytes = (s: string) => new TextEncoder().encode(s);
const START = ACTIVITY_START;
const gpx = (samples: Sample[], options?: { times?: boolean }) =>
  bytes(activityGpx(samples, options));
const open = (file: Uint8Array): Activity => {
  const activity = activityOf(readTrackFile(file));
  if (!activity) throw new Error('not an activity');
  return activity;
};

describe('activity from a recording (#156)', () => {
  it('reads times and GPX TrackPointExtension values', () => {
    const activity = open(gpx(ride()));
    expect(activity.name).toBe('Morning ride');
    expect(activity.start).toBe(START);
    expect(activity.end).toBe(START + 320_000);
    expect(activity.distance).toBeCloseTo(20 * 50, -1);
    expect(Object.keys(activity.values).sort()).toEqual(
      ['cadence', 'hr', 'power', 'temperature'].sort(),
    );
  });

  it('finds the pause, the moving time and the speeds', () => {
    const activity = open(gpx(ride()));
    expect(activity.stops).toEqual([
      { from: START + 100_000, to: START + 230_000 },
    ]);
    expect(activity.moving).toBe(190_000);
    // 1000 m in 190 s of moving.
    expect(activity.averageSpeed).toBeCloseTo(1000 / 190, 1);
    expect(activity.maxSpeed).toBeCloseTo(5, 0);
  });

  it('averages channels over moving time; cadence leaves out coasting', () => {
    const { channels } = open(gpx(ride()));
    expect(channels.hr!.max).toBe(140);
    expect(channels.cadence!.average).toBe(80);
    expect(channels.power!.average).toBeGreaterThan(100);
    expect(channels.power!.average).toBeLessThan(200);
    expect(channels.temperature!.max).toBe(27);
  });

  it('gives the place and the values at a recorded time', () => {
    const activity = open(gpx(ride()));
    expect(distanceAt(activity, START + 25_000)).toBeCloseTo(125, -1);
    // Inside the pause: between where it stopped and where it went on.
    const paused = distanceAt(activity, START + 150_000);
    expect(paused).toBeGreaterThan(495);
    expect(paused).toBeLessThan(555);
    const values = valuesAt(activity, START + 25_000);
    expect(values.hr).toBe(122);
    expect(values.speed).toBeCloseTo(5, 0);
    expect(valuesAt(activity, START + 150_000).speed).toBe(0);
  });

  it('gives the grade over the last 100 m', () => {
    // 1 m up every 50 m: 2 %.
    const activity = open(gpx(ride()));
    expect(valuesAt(activity, START + 80_000).grade).toBeCloseTo(2, 0);
  });

  it('gives altitude, climb so far and the highest values', () => {
    const activity = open(gpx(ride()));
    // The ride gains 1 m a step: 20 m up to 30 m.
    expect(valuesAt(activity, START).altitude).toBe(10);
    expect(valuesAt(activity, activity.end).altitude).toBe(30);
    expect(valuesAt(activity, activity.end).climb).toBeCloseTo(20, 0);
    expect(activity.peaks.find((p) => p.kind === 'hr')).toEqual({
      kind: 'hr',
      time: START + 230_000,
      value: 140,
    });
    expect(activity.peaks.find((p) => p.kind === 'altitude')!.value).toBe(30);
    expect(activity.peaks.find((p) => p.kind === 'speed')!.value).toBeCloseTo(
      5,
      0,
    );
  });

  it('skips a stop of a minute or more in the replay, and maps the slider', () => {
    const activity = open(gpx(ride()));
    const step = activityAdvance(activity, START + 95_000, 1000, 10);
    expect(step.skipped).toEqual(activity.stops[0]);
    expect(step.time).toBe(START + 230_000);
    expect(playedLength(activity)).toBe(190_000);
    expect(playedAt(activity, START + 230_000)).toBe(100_000);
    expect(timeAtPlayed(activity, 100_000)).toBe(START + 230_000);
    expect(timeAtPlayed(activity, 50_000)).toBe(START + 50_000);
  });

  it('keeps spaced points while moving: smart recording is not a pause', () => {
    // 30 s between points, 150 m each: moving at 5 m/s.
    const samples: Sample[] = Array.from({ length: 6 }, (_, i) => ({
      t: i * 30,
      at: i * 3,
    }));
    const activity = open(gpx(samples));
    expect(activity.stops).toEqual([]);
    expect(activity.moving).toBe(150_000);
  });

  it('is not an activity without times, or when too short', () => {
    expect(activityOf(readTrackFile(gpx(ride(), { times: false })))).toBeNull();
    const short = ride().slice(0, 4);
    expect(activityOf(readTrackFile(gpx(short)))).toBeNull();
  });

  it('drops impossible sensor values and channels with too few readings', () => {
    const samples = ride().map(({ power, ...s }, i) => ({
      ...s,
      hr: 255,
      ...(i < 3 ? { power } : {}),
    }));
    const activity = open(gpx(samples));
    expect(activity.values.hr).toBeUndefined();
    expect(activity.values.power).toBeUndefined();
  });

  it('reads TCX times, heart rate, cadence, speed and watts', () => {
    const points = ride()
      .map(
        (s) =>
          `<Trackpoint><Time>${iso(s.t)}</Time><Position><LatitudeDegrees>${at(s.at * 50, 0)[0]}</LatitudeDegrees><LongitudeDegrees>${at(s.at * 50, 0)[1]}</LongitudeDegrees></Position><HeartRateBpm><Value>${s.hr}</Value></HeartRateBpm><Cadence>${s.cad}</Cadence><Extensions><TPX><Speed>5</Speed><Watts>${s.power}</Watts></TPX></Extensions></Trackpoint>`,
      )
      .join('');
    const activity = open(
      bytes(
        `<TrainingCenterDatabase><Activities><Activity><Lap><Track>${points}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`,
      ),
    );
    expect(Object.keys(activity.values).sort()).toEqual(
      ['cadence', 'hr', 'power', 'speed'].sort(),
    );
    expect(valuesAt(activity, START + 20_000).hr).toBe(122);
    expect(activity.maxSpeed).toBe(5);
  });

  it('reads FIT timestamps, compressed ones included, and record values', () => {
    const fitStart = (START - Date.UTC(1989, 11, 31)) / 1000;
    // Full records: timestamp, position, heart rate, cadence, speed, temperature.
    const full: Field[] = [
      [253, 4, 0x86],
      [0, 4, 0x85],
      [1, 4, 0x85],
      [3, 1, 0x02],
      [4, 1, 0x02],
      [6, 2, 0x84],
      [13, 1, 0x01],
      [30, 1, 0x02],
    ];
    // Compressed-timestamp records carry the rest without field 253.
    const compressed: Field[] = full.slice(1);
    const fit = new Fit().define(0, 20, full).define(1, 20, compressed);
    const values = (i: number) => [
      le(semi(at(i * 50, 0)[0]), 4),
      le(semi(at(i * 50, 0)[1]), 4),
      [130 + i],
      [85],
      le(5000, 2),
      [i % 2 ? -3 & 0xff : 22],
      // Left/right balance: bit 7 marks the right leg's share, 52 %.
      [0x80 | 52],
    ];
    fit.data(0, le(fitStart, 4), ...values(0));
    // Then a point every 10 s: the low 5 bits of the time in the header.
    for (let i = 1; i <= 12; i++) {
      const time = fitStart + i * 10;
      fit.data(0x80 | (1 << 5) | (time & 0x1f), ...values(i));
    }
    const activity = open(fit.file());
    expect(activity.times).toHaveLength(13);
    expect(activity.end - activity.start).toBe(120_000);
    expect(valuesAt(activity, START + 30_000)).toMatchObject({
      hr: 133,
      cadence: 85,
      speed: 5,
      temperature: -3,
      balance: 48,
    });
  });

  it('leaves the route import as it was: no times or sensor values kept', () => {
    const imported = importTrackFile(gpx(ride()));
    expect(imported.route.provider).toBe('Imported GPX');
    expect(JSON.stringify(imported)).not.toMatch(/"(time|hr|cadence)"/);
  });
});

describe('activity charts and colorings (#156)', () => {
  it('marks the points inside a stop as not moving', () => {
    const activity = open(gpx(ride()));
    const moving = movingPoints(activity);
    // Points 0-9 move; 10 starts the pause (100 s to 230 s); 11 is after it.
    expect(moving.slice(0, 10).every(Boolean)).toBe(true);
    expect(moving[10]).toBe(false);
    expect(moving.slice(11).every(Boolean)).toBe(true);
  });

  it('builds the profile of the recorded altitude by distance', () => {
    const activity = open(gpx(ride()));
    const profile = activityProfile(activity);
    expect(profile).toHaveLength(activity.times.length);
    expect(profile[0].at).toBe(0);
    expect(profile.at(-1)!.at).toBeCloseTo(activity.distance, 6);
    expect(profile.some((p) => p.gap)).toBe(false);
  });

  it('spaces five zones evenly inside the activity, rounded', () => {
    const series = Array.from({ length: 101 }, (_, i) => 100 + i);
    const moving = series.map(() => true);
    // 5th and 95th percentiles: 105 and 195; limits every 18.
    expect(zoneLimits(series, moving)).toEqual([123, 141, 159, 177]);
  });

  it('leaves stops and missing readings out of the zones', () => {
    const series = [10, null, 20, 30, 900, 40];
    const moving = [true, true, true, true, false, true];
    const limits = zoneLimits(series, moving)!;
    expect(limits.every((l) => l < 40)).toBe(true);
  });

  it('has no zones without a spread to color', () => {
    const flat = [140, 140, 140, 140];
    expect(
      zoneLimits(
        flat,
        flat.map(() => true),
      ),
    ).toBeNull();
    expect(zoneLimits([null, null], [true, true])).toBeNull();
  });

  it('keeps tenths where whole units would merge zones (a slow walk)', () => {
    // 3 to 6 km/h: whole units would repeat limits.
    const walk = Array.from({ length: 101 }, (_, i) => 3 + (i * 3) / 100);
    expect(
      zoneLimits(
        walk,
        walk.map(() => true),
      ),
    ).toEqual([3.7, 4.2, 4.8, 5.3]);
  });

  it('colors each stretch by the reading at its start, merged by zone', () => {
    const activity = open(gpx(ride()));
    // Heart rate 120-130 on the way out, 140 after the pause.
    const ranges = zoneRanges(
      activity,
      activity.values.hr!,
      [124, 128, 132, 136],
    );
    expect(ranges[0]).toMatchObject({ from: 0, kind: 'zone-1' });
    expect(ranges.at(-1)!.kind).toBe('zone-5');
    expect(ranges.at(-1)!.to).toBeCloseTo(activity.distance, 6);
    // Consecutive stretches of one zone are one range.
    for (let i = 1; i < ranges.length; i++)
      expect(
        ranges[i].kind === ranges[i - 1].kind &&
          ranges[i].from === ranges[i - 1].to,
      ).toBe(false);
  });

  it('averages a series over a time window, never across a pause', () => {
    const activity = open(gpx(ride()));
    // Power 200 before the pause and 100 after it.
    const smoothed = smoothedSeries(activity, activity.values.power!, 30_000);
    expect(smoothed[5]).toBe(200);
    // Right after the pause, only readings after it count.
    expect(smoothed[11]).toBe(100);
  });
});
