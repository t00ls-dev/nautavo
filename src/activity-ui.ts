import { distanceAt, type Activity } from './activity';
import { setupActivityCharts } from './activity-charts';
import { PEAK_ICONS, peakLabel } from './activity-values';
import type { Coord } from './core';
import { indexTrack, pointAtDistance } from './track-position';
import { byId as $, text } from './dom';
import { t } from './i18n';
import { icon, type IconName } from './icons';
import {
  lineFeature,
  RANK,
  type MapMarker,
  type PlannerMap,
} from './planner-map';
import {
  distanceLabel,
  elevationLabel,
  speedLabel,
  temperatureLabel,
} from './units';
import { distanceUnits, temperatureUnits } from './unit-preferences';
import { routeLineColor } from './map-layers';
import { COLORING_OVERLAY } from './route-overlays';
import { navigationDurationLabel } from './navigation';

const durationLabel = (ms: number) => navigationDurationLabel(ms / 1000);

/**
 * The activity view (#156): a recorded activity opened from Import, apart
 * from the route planner. The panel shows its summary, the map its recorded
 * track; the planned route, its points and weather step aside on the map
 * (`PlannerMap.solo`) and are left untouched, so closing the view shows the
 * planner as it was. Times and sensor values stay in page memory: nothing is
 * stored, linked or sent.
 */

/** Overlay and marker group of the recorded track. */
const OVERLAY = 'rg-activity',
  GROUP = 'activity';
/** The peaks marked on the map, in this order. */
const PEAKS = ['speed', 'hr', 'altitude'] as const;
/** Room between the track and a peak's label, px (as the CSS offset). */
const PEAK_GAP = 12;
/**
 * How far a peak's label reaches from its point, below or above it: the
 * gap and the 24 px label, and half its usual width to each side, px.
 */
const PEAK_REACH = {
  top: PEAK_GAP + 24,
  bottom: PEAK_GAP + 24,
  left: 56,
  right: 56,
};

export function setupActivityView(deps: {
  map: PlannerMap;
  /** Route coloring, which colors the recorded track while it is open. */
  overlays: { activityChanged(): void; refresh(): void };
  locale: () => string;
  /** Frames the map on the open activity (or the route once closed). */
  fit: () => void;
  replay: (activity: Activity, back: HTMLElement) => void;
  /** Imports the same file as a route, as Import did before activities. */
  useAsRoute: () => void;
  /** The planner's summary and status, shown again on close. */
  restore: () => void;
  status: (message: string) => void;
}) {
  const { map } = deps;
  // Drawn as the route line is, in the same color for the base map.
  const setLine = map.overlay(OVERLAY, RANK.route, () => [
    {
      id: `${OVERLAY}-casing`,
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-opacity': 0.95, 'line-width': 8 },
    },
    {
      id: `${OVERLAY}-line`,
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeLineColor(), 'line-width': 4 },
    },
  ]);
  let open: Activity | null = null,
    markers: MapMarker[] = [],
    peakLabels: { coord: Coord; chip: HTMLElement }[] = [];
  const play = $<HTMLButtonElement>('activity-replay');
  const charts = setupActivityCharts({
    map,
    locale: deps.locale,
    group: GROUP,
  });

  // The start, a dot, draws above the end, a ring around it: a ride that
  // ends where it started shows both.
  const endMarker = (coord: Coord, kind: 'start' | 'end') => {
    const size = kind === 'start' ? 14 : 22;
    return map.marker(coord, {
      className: `activity-marker activity-${kind}`,
      size: [size, size],
      anchor: [size / 2, size / 2],
      z: kind === 'start' ? 2 : 1,
      framed: true,
      group: GROUP,
    });
  };

  /**
   * The fastest point, the highest heart rate and the highest point on the
   * map, labeled with their value. The summary has them as text, so the
   * labels are hidden from assistive technology. Two labels that would
   * cover each other point from opposite sides of the track (`placePeaks`).
   */
  function peakMarkers(activity: Activity): MapMarker[] {
    const index = indexTrack(activity.segments);
    const shown = PEAKS.flatMap((kind) => {
      const peak = activity.peaks.find((p) => p.kind === kind);
      const point =
        peak && pointAtDistance(index, distanceAt(activity, peak.time));
      return peak && point ? [{ peak, coord: point.coord }] : [];
    });
    peakLabels = [];
    return shown.map(({ peak, coord }) => {
      const chip = document.createElement('span');
      chip.className = `map-extreme activity-peak activity-peak-${peak.kind}`;
      chip.append(
        icon(PEAK_ICONS[peak.kind]),
        text('span', peakLabel(peak, deps.locale())),
      );
      chip.setAttribute('aria-hidden', 'true');
      peakLabels.push({ coord, chip });
      return map.marker(coord, {
        className: 'map-extreme-marker',
        html: chip,
        size: [0, 0],
        anchor: [0, 0],
        z: 4,
        framed: true,
        reach: PEAK_REACH,
        group: GROUP,
      });
    });
  }

  /**
   * Each peak label below its point, or above it where it would cover a
   * label placed before; again after every zoom or turn of the map.
   */
  function placePeaks() {
    const placed: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }[] = [];
    for (const { coord, chip } of peakLabels) {
      const p = map.project(coord);
      if (!p) return;
      const w = chip.offsetWidth,
        h = chip.offsetHeight;
      const box = (top: number) => ({
        left: p.x - w / 2,
        right: p.x + w / 2,
        top,
        bottom: top + h,
      });
      const covers = (b: (typeof placed)[number]) =>
        placed.some(
          (o) =>
            b.left < o.right &&
            o.left < b.right &&
            b.top < o.bottom &&
            o.top < b.bottom,
        );
      const below = box(p.y + PEAK_GAP),
        above = box(p.y - PEAK_GAP - h);
      const up = covers(below) && !covers(above);
      chip.classList.toggle('above', up);
      placed.push(up ? above : below);
    }
  }
  map.on('zoomend', placePeaks);
  map.on('rotateend', placePeaks);

  function summary(activity: Activity) {
    const locale = deps.locale(),
      units = distanceUnits();
    const speed = (metersPerSecond: number) =>
      speedLabel(metersPerSecond, units, locale);
    const stat = (label: string, value: string, note?: string) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.append(text('strong', value));
      if (note) detail.append(text('span', note));
      item.append(term, detail);
      return item;
    };
    $('activity-stats').replaceChildren(
      stat('Distance', distanceLabel(activity.distance, units, locale)),
      stat(
        'Moving time',
        durationLabel(activity.moving),
        t(`total ${durationLabel(activity.end - activity.start)}`),
      ),
      stat(
        'Average speed',
        speed(activity.averageSpeed),
        t(`max. ${speed(activity.maxSpeed)}`),
      ),
    );
    const values: [IconName, string, string][] = [];
    const { hr, cadence, power, temperature } = activity.channels;
    const round = (n: number) => String(Math.round(n));
    if (hr)
      values.push([
        'heart',
        'Heart rate',
        t(`${round(hr.average)} bpm, max. ${round(hr.max)}`),
      ]);
    if (cadence)
      values.push(['cadence', 'Cadence', `${round(cadence.average)} rpm`]);
    if (power)
      values.push([
        'power',
        'Power',
        t(`${round(power.average)} W, max. ${round(power.max)}`),
      ]);
    if (activity.channels.balance) {
      const left = Math.round(activity.channels.balance.average);
      values.push(['power', 'Power balance', `${left}/${100 - left} %`]);
    }
    if (temperature)
      values.push([
        'thermometer',
        'Temperature',
        temperatureLabel(temperature.average, temperatureUnits(), locale),
      ]);
    if (activity.climb)
      values.push([
        'up',
        'Climb',
        elevationLabel(activity.climb.ascent, units, locale),
      ]);
    const highest = activity.peaks.find((p) => p.kind === 'altitude');
    if (highest)
      values.push([
        'summit',
        'Highest point',
        elevationLabel(highest.value, units, locale),
      ]);
    $('activity-values').replaceChildren(
      ...values.map(([name, label, value]) => {
        const item = document.createElement('li');
        item.append(icon(name), text('span', label), text('b', value));
        return item;
      }),
    );
    $('activity-title').textContent = activity.name || 'Recorded activity';
    const start = new Date(activity.start),
      end = new Date(activity.end);
    const time = { hour: '2-digit', minute: '2-digit' } as const;
    $('activity-when').textContent =
      `${start.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}, ${start.toLocaleTimeString(locale, time)}–${end.toLocaleTimeString(locale, time)}`;
    $('peek-main').textContent =
      `${distanceLabel(activity.distance, units, locale)} · ${durationLabel(activity.end - activity.start)}`;
  }

  /** Opens an activity; `fileName` names it when the file has no name. */
  function show(activity: Activity, fileName = '') {
    close(false);
    open =
      fileName && !activity.name ? { ...activity, name: fileName } : activity;
    document.body.classList.add('activity-open');
    $('activity').hidden = false;
    play.hidden = false;
    summary(open);
    setLine(activity.segments.map((segment) => lineFeature(segment)));
    const flat = activity.segments.flat();
    markers = [
      endMarker(flat[0], 'start'),
      endMarker(flat.at(-1)!, 'end'),
      ...peakMarkers(open),
    ];
    // The route coloring colors the recorded track too.
    map.solo([OVERLAY, GROUP, COLORING_OVERLAY]);
    deps.overlays.activityChanged();
    charts.open(open);
    placePeaks();
    deps.status('Activity opened. Its times and values stay on this device.');
    deps.fit();
  }
  function close(restore = true) {
    if (!open) return;
    open = null;
    document.body.classList.remove('activity-open');
    $('activity').hidden = true;
    play.hidden = true;
    setLine([]);
    for (const marker of markers) marker.remove();
    markers = [];
    charts.clear();
    map.solo(null);
    deps.overlays.activityChanged();
    if (restore) {
      deps.restore();
      deps.fit();
    }
  }

  play.onclick = () => {
    if (open) deps.replay(open, play);
  };
  $('activity-route').onclick = () => {
    close(false);
    deps.useAsRoute();
  };
  $('activity-close').onclick = () => close();
  return {
    show,
    close,
    /** The open activity, or null. */
    current: () => open,
    /** The recorded track to frame while the view is open. */
    coords: (): Coord[] | null => open?.segments.flat() ?? null,
    /** The summary again, after a change of units or language. */
    refresh: () => {
      if (!open) return;
      summary(open);
      for (const marker of markers.splice(2)) marker.remove();
      markers.push(...peakMarkers(open));
      placePeaks();
      charts.refresh(open);
      deps.overlays.refresh();
    },
  };
}
