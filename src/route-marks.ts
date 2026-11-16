import { meters, type Coord, type Route } from './core';
import { byId as $ } from './dom';
import { indexTrack, pointAtDistance, type TrackIndex } from './track-position';
import { PASS_OFFSET, sliceByRanges, type Range } from './route-overlays';
import { lineFeature, RANK, type PlannerMap } from './planner-map';
import {
  PREFERENCE,
  readPreference,
  writePreference,
  type PreferenceKey,
} from './preferences';

/**
 * Route marks: direction arrows, separate parallel lines where the route uses
 * the same road twice in opposite directions (out-and-back), and the switch
 * for weather icons on the map. Visual only:
 * the route, links, GPX and weather requests are untouched.
 */

const SAMPLE = 20,
  NEAR = 20,
  MIN_APART = 200,
  OPPOSITE = 120,
  MIN_RANGE = 100,
  CELL = 30;

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Along-track ranges where the track runs over another part of itself in the
 * opposite direction. Crossings and bends are too short to count; parallel
 * roads more than about 20 m apart are not merged.
 */
export function repeatedRanges(segments: Coord[][]): Range[] {
  const index = indexTrack(segments);
  if (!index.edges.length) return [];
  const samples: { at: number; coord: Coord; bearing: number | null }[] = [];
  for (let at = 0; at <= index.total; at += SAMPLE) {
    const point = pointAtDistance(index, at)!;
    samples.push({ at, coord: point.coord, bearing: point.bearing });
  }
  const scale = Math.cos((samples[0].coord[0] * Math.PI) / 180);
  const key = ([lat, lon]: Coord) =>
    `${Math.floor((lat * 111195) / CELL)},${Math.floor((lon * 111195 * scale) / CELL)}`;
  const grid = new Map<string, number[]>();
  samples.forEach((s, i) => {
    const k = key(s.coord);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });
  const marked = samples.map((s) => {
    if (s.bearing === null) return false;
    const [y, x] = key(s.coord).split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of grid.get(`${y + dy},${x + dx}`) ?? []) {
          const other = samples[j];
          if (
            other.bearing !== null &&
            Math.abs(other.at - s.at) >= MIN_APART &&
            angleBetween(other.bearing, s.bearing) > OPPOSITE &&
            meters(other.coord, s.coord) <= NEAR
          )
            return true;
        }
    return false;
  });
  const ranges: Range[] = [];
  samples.forEach((s, i) => {
    if (!marked[i]) return;
    const from = Math.max(0, s.at - SAMPLE / 2),
      to = Math.min(index.total, s.at + SAMPLE / 2);
    const last = ranges.at(-1);
    if (last && from <= last.to + 1e-6) last.to = to;
    else ranges.push({ from, to, kind: 'repeated', repeated: true });
  });
  return ranges.filter((r) => r.to - r.from >= MIN_RANGE);
}

/** How far apart two passes of the same road may be for weather labels. */
const PASS_NEAR = 50;
export type Pass = 'outbound' | 'return';

/**
 * Which pass over a road used both ways a point belongs to: `return` when an
 * earlier part of the track (at least 200 m before) runs within 50 m of it in
 * the opposite direction, `outbound` when a later part does, otherwise null.
 * Uses the same direction rule as the out-and-back lines.
 */
export function passOf(
  index: TrackIndex,
  distance: number,
  coord: Coord,
  bearing: number | null | undefined,
): Pass | null {
  if (bearing === null || bearing === undefined || !index.edges.length)
    return null;
  let later = false;
  for (let at = 0; at <= index.total; at += SAMPLE) {
    if (Math.abs(at - distance) < MIN_APART) continue;
    const point = pointAtDistance(index, at)!;
    if (
      point.bearing !== null &&
      angleBetween(point.bearing, bearing) > OPPOSITE &&
      meters(point.coord, coord) <= PASS_NEAR
    ) {
      if (at < distance) return 'return';
      later = true;
    }
  }
  return later ? 'outbound' : null;
}

const passCache = new WeakMap<Route, Map<string, Pass | null>>();
/** Passes of weather samples on a route, computed once per route and sample. */
export function weatherPasses(
  route: Route,
  samples: { distance: number; coord: Coord; bearing?: number | null }[],
): (Pass | null)[] {
  let known = passCache.get(route);
  if (!known) {
    known = new Map();
    passCache.set(route, known);
  }
  let index: TrackIndex | null = null;
  return samples.map((s) => {
    const key = `${s.distance}|${s.bearing}`;
    if (!known.has(key)) {
      index ??= indexTrack(route.segments);
      known.set(key, passOf(index, s.distance, s.coord, s.bearing));
    }
    return known.get(key)!;
  });
}

const cache = new WeakMap<Route, Range[]>();
/** Repeated ranges of a route, computed once per route object. */
export function repeatsFor(route: Route): Range[] {
  let ranges = cache.get(route);
  if (!ranges) {
    ranges = repeatedRanges(route.segments);
    cache.set(route, ranges);
  }
  return ranges;
}

/** Splits ranges at repeated-stretch boundaries, flagging the repeated parts. */
export function splitByRepeat(ranges: Range[], repeated: Range[]): Range[] {
  const out: Range[] = [];
  for (const range of ranges) {
    let position = range.from;
    for (const r of repeated) {
      if (r.to <= position || r.from >= range.to) continue;
      if (r.from > position)
        out.push({ ...range, from: position, to: r.from, repeated: false });
      const end = Math.min(range.to, r.to);
      out.push({
        ...range,
        from: Math.max(position, r.from),
        to: end,
        repeated: true,
      });
      position = end;
    }
    if (position < range.to)
      out.push({ ...range, from: position, to: range.to, repeated: false });
  }
  return out;
}

/** Distance between direction arrows on screen (CSS pixels). */
const ARROW_SPACING = 90;
const ARROW = 'route-arrow';

/**
 * The route as drawn: one piece per stretch, those travelled twice in
 * opposite directions flagged, so they draw as offset parallel lines.
 */
export function routePieces(
  route: Route,
): { repeated: boolean; coords: Coord[] }[] {
  const repeated = repeatsFor(route);
  if (!repeated.length)
    return route.segments.map((coords) => ({ repeated: false, coords }));
  const total = route.segments.reduce(
    (sum, s) => sum + s.slice(1).reduce((n, c, i) => n + meters(s[i], c), 0),
    0,
  );
  return sliceByRanges(
    route.segments,
    splitByRepeat([{ from: 0, to: total, kind: 'route' }], repeated),
  ).map(({ repeated, coords }) => ({ repeated, coords }));
}

/** A white chevron pointing along the line (right), with a dark halo. */
function arrowImage(): ImageData {
  const size = 28;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(11, 7);
    ctx.lineTo(18, 14);
    ctx.lineTo(11, 21);
    ctx.stroke();
  };
  ctx.strokeStyle = '#0b2f27';
  ctx.lineWidth = 7;
  path();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3.5;
  path();
  return ctx.getImageData(0, 0, size, size);
}
const isOn = (key: PreferenceKey, fallback: boolean) => {
  const value = readPreference(key);
  return value === null ? fallback : value === 'true';
};

export function setupRouteMarks(
  map: PlannerMap,
  deps: { route: () => Route | null },
) {
  map.image(ARROW, arrowImage);
  // Arrows along the route line, on the offset pass lines where it is
  // travelled both ways; MapLibre spaces them and keeps them on screen.
  const setLines = map.overlay('rg-marks', RANK.marks, () => [
    {
      id: 'rg-arrows',
      type: 'symbol',
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ARROW_SPACING,
        'icon-image': ARROW,
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-offset': [
          'case',
          ['get', 'repeated'],
          ['literal', [0, PASS_OFFSET]],
          ['literal', [0, 0]],
        ],
      },
    },
  ]);
  const settings = {
    arrows: isOn(PREFERENCE.routeArrows, true),
    weather: isOn(PREFERENCE.weatherMarkers, true),
  };
  // Hiding weather icons keeps the cards and the forecast, and takes the
  // markers out of focus and screen readers too.
  const showWeather = () =>
    map.container.classList.toggle('hide-weather', !settings.weather);
  showWeather();

  const group = document.createElement('div');
  group.className = 'marks-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'marks-heading');
  const heading = document.createElement('p');
  heading.id = 'marks-heading';
  heading.className = 'coloring-heading';
  heading.textContent = 'Route marks';
  group.append(heading);
  for (const [id, key, label] of [
    ['arrows', PREFERENCE.routeArrows, 'Direction arrows'],
    ['weather', PREFERENCE.weatherMarkers, 'Weather on the map'],
  ] as const) {
    const wrapper = document.createElement('label');
    wrapper.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `marks-${id}`;
    input.setAttribute('role', 'menuitemcheckbox');
    input.checked = settings[id];
    input.setAttribute('aria-checked', String(input.checked));
    const text = document.createElement('span');
    text.textContent = label;
    input.onchange = () => {
      settings[id] = input.checked;
      input.setAttribute('aria-checked', String(input.checked));
      writePreference(key, String(input.checked));
      showWeather();
      draw();
    };
    wrapper.append(input, text);
    group.append(wrapper);
  }
  $('layers-menu').append(group);

  function draw() {
    const route = deps.route();
    setLines(
      route && settings.arrows
        ? routePieces(route).map(({ repeated, coords }) =>
            lineFeature(coords, { repeated }),
          )
        : [],
    );
  }
  return { refresh: draw };
}
