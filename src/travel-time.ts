import type { DistanceUnits } from './units';
import { PREFERENCE, readPreference, writePreference } from './preferences';
/** First-use average speed; afterwards the traveler's own value is kept. */
export const DEFAULT_SPEED_KMH = 20;
/** The same default in miles: 20 km/h is 12.4 mph, rounded up. */
export const DEFAULT_SPEED_MPH = 13;
export function speedInputBounds(units: DistanceUnits = 'metric'): {
  min: number;
  max: number;
} {
  return { min: 1, max: units === 'imperial' ? 75 : 120 };
}
/**
 * The speeds the slider offers, fine where most travel happens and coarser
 * above: km/h 1–40 by 1, then by 5 to 80 and by 10 to 120; mph 1–25 by 1,
 * then by 5 to 75.
 */
export function speedNotches(units: DistanceUnits = 'metric'): number[] {
  const range = (from: number, to: number, step: number) =>
    Array.from(
      { length: Math.floor((to - from) / step) + 1 },
      (_, i) => from + i * step,
    );
  return units === 'imperial'
    ? [...range(1, 25, 1), ...range(30, 75, 5)]
    : [...range(1, 40, 1), ...range(45, 80, 5), ...range(90, 120, 10)];
}
/** The notch nearest to a speed in the given units. */
export function snapSpeed(
  value: number,
  units: DistanceUnits = 'metric',
): number {
  return speedNotches(units).reduce((best, notch) =>
    Math.abs(notch - value) < Math.abs(best - value) ? notch : best,
  );
}
function defaultSpeedKmh(units: DistanceUnits = 'metric'): number {
  return units === 'imperial'
    ? speedToKmh(DEFAULT_SPEED_MPH, 'imperial')
    : DEFAULT_SPEED_KMH;
}
/**
 * The speed in km/h after the distance units change: the default of one
 * system becomes the other's, any other speed its nearest notch.
 */
export function convertSpeedUnits(
  speedKmh: number,
  from: DistanceUnits,
  to: DistanceUnits,
): number {
  if (from === to) return speedKmh;
  if (Math.abs(speedKmh - defaultSpeedKmh(from)) < 1e-6)
    return defaultSpeedKmh(to);
  return speedToKmh(snapSpeed(speedFromKmh(speedKmh, to), to), to);
}
export function speedToKmh(
  speed: number,
  units: DistanceUnits = 'metric',
): number {
  return units === 'imperial' ? speed * 1.609344 : speed;
}
export function speedFromKmh(
  speed: number,
  units: DistanceUnits = 'metric',
): number {
  return units === 'imperial' ? speed / 1.609344 : speed;
}
export function travelTimeSeconds(
  distanceMeters: number,
  speedKmh: number,
): number {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    !Number.isFinite(speedKmh) ||
    speedKmh <= 0
  )
    throw new RangeError(
      'Distance and average speed must be valid positive numbers.',
    );
  return distanceMeters / (speedKmh / 3.6);
}
/**
 * The average speed is a device preference: time, arrival, weather and
 * daylight all use it, and only the user changes it. Links, saved routes and
 * backups do not carry it. A stored speed above the slider's top (from
 * before it was lowered) becomes the top; a missing or invalid one, the
 * default of the units in use.
 */
export function storedSpeedKmh(units: DistanceUnits = 'metric'): number {
  const stored = readPreference(PREFERENCE.averageSpeed);
  const value = stored === null || stored === '' ? NaN : Number(stored);
  if (Number.isFinite(value) && value > 0) {
    const top = speedToKmh(speedInputBounds(units).max, units),
      bottom = speedToKmh(1, units);
    return Math.max(bottom, Math.min(top, value));
  }
  return defaultSpeedKmh(units);
}
export function rememberSpeedKmh(speedKmh: number): void {
  writePreference(PREFERENCE.averageSpeed, String(speedKmh));
}
