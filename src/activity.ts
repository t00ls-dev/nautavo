import {
  CHANNELS,
  meters,
  type Channel,
  type Coord,
  type ParsedTrack,
} from './core';
import {
  cumulativeClimb,
  elevationStats,
  GRADE_WINDOW,
  profileFromTrack,
  smoothProfile,
  type ProfilePoint,
} from './elevation';

/**
 * A recorded activity (#156): the track a file recorded with its times and
 * sensor values, its stops and its statistics. Built from a file already
 * read, in page memory only; nothing here is stored or sent. Pure; no DOM or
 * network.
 */

/** A time the recording stood still or was paused, ms since the epoch. */
export interface Stop {
  from: number;
  to: number;
}
interface ChannelStats {
  average: number;
  max: number;
}
/** What the replay shows at a moment: sensor channels, altitude and climb so far. */
export type ActivityValue = Channel | 'altitude' | 'climb' | 'grade';
/** The moment a value was at its highest, announced as the replay passes it. */
export interface Peak {
  kind: 'speed' | 'hr' | 'cadence' | 'power' | 'altitude';
  time: number;
  value: number;
}
export interface Activity {
  /** The file's name for the activity, or empty. */
  name: string;
  /** The recorded track, in GPX segments, as the replay follows it. */
  segments: Coord[][];
  /** Per recorded point, flat across segments: time, ms since the epoch. */
  times: number[];
  /** Per recorded point: along-track meters, segment gaps excluded. */
  distances: number[];
  /** Per recorded point, for the channels the recording carries. */
  values: Partial<Record<Channel, (number | null)[]>>;
  /** Per recorded point: speed over the last 5 s, m/s (0 while stopped). */
  speeds: number[];
  /** Per recorded point, smoothed, when most points record elevation. */
  altitude: (number | null)[] | null;
  /** Per recorded point: meters climbed so far, with `altitude`. */
  ascent: number[] | null;
  /** Per recorded point: grade over the last 100 m, %, with `altitude`. */
  grade: (number | null)[] | null;
  /** The highest speed, heart rate, cadence, power and point. */
  peaks: Peak[];
  stops: Stop[];
  start: number;
  end: number;
  /** Meters. */
  distance: number;
  /** Milliseconds, stops excluded. */
  moving: number;
  /** Meters per second over the moving time. */
  averageSpeed: number;
  /** Meters per second, the fastest 5 s. */
  maxSpeed: number;
  /** Averages and maxima of the channels present, speed excluded. */
  channels: Partial<Record<Exclude<Channel, 'speed'>, ChannelStats>>;
  /** From the recorded elevation, when most points have one. */
  climb: { ascent: number; descent: number } | null;
}

/** Share of points that must have a time for the file to be an activity. */
const TIMED_SHARE = 0.8,
  /** Share of points that must have a value for a channel to be shown. */
  CHANNEL_SHARE = 0.5,
  /** Shortest recording that counts as an activity, ms. */
  MIN_DURATION = 60_000,
  /**
   * A gap between two recorded points longer than this, covering less than
   * `PAUSE_SPEED`, is a pause (auto-pause, a stopped timer), ms. Smart
   * recording spaces points while moving, so a long gap alone is not one.
   */
  PAUSE_GAP = 10_000,
  /** Meters per second. */
  PAUSE_SPEED = 1,
  /** Moving less than this over `STILL_TIME` is standing still, meters. */
  STILL_DISTANCE = 5,
  STILL_TIME = 30_000,
  /** Window of the maximum speed, ms. */
  MAX_SPEED_WINDOW = 5_000;
/** The replay skips stops at least this long, ms. */
const SKIPPED_STOP = 60_000;

/**
 * The activity a file recorded, or null when it is not one: fewer than 80 %
 * of its points have a time, or it lasts under a minute. Points without a
 * time, or not later than the one before, are left out.
 */
export function activityOf(parsed: ParsedTrack): Activity | null {
  const total = parsed.segments.reduce((n, s) => n + s.length, 0);
  const segments: Coord[][] = [],
    elevations: (number | null)[][] = [],
    times: number[] = [],
    distances: number[] = [];
  const raw = Object.fromEntries(
    CHANNELS.map((c) => [c, []]),
  ) as unknown as Record<Channel, (number | null)[]>;
  let distance = 0,
    last = -Infinity;
  parsed.segments.forEach((segment, s) => {
    const coords: Coord[] = [],
      eles: (number | null)[] = [],
      kept: { time: number; values: Partial<Record<Channel, number>> }[] = [];
    segment.forEach((coord, i) => {
      const recorded = parsed.recorded[s]?.[i];
      const time = recorded?.time;
      if (time === null || time === undefined || time <= last) return;
      last = time;
      coords.push(coord);
      eles.push(parsed.elevations[s]?.[i] ?? null);
      kept.push({ time, values: recorded.values });
    });
    if (coords.length < 2) return;
    coords.forEach((coord, i) => {
      if (i) distance += meters(coords[i - 1], coord);
      distances.push(distance);
      times.push(kept[i].time);
      for (const channel of CHANNELS)
        raw[channel].push(kept[i].values[channel] ?? null);
    });
    segments.push(coords);
    elevations.push(eles);
  });
  if (
    times.length < 2 ||
    times.length < TIMED_SHARE * total ||
    times.at(-1)! - times[0] < MIN_DURATION
  )
    return null;

  const values: Activity['values'] = {};
  for (const channel of CHANNELS) {
    const present = raw[channel].filter((v) => v !== null).length;
    if (present >= CHANNEL_SHARE * times.length) values[channel] = raw[channel];
  }
  const stops = findStops(times, distances);
  const start = times[0],
    end = times.at(-1)!;
  const stopped = stops.reduce((n, stop) => n + stop.to - stop.from, 0);
  const moving = Math.max(1, end - start - stopped);

  const channels: Activity['channels'] = {};
  for (const channel of [
    'hr',
    'cadence',
    'power',
    'balance',
    'temperature',
  ] as const) {
    const series = values[channel];
    if (series) channels[channel] = channelStats(series, times, stops, channel);
  }
  const flatElevations = elevations.flat();
  const withElevation = flatElevations.filter((e) => e !== null).length;
  const profile =
    withElevation >= TIMED_SHARE * times.length
      ? smoothProfile(profileFromTrack(segments, elevations), 'recorded')
      : [];
  const stats = elevationStats(profile, 'recorded');
  // The profile keeps the points with an elevation, in order: back to points.
  let altitude: (number | null)[] | null = null,
    ascent: number[] | null = null;
  if (profile.length) {
    const climbs = cumulativeClimb(profile, 'recorded');
    altitude = [];
    ascent = [];
    let k = 0;
    for (const ele of flatElevations) {
      if (ele === null) altitude.push(null);
      else altitude.push(profile[k++].ele);
      ascent.push(k ? climbs[k - 1].ascent : 0);
    }
  }
  const speeds = speedSeries(times, distances, values.speed, stops);
  const grade = altitude && gradeSeries(distances, altitude);
  return {
    name: parsed.name.trim().slice(0, 160),
    segments,
    times,
    distances,
    values,
    speeds,
    altitude,
    ascent,
    grade,
    peaks: peaksOf(times, speeds, values, altitude),
    stops,
    start,
    end,
    distance,
    moving,
    averageSpeed: distance / (moving / 1000),
    maxSpeed: Math.max(0, ...speeds),
    channels,
    climb: stats ? { ascent: stats.ascent, descent: stats.descent } : null,
  };
}

/**
 * Pauses and stretches standing still: a gap of more than 10 s between
 * recorded points covered at under 1 m/s (auto-pause, a stopped timer), or
 * under 5 m covered in 30 s or more. Overlapping ones merge.
 */
function findStops(times: number[], distances: number[]): Stop[] {
  const found: Stop[] = [];
  for (let i = 1; i < times.length; i++) {
    const span = times[i] - times[i - 1];
    if (
      span > PAUSE_GAP &&
      (distances[i] - distances[i - 1]) / (span / 1000) < PAUSE_SPEED
    )
      found.push({ from: times[i - 1], to: times[i] });
  }
  // Two pointers: `j` is the last point within STILL_DISTANCE of point `i`.
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    j = Math.max(j, i);
    while (
      j + 1 < times.length &&
      distances[j + 1] - distances[i] < STILL_DISTANCE
    )
      j++;
    if (times[j] - times[i] >= STILL_TIME) {
      found.push({ from: times[i], to: times[j] });
      i = j;
    }
  }
  found.sort((a, b) => a.from - b.from);
  const merged: Stop[] = [];
  for (const stop of found) {
    const previous = merged.at(-1);
    if (previous && stop.from <= previous.to)
      previous.to = Math.max(previous.to, stop.to);
    else merged.push({ ...stop });
  }
  return merged;
}

const insideStop = (time: number, stops: Stop[]) =>
  stops.some((stop) => time >= stop.from && time < stop.to);

/**
 * Time-weighted average and maximum, stops excluded. Cadence leaves out
 * zeros (coasting), as bike computers show it.
 */
function channelStats(
  series: (number | null)[],
  times: number[],
  stops: Stop[],
  channel: Channel,
): ChannelStats {
  let weighted = 0,
    weight = 0,
    max = -Infinity;
  series.forEach((value, i) => {
    if (value === null || (channel === 'cadence' && value === 0)) return;
    max = Math.max(max, value);
    const next = times[i + 1] ?? times[i];
    const span = Math.min(next - times[i], PAUSE_GAP);
    if (span <= 0 || insideStop(times[i], stops)) return;
    weighted += value * span;
    weight += span;
  });
  return {
    average: weight ? weighted / weight : Math.max(0, max),
    max: Math.max(0, max),
  };
}

/**
 * Speed at each point over the last 5 s: the recorded speed's average when
 * the file has it, otherwise the distance covered; 0 inside a stop and never
 * across a pause.
 */
function speedSeries(
  times: number[],
  distances: number[],
  speed: (number | null)[] | undefined,
  stops: Stop[],
): number[] {
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < times.length; i++) {
    if (i && times[i] - times[i - 1] > PAUSE_GAP) k = i;
    while (k + 1 < i && times[i] - times[k + 1] >= MAX_SPEED_WINDOW) k++;
    if (insideStop(times[i], stops)) {
      out.push(0);
      continue;
    }
    if (speed) {
      let sum = 0,
        count = 0;
      for (let n = k; n <= i; n++)
        if (speed[n] !== null) {
          sum += speed[n]!;
          count++;
        }
      out.push(count ? sum / count : 0);
    } else {
      const span = (times[i] - times[k]) / 1000;
      out.push(span > 0 ? (distances[i] - distances[k]) / span : 0);
    }
  }
  return out;
}

/**
 * Grade at each point over the last `GRADE_WINDOW` of recorded elevation
 * (100 m, as the route coloring uses for recorded tracks), in %.
 */
function gradeSeries(
  distances: number[],
  altitude: (number | null)[],
): (number | null)[] {
  const window = GRADE_WINDOW.recorded;
  let k = 0;
  return distances.map((d, i) => {
    while (k < i && d - distances[k + 1] >= window) k++;
    const span = d - distances[k];
    const from = altitude[k],
      to = altitude[i];
    return span >= window / 2 && from !== null && to !== null
      ? ((to - from) / span) * 100
      : null;
  });
}

/** When each value was at its highest (the first time, on a tie). */
function peaksOf(
  times: number[],
  speeds: number[],
  values: Activity['values'],
  altitude: (number | null)[] | null,
): Peak[] {
  const peak = (
    kind: Peak['kind'],
    series: (number | null)[] | null | undefined,
  ) => {
    if (!series) return [];
    let best = -1;
    series.forEach((v, i) => {
      if (v !== null && (best < 0 || v > series[best]!)) best = i;
    });
    return best < 0 || !series[best]
      ? []
      : [{ kind, time: times[best], value: series[best]! }];
  };
  return [
    ...peak('speed', speeds),
    ...peak('hr', values.hr),
    ...peak('cadence', values.cadence),
    ...peak('power', values.power),
    ...peak('altitude', altitude),
  ];
}

/** Index of the last recorded point at or before `time`. */
function pointBefore(activity: Activity, time: number): number {
  const { times } = activity;
  let low = 0,
    high = times.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (times[middle] <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Along-track distance at a recorded time, interpolated between points. */
export function distanceAt(activity: Activity, time: number): number {
  const { times, distances } = activity;
  if (time <= times[0]) return 0;
  if (time >= times.at(-1)!) return distances.at(-1)!;
  const i = pointBefore(activity, time);
  const span = times[i + 1] - times[i];
  const t = span > 0 ? (time - times[i]) / span : 0;
  return distances[i] + (distances[i + 1] - distances[i]) * t;
}

/**
 * The recorded values at a time: the last point's reading for each channel
 * present (a channel without a reading there shows none), and the speed in
 * m/s (recorded, or from the distance over the last 5 s).
 */
export function valuesAt(
  activity: Activity,
  time: number,
): Partial<Record<ActivityValue, number>> {
  const i = pointBefore(activity, time);
  const out: Partial<Record<ActivityValue, number>> = {};
  for (const channel of CHANNELS) {
    const value = activity.values[channel]?.[i];
    if (value !== null && value !== undefined) out[channel] = value;
  }
  out.speed = activity.speeds[i];
  const altitude = activity.altitude?.[i];
  if (altitude !== null && altitude !== undefined) out.altitude = altitude;
  if (activity.ascent) out.climb = activity.ascent[i];
  const grade = activity.grade?.[i];
  if (grade !== null && grade !== undefined) out.grade = grade;
  return out;
}

/**
 * Where a replay goes after `elapsed` ms of play at `rate` × real time from
 * `time`: stops of a minute or more are skipped whole, and reported.
 */
export function activityAdvance(
  activity: Activity,
  time: number,
  elapsed: number,
  rate: number,
): { time: number; skipped: Stop | null } {
  let next = Math.min(activity.end, time + Math.max(0, elapsed) * rate);
  let skipped: Stop | null = null;
  for (const stop of activity.stops)
    if (
      stop.to - stop.from >= SKIPPED_STOP &&
      stop.from < next &&
      stop.to > time
    ) {
      // Stopped on reaching it: continue from where the recording moved on.
      next = Math.max(next, stop.to);
      skipped = stop;
    }
  return { time: Math.min(activity.end, next), skipped };
}

/** The stops the replay skips (a minute or more), in order. */
export const skippedStops = (activity: Activity): Stop[] =>
  activity.stops.filter((stop) => stop.to - stop.from >= SKIPPED_STOP);

/** Replay time of a recorded time: from the start, skipped stops left out. */
export function playedAt(activity: Activity, time: number): number {
  let played = Math.max(0, Math.min(activity.end, time) - activity.start);
  for (const stop of skippedStops(activity))
    if (time > stop.from) played -= Math.min(time, stop.to) - stop.from;
  return Math.max(0, played);
}
/** The replay's length: the recording with its skipped stops left out. */
export const playedLength = (activity: Activity): number =>
  playedAt(activity, activity.end);
/**
 * The recorded time at a replay time (`playedAt` reversed): a time that
 * falls on a skipped stop is its end, where the recording moved on.
 */
export function timeAtPlayed(activity: Activity, played: number): number {
  let time = activity.start + Math.max(0, played);
  for (const stop of skippedStops(activity))
    if (time >= stop.from) time += stop.to - stop.from;
  return Math.min(activity.end, time);
}

/** Per recorded point: whether the recording was moving there (not in a stop). */
export function movingPoints(activity: Activity): boolean[] {
  let s = 0;
  return activity.times.map((time) => {
    const { stops } = activity;
    while (s < stops.length && stops[s].to <= time) s++;
    return !(s < stops.length && time >= stops[s].from && time < stops[s].to);
  });
}

/**
 * The recorded points that start a GPX segment after the first: nothing is
 * drawn or measured across the gap before them.
 */
export function segmentStarts(activity: Activity): Set<number> {
  const starts = new Set<number>();
  let n = 0;
  for (const segment of activity.segments) {
    if (n) starts.add(n);
    n += segment.length;
  }
  return starts;
}

/** The elevation profile of the recorded altitude, for the Grade coloring. */
export function activityProfile(activity: Activity): ProfilePoint[] {
  if (!activity.altitude) return [];
  const starts = segmentStarts(activity);
  const out: ProfilePoint[] = [];
  let gap = false;
  activity.altitude.forEach((ele, i) => {
    if (starts.has(i)) gap = true;
    if (ele === null) return;
    out.push(
      gap
        ? { at: activity.distances[i], ele, gap }
        : { at: activity.distances[i], ele },
    );
    gap = false;
  });
  return out;
}

/** Classes of a zone coloring: five, from lowest to highest. */
export const ZONES = [
  'zone-1',
  'zone-2',
  'zone-3',
  'zone-4',
  'zone-5',
] as const;
/** Share of moving readings left out below and above the zone scale. */
const ZONE_TAIL = 0.05;

/**
 * Limits between the five zones of a series, relative to the activity
 * itself: evenly spaced between its 5th and 95th percentiles over the moving
 * points, rounded to whole units, or to tenths where whole units would
 * merge zones (a slow walk), so the legend reads what is drawn. Null when
 * the series has no spread to color.
 */
export function zoneLimits(
  series: (number | null)[],
  moving: boolean[],
): number[] | null {
  const sorted = series
    .filter((v, i): v is number => v !== null && moving[i])
    .sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  const low = at(ZONE_TAIL),
    high = at(1 - ZONE_TAIL);
  const increasing = (limits: number[]) =>
    limits.every((limit, i) => !i || limit > limits[i - 1]);
  for (const step of [1, 0.1]) {
    const limits = [1, 2, 3, 4].map(
      (k) => Math.round((low + ((high - low) * k) / 5) / step) * step,
    );
    if (increasing(limits)) return limits.map((v) => Number(v.toFixed(1)));
  }
  return null;
}

/** Along-track ranges of each zone; points without a reading are left out. */
export function zoneRanges(
  activity: Activity,
  series: (number | null)[],
  limits: number[],
): { from: number; to: number; kind: string }[] {
  const out: { from: number; to: number; kind: string }[] = [];
  const { distances } = activity;
  for (let i = 0; i + 1 < distances.length; i++) {
    const value = series[i];
    const from = distances[i],
      to = distances[i + 1];
    if (value === null || to <= from) continue;
    const kind = ZONES[limits.filter((limit) => value >= limit).length];
    const previous = out.at(-1);
    if (previous && previous.kind === kind && previous.to === from)
      previous.to = to;
    else out.push({ from, to, kind });
  }
  return out;
}

/**
 * A series averaged over the last `window` ms at each point (power is too
 * noisy to color point by point); never across a pause.
 */
export function smoothedSeries(
  activity: Activity,
  series: (number | null)[],
  window: number,
): (number | null)[] {
  const { times } = activity;
  let k = 0;
  return series.map((value, i) => {
    if (i && times[i] - times[i - 1] > PAUSE_GAP) k = i;
    while (k < i && times[i] - times[k] > window) k++;
    let sum = 0,
      count = 0;
    for (let n = k; n <= i; n++)
      if (series[n] !== null) {
        sum += series[n]!;
        count++;
      }
    return value === null && !count ? null : count ? sum / count : null;
  });
}
