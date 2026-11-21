import {
  distanceAt,
  movingPoints,
  segmentStarts,
  skippedStops,
  type Activity,
} from './activity';
import { compactLayout } from './panel';
import { valueKind } from './activity-values';
import { byId as $, text } from './dom';
import { t } from './i18n';
import { icon, type IconName } from './icons';
import type { MapMarker, PlannerMap } from './planner-map';
import {
  chartAxis,
  chartFrame,
  CHART_WIDTH,
  profileChart,
  type ChartPoint,
} from './profile-chart';
import { indexTrack, pointAtDistance } from './track-position';
import { navigationDurationLabel } from './navigation';
import { speedFromKmh } from './travel-time';
import { distanceLabel, elevationLabel } from './units';
import { distanceUnits } from './unit-preferences';

/**
 * Charts of a recorded activity (#156): one per channel the file carries,
 * stacked over the same along-track distance, with one cursor across all of
 * them that shows each value at that point and the point on the map. Built
 * from page memory only.
 */

const HEIGHT = 64,
  PAD = 3;
/** Chart points per chart: about two per chart unit. */
const BINS = CHART_WIDTH * 2;

interface ChartChannel {
  id: 'altitude' | 'speed' | 'hr' | 'cadence' | 'power';
  icon: IconName;
  /** Per recorded point, in display units. */
  series: (number | null)[];
  /** The value as shown, with its unit. */
  format: (value: number) => string;
  /** Header text without the cursor. */
  summary: string;
  /** The chart starts at zero rather than at the lowest reading. */
  fromZero: boolean;
  /** Zero readings are left out of the line (coasting, for cadence). */
  skipZero?: boolean;
}

export function setupActivityCharts(deps: {
  map: PlannerMap;
  locale: () => string;
  /** Marker group shown while the activity view keeps the map (`solo`). */
  group: string;
}) {
  const row = $<HTMLDetailsElement>('activity-charts-row'),
    box = $('activity-charts');
  let cursor: MapMarker | null = null;
  const hideCursor = () => {
    cursor?.remove();
    cursor = null;
  };

  function channels(activity: Activity): ChartChannel[] {
    const locale = deps.locale(),
      units = distanceUnits();
    const unit = units === 'imperial' ? 'mph' : 'km/h';
    const speed = (metersPerSecond: number) =>
      speedFromKmh(metersPerSecond * 3.6, units);
    const number = (value: number, digits = 0) =>
      value.toLocaleString(locale, { maximumFractionDigits: digits });
    const out: ChartChannel[] = [];
    if (activity.altitude) {
      const highest = activity.peaks.find((p) => p.kind === 'altitude');
      out.push({
        id: 'altitude',
        icon: 'summit',
        series: activity.altitude,
        format: (v) => elevationLabel(v, units, locale),
        summary: highest
          ? t(`max. ${elevationLabel(highest.value, units, locale)}`)
          : '',
        fromZero: false,
      });
    }
    out.push({
      id: 'speed',
      icon: 'speed',
      series: activity.speeds.map(speed),
      format: (v) => `${number(v, 1)} ${unit}`,
      summary: t(
        `avg. ${number(speed(activity.averageSpeed), 1)} · max. ${number(speed(activity.maxSpeed), 1)} ${unit}`,
      ),
      fromZero: true,
    });
    const sensor = (
      id: 'hr' | 'cadence' | 'power',
      name: IconName,
      unitLabel: string,
      fromZero: boolean,
    ) => {
      const series = activity.values[id],
        stats = activity.channels[id];
      if (!series || !stats) return;
      out.push({
        id,
        icon: name,
        series,
        format: (v) => `${number(v)} ${unitLabel}`,
        summary: t(
          `avg. ${number(stats.average)} · max. ${number(stats.max)} ${unitLabel}`,
        ),
        fromZero,
        // Coasting: the average leaves it out too, as bike computers do.
        skipZero: id === 'cadence',
      });
    };
    sensor('hr', 'heart', 'bpm', false);
    sensor('cadence', 'cadence', 'rpm', true);
    sensor('power', 'power', 'W', true);
    return out;
  }

  /**
   * A series averaged into evenly spaced distance bins, moving points only,
   * broken at GPX segment gaps and where a bin has no reading.
   */
  function binned(
    activity: Activity,
    series: (number | null)[],
    moving: boolean[],
    starts: Set<number>,
  ): ChartPoint[][] {
    const total = activity.distance || 1,
      width = total / BINS;
    const parts: ChartPoint[][] = [[]];
    let bin = -1,
      sum = 0,
      count = 0;
    const flush = () => {
      if (count)
        parts.at(-1)!.push({ at: (bin + 0.5) * width, value: sum / count });
      else if (parts.at(-1)!.length) parts.push([]);
      sum = 0;
      count = 0;
    };
    activity.distances.forEach((d, i) => {
      const b = Math.min(BINS - 1, Math.floor(d / width));
      if (starts.has(i)) {
        flush();
        if (parts.at(-1)!.length) parts.push([]);
        bin = b;
      } else if (b !== bin) {
        if (bin >= 0) flush();
        bin = b;
      }
      const value = series[i];
      if (value !== null && moving[i]) {
        sum += value;
        count++;
      }
    });
    flush();
    return parts.filter((part) => part.length);
  }

  function show(activity: Activity) {
    hideCursor();
    const locale = deps.locale(),
      units = distanceUnits();
    const moving = movingPoints(activity);
    const starts = segmentStarts(activity);
    // Stops take no distance: a tick where each skipped one happened.
    const stops = skippedStops(activity).map((stop) =>
      distanceAt(activity, stop.from),
    );
    const index = indexTrack(activity.segments);
    const charts = channels(activity).map((channel) => {
      const parts = binned(
        activity,
        channel.skipZero
          ? channel.series.map((v) => (v === 0 ? null : v))
          : channel.series,
        moving,
        starts,
      );
      const values = parts.flat().map((p) => p.value);
      const low = Math.min(...values),
        high = Math.max(...values);
      const min = channel.fromZero ? Math.min(0, low) : low;
      const chart = profileChart({
        parts,
        total: activity.distance,
        min,
        max: high > min ? high : min + 1,
        height: HEIGHT,
        pad: PAD,
        className: 'activity-chart-svg',
        ticks: stops,
      });
      const head = document.createElement('p');
      head.className = 'activity-chart-head';
      const reading = text('b', channel.summary);
      // Short labels as on the replay's data page, so the reading fits
      // beside them from 320 px; the full name for screen readers.
      const { short, label } = valueKind(channel.id);
      const name = text('span', short);
      name.setAttribute('aria-hidden', 'true');
      head.append(
        icon(channel.icon),
        name,
        text('span', label, 'sr-only'),
        reading,
      );
      const frame = chartFrame(
        chart.svg,
        channel.format(high),
        channel.format(min),
      );
      const item = document.createElement('div');
      item.className = `activity-chart activity-chart-${channel.id}`;
      item.append(head, frame);
      return { channel, chart, reading, item, parts: values.length };
    });
    const shown = charts.filter((c) => c.parts);
    const axis = chartAxis(
      distanceLabel(0, units, locale),
      distanceLabel(activity.distance, units, locale),
    );
    const readout = document.createElement('p');
    readout.className = 'activity-chart-readout hint';
    readout.setAttribute('aria-hidden', 'true');
    const stack = document.createElement('div');
    stack.className = 'activity-chart-stack';
    stack.append(...shown.map((c) => c.item));
    box.replaceChildren(readout, stack, axis);

    // One cursor across every chart: the nearest recorded point to the
    // distance under the pointer.
    const pointAt = (at: number) => {
      const { distances } = activity;
      let low = 0,
        high = distances.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (distances[middle] < at) low = middle + 1;
        else high = middle;
      }
      // The nearer of the points on each side.
      return low && at - distances[low - 1] < distances[low] - at
        ? low - 1
        : low;
    };
    const reset = () => {
      for (const { channel, chart, reading } of shown) {
        chart.guide(null);
        reading.textContent = channel.summary;
      }
      readout.textContent = '';
      hideCursor();
    };
    stack.onpointermove = (event) => {
      if (!shown.length) return;
      const at = shown[0].chart.atPointer(event);
      const i = pointAt(at);
      for (const { channel, chart, reading } of shown) {
        chart.guide(activity.distances[i]);
        const value = channel.series[i];
        reading.textContent = value === null ? '–' : channel.format(value);
      }
      const clock = new Date(activity.times[i]).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      });
      readout.textContent = `${distanceLabel(activity.distances[i], units, locale)} · ${navigationDurationLabel((activity.times[i] - activity.start) / 1000)} · ${clock}`;
      const point = pointAtDistance(index, activity.distances[i]);
      hideCursor();
      if (point)
        cursor = deps.map.marker(point.coord, {
          className: 'chart-cursor',
          size: [16, 16],
          anchor: [8, 8],
          z: 3,
          group: deps.group,
        });
    };
    stack.onpointerleave = reset;
    row.hidden = !shown.length;
  }

  return {
    /** Draws the charts of an opened activity; open by default on wide screens. */
    open(activity: Activity) {
      row.open = !compactLayout();
      show(activity);
    },
    /** Redraws after a change of units or language. */
    refresh: show,
    clear() {
      hideCursor();
      box.replaceChildren();
    },
  };
}
