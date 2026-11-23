import {
  movingPoints,
  smoothedSeries,
  ZONES,
  zoneLimits,
  zoneRanges,
  type Activity,
} from './activity';
import type { IconName } from './icons';
import type { Coloring, Range } from './route-overlays';
import { speedFromKmh } from './travel-time';
import { distanceUnits } from './unit-preferences';
import { withUnit } from './units';

/**
 * Route colorings of a recorded activity (#156): speed, heart rate and
 * power in five zones relative to the activity itself (no rider profile is
 * kept), shown in Map layers only while an activity is open. Visual only and
 * from page memory.
 */

/**
 * Speed and power are averaged over this window before they are colored, so
 * the line shows stretches rather than every pedal stroke, ms.
 */
const COLOR_WINDOW = 15_000;

interface ZoneSource {
  id: 'activity-speed' | 'activity-hr' | 'activity-power';
  label: string;
  icon: IconName;
  unit: () => string;
  /** Per recorded point, in display units; null when not recorded. */
  series: (activity: Activity) => (number | null)[] | null;
}

const SOURCES: ZoneSource[] = [
  {
    id: 'activity-speed',
    label: 'Speed',
    icon: 'speed',
    unit: () => (distanceUnits() === 'imperial' ? 'mph' : 'km/h'),
    series: (activity) =>
      smoothedSeries(
        activity,
        activity.speeds.map((v) => speedFromKmh(v * 3.6, distanceUnits())),
        COLOR_WINDOW,
      ),
  },
  {
    id: 'activity-hr',
    label: 'Heart rate',
    icon: 'heart',
    unit: () => 'bpm',
    series: (activity) => activity.values.hr ?? null,
  },
  {
    id: 'activity-power',
    label: 'Power',
    icon: 'power',
    unit: () => 'W',
    series: (activity) =>
      activity.values.power
        ? smoothedSeries(activity, activity.values.power, COLOR_WINDOW)
        : null,
  },
];

export function activityColorings(deps: {
  activity: () => Activity | null;
  locale: () => string;
}): Coloring[] {
  // The zones of the open activity, computed once per activity and units.
  let key: unknown[] = [];
  /** Null when not recorded, 'flat' when the readings barely vary. */
  let zones = new Map<
    string,
    { limits: number[]; ranges: Range[] } | 'flat' | null
  >();
  const zonesOf = (source: ZoneSource) => {
    const activity = deps.activity();
    if (!activity) return null;
    const current = [activity, distanceUnits()];
    if (current.some((v, i) => v !== key[i])) {
      key = current;
      zones = new Map();
    }
    if (!zones.has(source.id)) {
      const series = source.series(activity);
      const limits = series && zoneLimits(series, movingPoints(activity));
      zones.set(
        source.id,
        !series
          ? null
          : limits
            ? { limits, ranges: zoneRanges(activity, series, limits) }
            : 'flat',
      );
    }
    return zones.get(source.id) ?? null;
  };
  /** The zones to draw, or null. */
  const drawn = (source: ZoneSource) => {
    const found = zonesOf(source);
    return found === 'flat' ? null : found;
  };
  const number = (value: number) => value.toLocaleString(deps.locale());
  return SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    get legend() {
      const limits = drawn(source)?.limits ?? [];
      const unit = source.unit();
      return ZONES.map((kind, i) => ({
        kind,
        label: !limits.length
          ? kind
          : i === 0
            ? `Under ${withUnit(number(limits[0]), unit)}`
            : i === limits.length
              ? `${withUnit(number(limits[i - 1]), unit)} and over`
              : withUnit(`${number(limits[i - 1])}–${number(limits[i])}`, unit),
      }));
    },
    get scale() {
      return {
        start: source.icon,
        unit: source.unit(),
        limits: (drawn(source)?.limits ?? []).map(number),
      };
    },
    unavailable: () => {
      const found = zonesOf(source);
      return found === 'flat'
        ? 'Too little variation to color'
        : found
          ? null
          : 'Not recorded in this activity';
    },
    activityRanges: () => drawn(source)?.ranges ?? [],
  }));
}
