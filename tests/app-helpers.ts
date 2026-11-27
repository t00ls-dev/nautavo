import { expect, type BrowserContext, type Page } from '@playwright/test';
import { defaults, encodeState } from '../src/core';
import { encodePolyline } from '../src/road-attributes';
import { REGION_PATH } from '../src/region';
import { LIBRARY_DATABASE } from '../src/saved-routes';

/** The development server Playwright starts (playwright.config.ts). */
export const base = 'http://127.0.0.1:5173/';
/** The production preview the offline tests use. */
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
    .split('/driving/')[1]
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
 * A saved route or favorite as the app's IndexedDB holds it (store `routes`
 * or `favorites`), or null when there is none; without `id`, every entry of
 * the store.
 */
export function libraryEntry(
  page: Page,
  store: 'routes' | 'favorites',
  id?: string,
): Promise<unknown> {
  return page.evaluate(
    ([database, name, key]) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB request failed'));
        request.onsuccess = () => {
          const db = request.result;
          const objects = db.transaction(name).objectStore(name);
          const read = key === null ? objects.getAll() : objects.get(key);
          read.onerror = () =>
            reject(read.error ?? new Error('IndexedDB request failed'));
          read.onsuccess = () => {
            db.close();
            resolve(read.result ?? null);
          };
        };
      }),
    [LIBRARY_DATABASE, store, id ?? null] as const,
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

/**
 * Pairs of shown elements, among those the selectors match, whose boxes
 * overlap; an element inside another does not count.
 */
export function overlapping(page: Page, selectors: string[]) {
  return page.evaluate((selectors) => {
    const name = (e: Element) => e.id || e.className.toString();
    const shown = [...document.querySelectorAll(selectors.join(','))].filter(
      (e) => e.checkVisibility() && e.getBoundingClientRect().width > 0,
    );
    const hits: string[] = [];
    shown.forEach((a, i) => {
      const p = a.getBoundingClientRect();
      for (const b of shown.slice(i + 1)) {
        const q = b.getBoundingClientRect();
        if (
          !a.contains(b) &&
          !b.contains(a) &&
          p.left < q.right &&
          q.left < p.right &&
          p.top < q.bottom &&
          q.top < p.bottom
        )
          hits.push(`${name(a)} over ${name(b)}`);
      }
    });
    return hits;
  }, selectors);
}

/** Shown controls inside `scope` that something else covers at their center. */
export function coveredControls(page: Page, scope: string) {
  return page.evaluate((scope) => {
    const covered: string[] = [];
    for (const control of document.querySelectorAll(
      `${scope} button, ${scope} input, ${scope} select`,
    )) {
      const r = control.getBoundingClientRect();
      if (!control.checkVisibility() || !r.width) continue;
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      if (!hit || !control.contains(hit))
        covered.push(control.id || control.className.toString());
    }
    return covered;
  }, scope);
}

/** An action of the Export menu (#301): opens the menu, then chooses it. */
export async function exportAs(
  page: Page,
  id: 'download' | 'download-tcx' | 'download-fit' | 'share-gpx' | 'share',
) {
  if (await page.locator('#export-menu').isHidden())
    await page.locator('#export').click();
  await page.locator(`#${id}`).click();
}

/**
 * Save route (#301): opens the save sheet, types `name` when given (it is
 * filled with the route's name) and confirms.
 */
export async function saveRoute(page: Page, name?: string) {
  await page.locator('#save-route').click();
  if (name !== undefined) await page.locator('#save-name').fill(name);
  await page.locator('#save-confirm').click();
}

/**
 * Opens Trip options, which folds into one line once a route shows (#303),
 * so its departure, speed and road choice can be changed.
 */
export async function openTripOptions(page: Page) {
  const options = page.locator('#trip-options');
  if ((await options.getAttribute('open')) === null)
    await options.locator('> summary').click();
}

/**
 * Chooses the interface language: in Settings on the planner page (#304),
 * opened and closed around the choice unless it is already open, and in the
 * header of the help and What's new pages.
 */
export async function setLanguage(page: Page, language: string) {
  const dialog = page.locator('#settings-dialog');
  const opens =
    (await dialog.count()) > 0 &&
    !(await dialog.evaluate((d) => (d as HTMLDialogElement).open));
  if (opens) await page.locator('#open-settings').click();
  await page.locator('#language').selectOption(language);
  if (opens) await page.locator('#close-settings').click();
}

type RouteTab = 'points' | 'itinerary' | 'weather-section' | 'elevation';
/**
 * Opens one of the route's tabs (#305); on wide screens Elevation is no tab
 * but the strip under the map, opened by its button.
 */
export async function openTab(page: Page, id: RouteTab) {
  const { width, height } = page.viewportSize()!;
  if (id === 'elevation' && width >= 760 && height > 500) {
    const strip = page.locator('#elevation');
    await expect(strip.locator('> summary')).toBeVisible();
    if ((await strip.getAttribute('open')) === null)
      await strip.locator('> summary').click();
    return;
  }
  await page.locator(`#tab-${id}`).click();
}

/** Travel the route: in More actions on phones, below the actions on wide screens (#305). */
export async function travelRoute(page: Page) {
  if (await page.locator('#travel-route').isHidden())
    await page.locator('#more-actions').click();
  await page.locator('#travel-route').click();
}

/** Opens Saved routes, listed below the points on the empty planner too (#306). */
export async function openSavedRoutes(page: Page) {
  const list = page.locator('.saved-routes');
  if ((await list.getAttribute('open')) === null)
    await list.locator('> summary').click();
}
