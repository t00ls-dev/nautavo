import { WEAK_ACCURACY } from './navigation';
import { speedInputBounds, speedToKmh } from './travel-time';
import type { DistanceUnits } from './units';

/**
 * Speed while navigating (#32, #136): the current speed for the badge, and
 * the trip's average with stops, which the arrival estimate follows once the
 * trip has lasted a while. Computed on the device from the fixes the
 * navigation already receives; nothing is stored or sent.
 */

export interface SpeedFix {
  /** ms since the epoch. */
  time: number;
  /** Along-track distance on the planned route, meters. */
  progress: number;
  /** The device's speed, or one measured between fixes, m/s; null if none. */
  speed: number | null;
  accuracy: number;
  /** Moving, with hysteresis (`isMoving`); stopped shows 0. */
  moving: boolean;
}

/** Seconds over which the current speed is smoothed. */
const CURRENT_SMOOTHING = 3;
/** The trip average counts only after this long and this far. */
const AVERAGE_AFTER_MS = 30_000;
const AVERAGE_AFTER_M = 50;
/** The arrival estimate follows the trip average fully after this long. */
export const ARRIVAL_BLEND_MS = 10 * 60_000;

export function createSpeedMeter() {
  let current: number | null = null,
    last: number | null = null,
    weak = true,
    start: { time: number; progress: number } | null = null,
    furthest = 0;
  return {
    update(fix: SpeedFix) {
      weak = !(fix.accuracy <= WEAK_ACCURACY);
      if (weak) return;
      // The trip starts with the first movement, so waiting before it
      // does not count; stops after it do.
      if (!start && fix.moving)
        start = { time: fix.time, progress: fix.progress };
      furthest = Math.max(furthest, fix.progress);
      const seconds = last === null ? Infinity : (fix.time - last) / 1000;
      // Stopped reads 0 at once; moving speeds are smoothed.
      if (!fix.moving) current = 0;
      else {
        const target = fix.speed ?? current ?? 0;
        current =
          current === null || !(seconds > 0)
            ? target
            : current +
              (target - current) * (1 - Math.exp(-seconds / CURRENT_SMOOTHING));
      }
      last = fix.time;
    },
    /** Current speed in m/s, or null with a weak signal or no fix yet. */
    current(): number | null {
      return weak ? null : current;
    },
    /** Time since the trip started moving, ms (0 before). */
    elapsed(now: number): number {
      return start ? Math.max(0, now - start.time) : 0;
    },
    /** Distance on the route over time since the start, stops included, m/s. */
    average(now: number): number | null {
      if (!start) return null;
      const time = now - start.time,
        distance = furthest - start.progress;
      if (time < AVERAGE_AFTER_MS || distance < AVERAGE_AFTER_M) return null;
      return distance / (time / 1000);
    },
  };
}

/**
 * The speed the arrival estimate uses: the configured average at first,
 * moving to the trip's own average (stops included) over the first ten
 * minutes, within the slider's range.
 */
export function arrivalSpeedKmh(
  meter: ReturnType<typeof createSpeedMeter>,
  now: number,
  configuredKmh: number,
  units: DistanceUnits,
): number {
  const average = meter.average(now);
  if (average === null) return configuredKmh;
  const weight = Math.min(1, meter.elapsed(now) / ARRIVAL_BLEND_MS);
  const blended = configuredKmh + (average * 3.6 - configuredKmh) * weight;
  const { min, max } = speedInputBounds(units);
  return Math.max(
    speedToKmh(min, units),
    Math.min(speedToKmh(max, units), blended),
  );
}
