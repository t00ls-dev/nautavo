import type { BrowserContext, Page } from '@playwright/test';

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
/** Answer every OSRM route request with `osrmAnswer`. */
export async function mockOsrm(
  target: Page | BrowserContext,
  options?: Parameters<typeof osrmAnswer>[1],
) {
  await target.route('**/route/v1/driving/**', (r) =>
    r.fulfill({ json: osrmAnswer(r.request().url(), options) }),
  );
}

/** The `[lat, lon]` of every track point of a GPX text, in order. */
export const gpxPoints = (xml: string): number[][] =>
  [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
