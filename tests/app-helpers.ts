import type { BrowserContext, Page } from '@playwright/test';
import { defaults, encodeState } from '../src/core';
import { encodePolyline } from '../src/road-attributes';

/** The development server Playwright starts (playwright.config.ts). */
export const base = 'http://127.0.0.1:5173/';
/** The production preview the service worker tests use. */
export const previewBase = 'http://127.0.0.1:4175/';

/** The points ([lon, lat]) of an OSRM route request URL. */
export function osrmPoints(url: string): number[][] {
  return new URL(url).pathname
    .split('/driving/')[1]!
    .split(';')
    .map((p) => p.split(',').map(Number));
}
/** An OSRM answer that goes straight through the requested points. */
export function osrmAnswer(
  url: string,
  {
    distance = 42000,
    duration = 2940,
    legs = [] as unknown[],
  }: { distance?: number; duration?: number; legs?: unknown[] } = {},
) {
  const coords = osrmPoints(url);
  return {
    code: 'Ok',
    waypoints: coords.map((location) => ({ location, distance: 0 })),
    routes: [{ distance, duration, geometry: { coordinates: coords }, legs }],
  };
}
/**
 * A Valhalla `/route` answer that goes straight through the requested
 * locations, one leg between each pair, with the totals of `osrmAnswer`
 * and the names and references of its steps, when given.
 */
export function valhallaAnswer(
  url: string,
  {
    distance = 42000,
    duration = 2940,
    legs: steps = [] as unknown[],
  }: Parameters<typeof osrmAnswer>[1] = {},
) {
  const { locations } = JSON.parse(new URL(url).searchParams.get('json')!) as {
    locations: { lat: number; lon: number }[];
  };
  const legs = locations.slice(1).map((to, i) => {
    const from = locations[i],
      length = distance / 1000 / (locations.length - 1),
      time = duration / (locations.length - 1);
    return {
      shape: encodePolyline([
        [from.lat, from.lon],
        [to.lat, to.lon],
      ]),
      maneuvers: [
        ...((
          steps[i] as
            | { steps?: { name?: string; ref?: string; distance: number }[] }
            | undefined
        )?.steps?.map((s, n) => ({
          type: n ? 9 : 1,
          length: s.distance / 1000,
          time,
          begin_shape_index: 0,
          street_names: [s.name, s.ref].filter(Boolean),
        })) ?? [{ type: 1, length, time, begin_shape_index: 0 }]),
        { type: 4, length: 0, time: 0, begin_shape_index: 1 },
      ],
    };
  });
  return {
    trip: {
      status: 0,
      summary: { length: distance / 1000, time: duration },
      legs,
    },
  };
}
/**
 * The app with no points and Prefer main roads off, so OSRM routes first:
 * for specs whose OSRM mock carries the maneuvers they test.
 */
export const osrmFirst = () => {
  const state = defaults();
  state.prefer = false;
  return base + encodeState(state);
};
/** The number of points of an OSRM or Valhalla route request, else null. */
export function routedPoints(url: string): number | null {
  if (url.includes('/route/v1/driving/')) return osrmPoints(url).length;
  const json = /\/route\?json=/.test(url)
    ? new URL(url).searchParams.get('json')
    : null;
  return json
    ? (JSON.parse(json) as { locations: unknown[] }).locations.length
    : null;
}
/**
 * Answer every route request: OSRM with `osrmAnswer` and Valhalla's
 * `/route` (asked first with Prefer main roads) with `valhallaAnswer`.
 */
export async function mockRouting(
  target: Page | BrowserContext,
  options?: Parameters<typeof osrmAnswer>[1],
) {
  await target.route('**/route/v1/driving/**', (r) =>
    r.fulfill({ json: osrmAnswer(r.request().url(), options) }),
  );
  await target.route(/\/route\?json=/, (r) =>
    r.fulfill({ json: valhallaAnswer(r.request().url(), options) }),
  );
}

/** The `[lat, lon]` of every track point of a GPX text, in order. */
export const gpxPoints = (xml: string): number[][] =>
  [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
