import { expect, type BrowserContext, type Page } from '@playwright/test';

/** 256 px tiles: Terrarium sea level for terrain, a green field for imagery. */
const TERRAIN_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAB+0lEQVR42u3TQQkAAAjAwEU3un8reHAJBmsK3pIAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgAJMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAyAASTAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADADHAnGpB4FDLHHvAAAAAElFTkSuQmCC';
const IMAGERY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACAElEQVR42u3TMQ0AAAgEsRfGjBz8j8xooEkVXHKpaXgrEmAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAOogAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAANgABUwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA8C1RXcOEeTrLbsAAAAASUVORK5CYII=';
/** OpenFreeMap's style reduced to its two kinds of layers, on empty tiles. */
export const BASEMAP_STYLE = {
  version: 8,
  sources: {
    openmaptiles: {
      type: 'vector',
      tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'],
      maxzoom: 14,
    },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e3ecea' },
    },
    {
      id: 'road_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
    },
    {
      id: 'label_city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: { 'text-field': ['get', 'name:en'] },
    },
  ],
};

/**
 * Serves the base map without the network: the style, empty vector tiles and
 * plain imagery and terrain tiles. Register after any catch-all route.
 */
export async function mockBasemap(target: Page | BrowserContext) {
  await target.route('https://tiles.openfreemap.org/**', (route) =>
    route.request().url().includes('/styles/')
      ? route.fulfill({ json: BASEMAP_STYLE })
      : route.fulfill({ status: 204 }),
  );
  await target.route('https://tiles.maps.eox.at/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(IMAGERY_PNG, 'base64'),
    }),
  );
  await target.route(
    'https://s3.amazonaws.com/elevation-tiles-prod/**',
    (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(TERRAIN_PNG, 'base64'),
      }),
  );
}
export async function holdMap(page: Page, x = 205, y = 245) {
  await mapReady(page);
  const box = (await page.locator('#map').boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + x, y: box.y + y }],
  });
  await page.waitForTimeout(550);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await session.detach();
}

/** Waits for the planner map, which loads after the first painted frame. */
export async function mapReady(page: Page) {
  await page.locator('#map canvas.maplibregl-canvas').waitFor();
  await page.waitForFunction(() =>
    (
      window as unknown as {
        plannerMap: { gl(): { loaded(): boolean } | null };
      }
    ).plannerMap
      .gl()
      ?.loaded(),
  );
}
/** The planner map's canvas: the map's keyboard focus target. */
export const mapCanvas = (page: Page) =>
  page.locator('#map canvas.maplibregl-canvas');
/** Waits until the planner map has stopped moving or zooming. */
export async function mapIdle(page: Page) {
  await page.waitForFunction(() => {
    const gl = (
      window as unknown as {
        plannerMap: { gl(): { isMoving(): boolean } | null };
      }
    ).plannerMap.gl();
    return !!gl && !gl.isMoving();
  });
}
/**
 * Properties of the features an overlay of the planner map draws (its
 * GeoJSON source): `rg-route`, `rg-coloring`, `rg-marks`, `rg-surface` or
 * `rg-climb`. Empty before the map exists.
 */
export function overlayFeatures(
  page: Page,
  source: string,
): Promise<Record<string, unknown>[]> {
  return page.evaluate((id) => {
    const gl = (
      window as unknown as {
        plannerMap: {
          gl(): {
            getSource(id: string):
              | {
                  serialize(): {
                    data: { features: { properties: object }[] };
                  };
                }
              | undefined;
          } | null;
        };
      }
    ).plannerMap.gl();
    const data = gl?.getSource(id)?.serialize().data;
    return (data?.features ?? []).map(
      (f) => f.properties as Record<string, unknown>,
    );
  }, source);
}
/** Kinds of route coloring drawn on the planner map. */
export async function coloringKinds(page: Page): Promise<string[]> {
  return (await overlayFeatures(page, 'rg-coloring')).map((f) =>
    String(f.kind),
  );
}
/** Number of lines an overlay draws (a highlighted stretch, the coloring). */
export async function overlayCount(page: Page, source: string) {
  return (await overlayFeatures(page, source)).length;
}
/**
 * Closes the route panel on a phone and waits until the fitted route is
 * framed again in the map it uncovers, so the map then stays put.
 */
export async function closePanel(page: Page) {
  const marker = page.locator('.route-marker').first();
  const before = (await marker.boundingBox())!.y;
  await page.locator('#panel-toggle').click();
  await expect
    .poll(async () => (await marker.boundingBox())!.y)
    .not.toBe(before);
  await mapIdle(page);
}

/**
 * One-finger touches through the browser's own touch events, each stamped
 * with the script's time, not the moment a busy renderer accepts it:
 * MapLibre and the app time taps by the event's timeStamp, and under load
 * the real gaps outgrew the 500 ms double tap (#272). The clock follows the
 * script's pauses and catches up with real time at each gesture, so it
 * never runs ahead of it.
 */
export async function scriptedTouches(page: Page) {
  const session = await page.context().newCDPSession(page);
  let clock = 0;
  const gesture = () => {
    clock = Math.max(clock, Date.now() / 1000);
  };
  const pause = async (ms: number) => {
    clock += ms / 1000;
    await page.waitForTimeout(ms);
  };
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    x: number,
    y: number,
  ) => {
    clock += 0.001;
    return session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      timestamp: clock,
    });
  };
  /** A quick double tap at one point, as MapLibre counts it. */
  const doubleTap = async (x: number, y: number) => {
    gesture();
    await touch('touchStart', x, y);
    await touch('touchEnd', x, y);
    await pause(80);
    await touch('touchStart', x, y);
    await touch('touchEnd', x, y);
  };
  return { session, gesture, pause, touch, doubleTap };
}
