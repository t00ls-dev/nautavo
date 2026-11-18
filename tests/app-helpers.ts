import { expect, type BrowserContext, type Page } from '@playwright/test';
import { defaults, encodeState } from '../src/core';
import { encodePolyline } from '../src/road-attributes';
import { REGION_PATH } from '../src/region';

/** The development server Playwright starts (playwright.config.ts). */
export const base = 'http://127.0.0.1:5173/';
/** The production preview the service worker tests use. */
export const previewBase = 'http://127.0.0.1:4175/';

/** The site's approximate-region endpoint (src/worker.ts) as a route pattern. */
export const regionRoute = `**${REGION_PATH}`;
/** An answer of that endpoint: Paris, as Cloudflare would place a visitor. */
export const parisRegion = { city: 'Paris', latitude: 48.85, longitude: 2.35 };
/** Answers the region endpoint with `answer`, or as unavailable without one. */
export async function mockRegion(page: Page, answer?: object) {
  await page.route(regionRoute, (r) =>
    answer ? r.fulfill({ json: answer }) : r.fulfill({ status: 503 }),
  );
}

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

/**
 * Waits until an element's box stops moving or resizing, before positions
 * are measured or touches aimed at it: the phone's bottom sheet after a point
 * field raises or lowers it, the point rows as the summary above them fills.
 */
export async function boxSettled(page: Page, selector: string) {
  let last = '';
  await expect
    .poll(
      async () => {
        const box = await page.locator(selector).boundingBox();
        const now = JSON.stringify(
          box && [box.x, box.y, box.width, box.height].map(Math.round),
        );
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [100] },
    )
    .toBe(true);
}

/**
 * A saved route or favorite as the app's IndexedDB holds it (`route-gpx`,
 * store `routes` or `favorites`), or null when there is none.
 */
export function libraryEntry(
  page: Page,
  store: 'routes' | 'favorites',
  id: string,
): Promise<unknown> {
  return page.evaluate(
    ([name, key]) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('route-gpx');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction(name).objectStore(name).get(key);
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            db.close();
            resolve(read.result ?? null);
          };
        };
      }),
    [store, id] as const,
  );
}

/**
 * Opens Settings with its Advanced section expanded (#211): the servers,
 * satellite imagery, IP region and JSON editor, and Apply servers.
 */
export async function openAdvancedSettings(page: Page) {
  await page.locator('#open-settings').click();
  const advanced = page.locator('.settings-advanced');
  if ((await advanced.getAttribute('open')) === null)
    await advanced.locator('> summary').click();
}
