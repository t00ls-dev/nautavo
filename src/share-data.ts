import type { Climb } from './climbs';
import { meters, type Coord } from './core';
import type { IconName } from './icons';

/**
 * What the share image (#45) says about a route, from data the page already
 * has: the weather samples at their passage times and the climbs of the
 * loaded profile. Pure; no DOM, storage or network.
 */

/** One weather sample as the planner's Weather shows it. */
export interface ShareWeather {
  /** Passage time, ms since the epoch. */
  time: number;
  /** Along-track meters. */
  distance: number;
  temperature: number | null;
  icon: IconName;
  /** `windRelation`'s text: Headwind, Tailwind, Crosswind, Calm wind... */
  relation: string;
  /** Mean wind, km/h. */
  wind: number | null;
  /** Rain, drizzle or a thunderstorm is likely within the passage window. */
  rain: boolean;
}

/** A headwind weaker than this is not worth a word on the image, km/h. */
const SHARE_HEADWIND_KMH = 15;
/** Samples the image's weather strip shows at most. */
const STRIP_SAMPLES = 4;
/** Climbs the image's profile labels at most. */
const SHARE_CLIMBS = 2;

/**
 * Indices of the samples the strip shows: the first, the last and the ones
 * closest to an even spread in time between them, without repeats.
 */
export function stripIndices(times: number[], count = STRIP_SAMPLES): number[] {
  if (times.length <= count) return times.map((_, i) => i);
  const first = times[0],
    last = times.at(-1)!;
  const picked = new Set<number>([0, times.length - 1]);
  for (let k = 1; k < count - 1; k++) {
    const target = first + ((last - first) * k) / (count - 1);
    let best = -1;
    times.forEach((time, i) => {
      if (picked.has(i)) return;
      if (best < 0 || Math.abs(time - target) < Math.abs(times[best] - target))
        best = i;
    });
    if (best >= 0) picked.add(best);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * The weather in one line, as English source parts the interface translates:
 * the temperature range, whether rain is likely and when, and the first
 * headwind worth naming. Empty when no sample is known.
 */
export function weatherSummary(
  samples: ShareWeather[],
  temperature: (celsius: number) => string,
  clock: (time: number) => string,
): string[] {
  if (!samples.length) return [];
  const parts: string[] = [];
  const known = samples
    .map((s) => s.temperature)
    .filter((v): v is number => v !== null);
  if (known.length) {
    const low = Math.min(...known),
      high = Math.max(...known);
    const top = temperature(high);
    const bottom = temperature(low);
    // "18–27 °C": the number of the lowest, the label of the highest.
    parts.push(bottom === top ? top : `${bottom.split(/\s/)[0]}–${top}`);
  }
  const rainy = samples.find((s) => s.rain);
  parts.push(
    rainy ? `rain possible around ${clock(rainy.time)}` : 'no rain expected',
  );
  const headwind = samples.find(
    (s) =>
      s.relation === 'Headwind' &&
      s.wind !== null &&
      s.wind >= SHARE_HEADWIND_KMH,
  );
  if (headwind) parts.push(`headwind around ${clock(headwind.time)}`);
  return parts;
}

/**
 * The climbs the image labels: the hardest ones Elevation lists, in route
 * order (its length and average grade, which a tunnel or bridge distorts
 * less than the steepest grade).
 */
export function shareClimbs(climbs: Climb[], count = SHARE_CLIMBS): Climb[] {
  return [...climbs]
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.start - b.start);
}

/** Track hidden at each end of the image when the start and end are hidden, meters. */
export const HIDDEN_ENDS = 500;

/**
 * The track without its first and last `length` meters along the whole
 * route (often a home), keeping the segments in between; null when nothing
 * would be left.
 */
export function trimEnds(
  segments: Coord[][],
  length = HIDDEN_ENDS,
): Coord[][] | null {
  const lengths = segments.map((segment) =>
    segment.slice(1).reduce((sum, c, i) => sum + meters(segment[i], c), 0),
  );
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 2 * length) return null;
  const out: Coord[][] = [];
  let walked = 0;
  for (const segment of segments) {
    const kept: Coord[] = [];
    for (let i = 0; i < segment.length; i++) {
      if (i) walked += meters(segment[i - 1], segment[i]);
      if (walked >= length && walked <= total - length) kept.push(segment[i]);
    }
    if (kept.length > 1) out.push(kept);
  }
  return out.length ? out : null;
}
