import { speedFromKmh } from './travel-time';

export type DistanceUnits = 'metric' | 'imperial';
/**
 * A number and its unit joined by a no-break space, so a line never ends
 * between them ("1,308 m", not "1,308" with the "m" alone below).
 */
export const withUnit = (value: string | number, unit: string) =>
  `${value}\u00a0${unit}`;
export type TemperatureUnits = 'celsius' | 'fahrenheit';
export function distanceLabel(
  meters: number,
  units: DistanceUnits = 'metric',
  locale = 'en',
  precision = 1,
): string {
  const value = units === 'imperial' ? meters / 1609.344 : meters / 1000;
  return withUnit(
    value.toLocaleString(locale, {
      minimumFractionDigits: precision === 2 ? 2 : 0,
      maximumFractionDigits: precision,
    }),
    units === 'imperial' ? 'mi' : 'km',
  );
}
/** A recorded speed in km/h or mph with one decimal: 41.2 km/h. */
export function speedLabel(
  metersPerSecond: number,
  units: DistanceUnits = 'metric',
  locale = 'en',
): string {
  return withUnit(
    speedFromKmh(metersPerSecond * 3.6, units).toLocaleString(locale, {
      maximumFractionDigits: 1,
    }),
    units === 'imperial' ? 'mph' : 'km/h',
  );
}
/** Compact step length: meters (or feet) for short steps, one decimal otherwise. */
export function stepDistanceLabel(
  meters: number,
  units: DistanceUnits = 'metric',
  locale = 'en',
): string {
  if (units === 'imperial') {
    const feet = meters * 3.280839895;
    if (feet < 1000)
      return withUnit(Math.max(10, Math.round(feet / 10) * 10), 'ft');
  } else if (meters < 1000)
    return withUnit(Math.max(10, Math.round(meters / 10) * 10), 'm');
  return distanceLabel(meters, units, locale, 1);
}
/** Position along the route, unit first like a road marker: "km 12.3", "mi 7.6". */
export function milepostLabel(
  meters: number,
  units: DistanceUnits = 'metric',
  locale = 'en',
): string {
  const value = units === 'imperial' ? meters / 1609.344 : meters / 1000;
  // Unit first, so the no-break space goes before the number.
  return `${units === 'imperial' ? 'mi' : 'km'}\u00a0${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}
export function shortDistanceLabel(
  meters: number,
  units: DistanceUnits = 'metric',
): string {
  return withUnit(
    Math.round(units === 'imperial' ? meters * 3.280839895 : meters),
    units === 'imperial' ? 'ft' : 'm',
  );
}
/** Altitude in meters or feet, rounded to whole units. */
export function elevationLabel(
  meters: number,
  units: DistanceUnits = 'metric',
  locale = 'en',
): string {
  const value = Math.round(
    units === 'imperial' ? meters * 3.280839895 : meters,
  );
  return withUnit(
    value.toLocaleString(locale),
    units === 'imperial' ? 'ft' : 'm',
  );
}
/** Shown in place of a value that is not known (a plain hyphen, docs/BRAND.md). */
export const MISSING = '-';
/** Weather temperature from °C, at most one decimal; `MISSING` when unknown. */
export function temperatureLabel(
  celsius: number | null,
  units: TemperatureUnits = 'celsius',
  locale = 'en',
): string {
  if (celsius === null)
    return withUnit(MISSING, units === 'fahrenheit' ? '°F' : '°C');
  const value = units === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius;
  return withUnit(
    value.toLocaleString(locale, { maximumFractionDigits: 1 }),
    units === 'fahrenheit' ? '°F' : '°C',
  );
}
/**
 * Precipitation from mm, in inches with the Fahrenheit choice (as weather
 * reports there do): at most one decimal in mm, two in inches.
 */
export function precipitationLabel(
  mm: number | null,
  units: TemperatureUnits = 'celsius',
  locale = 'en',
): string {
  const unit = units === 'fahrenheit' ? 'in' : 'mm';
  if (mm === null) return withUnit(MISSING, unit);
  const value = units === 'fahrenheit' ? mm / 25.4 : mm;
  return withUnit(
    value.toLocaleString(locale, {
      maximumFractionDigits: units === 'fahrenheit' ? 2 : 1,
    }),
    unit,
  );
}
/**
 * A duration as the summary and navigation write it: "18 min", "1h 48 min".
 * A line may break between the hours and the minutes, never inside "48 min".
 */
export function durationLabel(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return minutes < 60
    ? withUnit(minutes, 'min')
    : `${Math.floor(minutes / 60)}h ${withUnit(minutes % 60, 'min')}`;
}
