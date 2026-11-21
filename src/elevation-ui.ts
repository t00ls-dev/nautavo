import {
  highlightLayers,
  lineFeature,
  MapPopup,
  RANK,
  type MapMarker,
  type PlannerMap,
} from './planner-map';
import { detectClimbs, hardestClimb, type Climb } from './climbs';
import type { Coord, Route, State } from './core';
import { departureOf } from './departure';
import { byId as $ } from './dom';
import { sheetCoversMap } from './panel';
import { icon, iconControl } from './icons';
import { t } from './i18n';
import {
  cumulativeClimb,
  elevationExtremes,
  elevationStats,
  profileFromTrack,
  samplePlan,
  smoothProfile,
  type ElevationSource,
  type ProfilePoint,
} from './elevation';
import {
  countdown,
  fetchElevations,
  retryIn,
  UsageLimitError,
} from './open-meteo';
import {
  indexTrack,
  legDistances,
  pointAtDistance,
  trackSlice,
} from './track-position';
import { onlineAttempt } from './offline';
import { travelTimeSeconds } from './travel-time';
import { distanceLabel, elevationLabel, milepostLabel } from './units';
import { distanceUnits } from './unit-preferences';
import {
  chartAxis,
  chartFrame,
  profileChart,
  SVG_NS,
  type ChartPoint,
} from './profile-chart';

/**
 * Elevation row in the route summary: profile chart and statistics. Recorded
 * GPX elevations are used locally; otherwise elevation is requested only when
 * the row is opened. The chart cursor shows the point on the map; the
 * highest and lowest points are marked while the row is open. The map point
 * menu asks for the elevation of one point, one request per explicit choice.
 */

const HEIGHT = 90,
  PAD = 4;
/** Quiet time before fetching elevation for a new route while the row is open. */
const SETTLE_MS = 2000;
/**
 * A climb's summit this close (along the route, meters) to the highest point
 * is that point: its label stands for both, so the map shows one mark.
 */
const SAME_SUMMIT = 500;

export function setupElevation(
  map: PlannerMap,
  deps: {
    state: () => State;
    endpoint: () => string;
    /** Recorded elevations for an imported route, if any. */
    recorded: (route: Route) => (number | null)[][] | undefined;
    /** The device's average speed in km/h, for climb passage times. */
    speed: () => number;
    /** Another explicit user choice needs the profile (the Grade coloring). */
    wanted?: () => boolean;
    /** Called when a profile arrives or is reset, so its users redraw. */
    onProfile?: () => void;
  },
) {
  const details = $<HTMLDetailsElement>('elevation'),
    chart = $('elevation-chart'),
    stats = $('elevation-stats'),
    status = $('elevation-status'),
    retry = $<HTMLButtonElement>('elevation-retry');
  /** A profile that failed offline waits for the connection (one attempt). */
  const whenOnline = onlineAttempt();
  /** Markers of one kind, removed together. */
  const group = () => {
    const items: MapMarker[] = [];
    return {
      add: (marker: MapMarker) => items.push(marker),
      clearLayers: () => items.splice(0).forEach((m) => m.remove()),
    };
  };
  const cursorLayer = group();
  // The climb chosen in the list, highlighted on the map and in the chart.
  const setClimbLine = map.overlay('rg-climb', RANK.highlight, () =>
    highlightLayers('rg-climb-line'),
  );
  const climbMarks = group();
  const climbLayer = {
    clearLayers() {
      setClimbLine([]);
      climbMarks.clearLayers();
    },
  };
  // Highest and lowest points of the profile, while the row is open: labels
  // below the route (route point pins stand above it), over the chosen climb.
  const extremesLayer = group();
  let selected = -1,
    settle: ReturnType<typeof setTimeout> | undefined,
    cancelWait = () => {},
    /** The single automatic retry after a usage limit was already used. */
    retried = false;
  let route: Route | null = null,
    profile: ProfilePoint[] | null = null,
    fromService = false,
    controller: AbortController | undefined;

  const locale = () => (deps.state().language === 'pt' ? 'pt-BR' : 'en');
  /** The profile is loaded only while the row is open or a user of it is on. */
  const needed = () => details.open || !!deps.wanted?.();
  const units = () => distanceUnits();

  /**
   * Along-track distance of each route point, so samples restart at every
   * point and an edit changes only the samples of the legs next to it.
   */
  function legBounds(target: Route): number[] {
    const points = (
      target.snapped ?? deps.state().points.map((p) => p.coord)
    ).filter((c): c is Coord => !!c);
    return legDistances(target.segments, points);
  }

  function message(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
    status.removeAttribute('aria-busy');
    retry.hidden = !error;
  }

  async function load() {
    if (!route || !needed() || profile) return render();
    const recorded = deps.recorded(route);
    if (recorded) {
      profile = smoothProfile(
        profileFromTrack(route.segments, recorded),
        'recorded',
      );
      fromService = false;
      deps.onProfile?.();
      return render();
    }
    controller?.abort();
    controller = new AbortController();
    const target = route,
      signal = controller.signal;
    const plan = samplePlan(target.segments, legBounds(target));
    message('Loading elevation…');
    try {
      const values = await fetchElevations(
        deps.endpoint(),
        plan.map((p) => p.coord),
        signal,
        () => route === target,
      );
      if (route !== target) return;
      profile = smoothProfile(
        plan.flatMap((p, i) =>
          values[i] === null
            ? []
            : [{ at: p.at, ele: values[i], ...(p.gap ? { gap: true } : {}) }],
        ),
        'terrain',
      );
      fromService = true;
      message('');
      deps.onProfile?.();
      render();
      retried = false;
    } catch (error) {
      if (route !== target || (error as Error).name === 'AbortError') return;
      // Usage limit: a live countdown, then one automatic retry. Refused again,
      // it counts down once more and only then offers the button, so repeated
      // taps cannot make the limit worse. Other errors show the button now.
      if (error instanceof UsageLimitError) {
        const again = !retried;
        retried = true;
        waitForLimit(target, error.wait, again);
        return;
      }
      retried = false;
      if (
        whenOnline(() => {
          if (route === target) void load();
        })
      ) {
        message(
          'No connection. The elevation will load when the connection returns.',
        );
        return;
      }
      message(
        error instanceof Error
          ? error.message
          : 'Elevation unavailable. Try again.',
        true,
      );
    }
  }

  /** "… Try again in 30s." counting down; then retries or offers the button. */
  function waitForLimit(target: Route, wait: number, retryAfter: boolean) {
    cancelWait();
    let first = true;
    cancelWait = countdown(
      wait,
      (seconds) => {
        if (route !== target || !needed()) return cancelWait();
        message(`Elevation usage limit reached. ${retryIn(seconds * 1000)}`);
        // Announced once, not every second.
        if (!first) status.setAttribute('aria-busy', 'true');
        first = false;
      },
      () => {
        if (route !== target || !needed()) return;
        if (retryAfter) void load();
        else message('Elevation usage limit reached.', true);
      },
    );
  }

  function render() {
    // The point popup shows units and number formats too.
    renderPoint();
    chart.replaceChildren();
    stats.replaceChildren();
    if (!route || !profile) return;
    const source = fromService ? 'terrain' : 'recorded';
    const summary = elevationStats(profile, source);
    if (!summary) {
      message('No elevation data for this route.');
      return;
    }
    const total = profile.at(-1)!.at || 1;
    // One filled area per GPX segment, so gaps stay as breaks.
    const parts: ChartPoint[][] = [];
    for (const p of profile)
      if (p.gap || !parts.length) parts.push([{ at: p.at, value: p.ele }]);
      else parts.at(-1)!.push({ at: p.at, value: p.ele });
    const { svg, x, guide, atPointer } = profileChart({
      parts,
      total,
      min: summary.min,
      max: Math.max(summary.max, summary.min + 1),
      height: HEIGHT,
      pad: PAD,
      className: 'elevation-svg',
    });
    const climbs = detectClimbs(profile, source);
    if (selected >= climbs.length) selected = -1;
    // Climb stretches shaded behind the profile; the chosen one stronger.
    const behind = svg.firstChild;
    climbs.forEach((climb, i) => {
      const band = document.createElementNS(SVG_NS, 'rect');
      band.setAttribute('x', x(climb.start).toFixed(1));
      band.setAttribute('y', '0');
      band.setAttribute(
        'width',
        Math.max(1, x(climb.end) - x(climb.start)).toFixed(1),
      );
      band.setAttribute('height', String(HEIGHT));
      band.classList.add('elevation-climb');
      if (i === selected) band.classList.add('selected');
      svg.insertBefore(band, behind);
    });
    const readout = document.createElement('p');
    readout.className = 'elevation-readout hint';
    const frame = chartFrame(
      svg,
      elevationLabel(summary.max, units(), locale()),
      elevationLabel(summary.min, units(), locale()),
    );
    const axis = chartAxis(
      distanceLabel(0, units(), locale()),
      distanceLabel(total, units(), locale()),
    );
    chart.append(frame, axis, readout);

    // Cursor: chart position → profile point and map marker.
    const index = indexTrack(route.segments);
    const climbed = cumulativeClimb(profile, source);
    const hide = () => {
      guide(null);
      readout.textContent = '';
      cursorLayer.clearLayers();
    };
    frame.onpointermove = (event) => {
      const at = atPointer(event);
      let n = 0;
      profile!.forEach((p, i) => {
        if (Math.abs(p.at - at) < Math.abs(profile![n].at - at)) n = i;
      });
      const nearest = profile![n];
      guide(nearest.at);
      // Gain so far along the route, with the same noise threshold as the totals.
      readout.textContent = `${distanceLabel(nearest.at, units(), locale())} · ${elevationLabel(nearest.ele, units(), locale())} · Gain so far ${elevationLabel(climbed[n].ascent, units(), locale())} · Loss so far ${elevationLabel(climbed[n].descent, units(), locale())}`;
      const point = pointAtDistance(index, nearest.at);
      cursorLayer.clearLayers();
      if (point)
        cursorLayer.add(
          map.marker(point.coord, {
            className: 'chart-cursor',
            size: [16, 16],
            anchor: [8, 8],
            z: 2,
          }),
        );
    };
    frame.onpointerleave = hide;

    const lines = [
      `Min ${elevationLabel(summary.min, units(), locale())} · Max ${elevationLabel(summary.max, units(), locale())} · Avg ${elevationLabel(summary.mean, units(), locale())}`,
      // Estimated total climbing for the whole route (and the matching loss).
      `Elevation gain ${elevationLabel(summary.ascent, units(), locale())} · Elevation loss ${elevationLabel(summary.descent, units(), locale())}`,
    ];
    const note = document.createElement('p');
    note.className = 'hint';
    if (fromService) {
      // Short note; the help explains the 90 m terrain model, bridges and tunnels.
      const language = deps.state().language === 'pt' ? 'pt' : 'en';
      const link = document.createElement('a');
      // The hash stays the route state, as in the header Help link, so Back to map returns to it.
      link.href = `./help?lang=${language}&section=elevation${location.hash}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'See the help.';
      note.append(
        document.createTextNode('Elevation estimated from terrain.'),
        document.createTextNode(' '),
        link,
      );
    } else note.textContent = 'Recorded in the imported file.';
    stats.replaceChildren(
      ...lines.map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
      climbList(climbs),
      note,
    );
    showClimb(climbs[selected] ?? null, index);
    showExtremes(index);
  }

  /**
   * Highest and lowest points on the map, labeled with their elevation. The
   * same values are in the statistics as text, so the markers are hidden
   * from assistive technology.
   */
  function showExtremes(index: ReturnType<typeof indexTrack>) {
    extremesLayer.clearLayers();
    const extremes = profile && details.open && elevationExtremes(profile);
    if (!extremes) return;
    for (const [kind, point] of [
      ['highest', extremes.highest],
      ['lowest', extremes.lowest],
    ] as const) {
      const at = pointAtDistance(index, point.at);
      if (!at) continue;
      const chip = document.createElement('span');
      chip.className = `map-extreme ${kind}`;
      const text = document.createElement('span');
      text.textContent = elevationLabel(point.ele, units(), locale());
      chip.append(icon('summit'), text);
      extremesLayer.add(
        map.marker(at.coord, {
          className: 'map-extreme-marker',
          html: chip,
          size: [0, 0],
          anchor: [0, 0],
          z: 4,
        }),
      );
    }
  }

  /**
   * Elevation of one map point, asked from the point menu: one request (or a
   * cache hit) per choice, shown in a popup at the point. A usage limit
   * counts down and asks once more by itself; refused again, it says so.
   */
  type PointResult =
    | { kind: 'loading' }
    | { kind: 'value'; value: number }
    | { kind: 'none' }
    | { kind: 'message'; text: string };
  const popup = new MapPopup(map, 'elevation-point-popup');
  let pointController: AbortController | undefined,
    pointResult: PointResult = { kind: 'loading' },
    cancelPointWait = () => {};
  const pointOpen = () => popup.open;

  function renderPoint() {
    if (!pointOpen()) return;
    const box = document.createElement('div');
    box.className = 'elevation-point';
    const header = document.createElement('div');
    header.className = 'elevation-point-header';
    const title = document.createElement('strong');
    title.textContent = 'Elevation here';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'elevation-point-close';
    iconControl(close, 'close', 'Close', true);
    close.onclick = () => {
      popup.close();
      map.focus();
    };
    header.append(title, close);
    const value = document.createElement('p');
    value.className = 'elevation-point-value';
    value.setAttribute('role', 'status');
    const result = pointResult;
    value.textContent =
      result.kind === 'loading'
        ? 'Loading elevation…'
        : result.kind === 'value'
          ? `About ${elevationLabel(result.value, units(), locale())}`
          : result.kind === 'none'
            ? 'No elevation data here.'
            : result.text;
    box.append(header, value);
    if (result.kind === 'value') {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Elevation estimated from terrain.';
      box.append(note);
    }
    popup.setContent(box);
  }

  async function askPoint(coord: Coord, retryAfterLimit: boolean) {
    pointController?.abort();
    const controller = new AbortController();
    pointController = controller;
    const current = () => pointController === controller && pointOpen();
    pointResult = { kind: 'loading' };
    renderPoint();
    try {
      const [value] = await fetchElevations(
        deps.endpoint(),
        [coord],
        controller.signal,
        current,
      );
      if (!current()) return;
      pointResult =
        value === null || value === undefined
          ? { kind: 'none' }
          : { kind: 'value', value };
    } catch (error) {
      if (!current() || (error as Error).name === 'AbortError') return;
      if (error instanceof UsageLimitError) {
        let first = true;
        cancelPointWait = countdown(
          error.wait,
          (seconds) => {
            if (!current()) return cancelPointWait();
            pointResult = {
              kind: 'message',
              text: `Elevation usage limit reached. ${retryIn(seconds * 1000)}`,
            };
            renderPoint();
            // Announced once, not every second.
            if (!first)
              popup.element
                .querySelector('[role=status]')
                ?.setAttribute('aria-busy', 'true');
            first = false;
          },
          () => {
            if (!current()) return;
            if (retryAfterLimit) void askPoint(coord, false);
            else {
              pointResult = {
                kind: 'message',
                text: 'Elevation usage limit reached.',
              };
              renderPoint();
            }
          },
        );
        return;
      }
      pointResult = {
        kind: 'message',
        text:
          error instanceof Error
            ? error.message
            : 'Elevation unavailable. Try again.',
      };
    }
    renderPoint();
  }

  popup.onClose = () => {
    pointController?.abort();
    pointController = undefined;
    cancelPointWait();
  };

  /** Climbs in route order; one is marked as the hardest by score. */
  function climbList(climbs: Climb[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'climbs';
    if (!climbs.length) {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No significant climbs on this route.';
      box.append(none);
      return box;
    }
    const heading = document.createElement('p');
    heading.className = 'climbs-heading';
    heading.textContent = `Climbs (${climbs.length})`;
    const list = document.createElement('ol');
    const hardest = hardestClimb(climbs);
    const leaving = departureOf(deps.state());
    const percent = (value: number) =>
      `${value.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`;
    climbs.forEach((climb, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'climb';
      button.setAttribute('aria-pressed', String(i === selected));
      button.setAttribute('aria-controls', 'map');
      const parts = [
        milepostLabel(climb.start, units(), locale()),
        distanceLabel(climb.length, units(), locale()),
        `+${elevationLabel(climb.gain, units(), locale())}`,
        percent(climb.grade),
        `${t('max')} ${percent(climb.maxGrade)}`,
      ];
      if (leaving) {
        const time =
          Date.parse(leaving) +
          travelTimeSeconds(climb.start, deps.speed()) * 1000;
        parts.push(
          new Date(time).toLocaleTimeString(locale(), {
            hour: '2-digit',
            minute: '2-digit',
          }),
        );
      }
      // The hardest climb is marked by a small summit icon, not a wide badge,
      // so the row stays on one line; its name stays for screen readers.
      const mark =
        i === hardest ? icon('summit') : document.createElement('span');
      mark.classList.add('climb-mark');
      const text = document.createElement('span');
      text.textContent = parts.join(' · ');
      // Grid on an inner element: older Safari ignores grid on a <button>.
      const grid = document.createElement('span');
      grid.className = 'climb-grid';
      grid.append(mark, text);
      button.append(grid);
      if (climb.suspect) {
        const check = document.createElement('span');
        check.className = 'climb-check';
        check.textContent = 'Check: tunnel or bridge?';
        text.append(document.createElement('br'), check);
      }
      if (i === hardest) {
        const label = document.createElement('span');
        label.className = 'sr-only';
        label.textContent = 'Hardest';
        button.append(label);
        button.title = t('Hardest');
      }
      button.onclick = () => {
        selected = selected === i ? -1 : i;
        render();
        if (selected >= 0) focusClimb(climbs[selected]);
      };
      item.append(button);
      list.append(item);
    });
    box.append(heading, list);
    return box;
  }

  /** Chosen climb on the map: its stretch, start and summit. */
  function showClimb(
    climb: Climb | null,
    index: ReturnType<typeof indexTrack>,
  ) {
    climbLayer.clearLayers();
    if (!climb || !details.open) return;
    setClimbLine(
      trackSlice(index, climb.start, climb.end).map((part) =>
        lineFeature(part),
      ),
    );
    const start = pointAtDistance(index, climb.start),
      summit = pointAtDistance(index, climb.end);
    if (start)
      climbMarks.add(
        map.marker(start.coord, {
          className: 'climb-start',
          size: [16, 16],
          anchor: [8, 8],
          z: 1,
        }),
      );
    // The highest point's label already marks a summit there: one mark only.
    const highest = profile && elevationExtremes(profile)?.highest;
    const labeled =
      !!highest && Math.abs(highest.at - climb.end) <= SAME_SUMMIT;
    if (summit && !labeled) {
      const svg = icon('summit');
      climbMarks.add(
        map.marker(summit.coord, {
          className: 'climb-summit',
          html: svg,
          size: [26, 26],
          anchor: [13, 13],
          z: 1,
        }),
      );
    }
  }

  /** Fits the map to a climb; on mobile the panel makes room for the map. */
  function focusClimb(climb: Climb) {
    if (!route) return;
    const parts = trackSlice(
      indexTrack(route.segments),
      climb.start,
      climb.end,
    );
    if (!parts.length) return;
    if (!$('route-panel').hidden && sheetCoversMap()) $('panel-toggle').click();
    map.fit(parts.flat(), { padding: 40 });
  }

  details.addEventListener('toggle', () => {
    if (details.open) {
      clearTimeout(settle);
      void load();
    } else {
      // The Grade coloring may still be waiting for this profile.
      if (!needed()) {
        clearTimeout(settle);
        cancelWait();
      }
      cursorLayer.clearLayers();
      climbLayer.clearLayers();
      extremesLayer.clearLayers();
    }
  });
  retry.onclick = () => void load();

  return {
    /** A new route resets the profile; an open row loads it again. */
    setRoute(next: Route | null) {
      if (next === route) return render();
      controller?.abort();
      route = next;
      profile = null;
      selected = -1;
      message('');
      cursorLayer.clearLayers();
      climbLayer.clearLayers();
      extremesLayer.clearLayers();
      chart.replaceChildren();
      stats.replaceChildren();
      cancelWait();
      retried = false;
      // While the route keeps changing (editing points), wait for it to
      // settle so intermediate routes do not spend the Open-Meteo budget.
      clearTimeout(settle);
      deps.onProfile?.();
      if (route && needed()) {
        // Recorded elevations need no request: show them at once.
        if (deps.recorded(route)) void load();
        else {
          message('Loading elevation…');
          settle = setTimeout(() => void load(), SETTLE_MS);
        }
      }
    },
    refresh: () => render(),
    /** Elevation of one map point, from the point menu. */
    queryPoint(coord: Coord) {
      cancelPointWait();
      popup.show(coord);
      void askPoint(coord, true);
    },
    /** Closes the point elevation popup; true when it was open. */
    closePoint(): boolean {
      if (!pointOpen()) return false;
      popup.close();
      return true;
    },
    /** The smoothed profile of the current route and its source, when loaded. */
    profile() {
      if (!profile) return null;
      const source: ElevationSource = fromService ? 'terrain' : 'recorded';
      return { profile, source };
    },
    /** A user of the profile was turned on: load it now if still missing. */
    want() {
      if (route && !profile && needed()) {
        clearTimeout(settle);
        void load();
      }
    },
  };
}
