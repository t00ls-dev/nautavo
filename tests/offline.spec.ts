import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASEMAP_STYLE } from './map-helpers';
import {
  previewBase as base,
  osrmAnswer,
  exportAs,
  saveRoute,
  setLanguage,
  openSavedRoutes,
} from './app-helpers';
// Without a connection, an open page keeps working with what it has; these
// tests use the production preview started by playwright.config.ts, where the
// retired service worker (src/sw.ts) is built.
const start = '-22.930929, -43.238286',
  end = '-23.050160, -43.535240';

/** Mocks every public service at the context. Routing fails like a real network while `network.offline` is set. */
const network = { offline: false, routing: 0 };
async function mockServices(context: BrowserContext) {
  network.offline = false;
  network.routing = 0;
  await context.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await context.route('**/route/v1/driving/**', async (r) => {
    network.routing++;
    if (network.offline) return r.abort('internetdisconnected');
    await r.fulfill({
      json: osrmAnswer(r.request().url(), {
        legs: [
          {
            steps: [
              {
                name: 'Main road',
                distance: 42000,
                duration: 2940,
                maneuver: { type: 'depart' },
              },
            ],
          },
        ],
      }),
    });
  });
}

async function goOffline(context: BrowserContext, offline: boolean) {
  network.offline = offline;
  await context.setOffline(offline);
}

/** A routed pair of points, ready to download. */
async function routedPair(page: Page) {
  await setLanguage(page, 'en');
  await page.locator('#location-0').fill(start);
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
}

test('the preview redirects .html and trailing-slash pages to their public URL, as Cloudflare does', async ({
  request,
}) => {
  for (const [from, to] of [
    ['index.html', base],
    ['help.html?lang=pt', base + 'help?lang=pt'],
    ['changelog.html', base + 'changelog'],
    ['help/', base + 'help'],
  ]) {
    const response = await request.get(base + from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(307);
    expect(new URL(response.headers().location, base).href, from).toBe(to);
  }
});

test('a browser that installed the former service worker is released from it and its cache', async ({
  page,
  context,
}) => {
  await mockServices(context);
  // The former app shell: a worker that caches the page and answers it.
  const former = `
    self.addEventListener('install', (e) => e.waitUntil(
      caches.open('nautavo-shell-0000000000000000')
        .then((c) => c.add('/')).then(() => self.skipWaiting())));
    self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', (e) => e.respondWith(
      caches.match(e.request).then((r) => r || fetch(e.request))));`;
  await context.route('**/former-sw.js', (r) =>
    r.fulfill({ body: former, contentType: 'text/javascript' }),
  );
  await page.goto(base + 'changelog');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/former-sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toEqual(['nautavo-shell-0000000000000000']);
  // The next visit removes it: no worker left and no cache.
  await page.goto(base);
  await expect
    .poll(() =>
      page.evaluate(async () => ({
        workers: (await navigator.serviceWorker.getRegistrations()).length,
        caches: await caches.keys(),
      })),
    )
    .toEqual({ workers: 0, caches: [] });
});

test('the retired service worker deletes the caches and removes itself', async ({
  page,
  context,
}) => {
  await mockServices(context);
  await page.goto(base);
  await page.evaluate(async () => {
    await caches.open('nautavo-shell-0000000000000000');
    await navigator.serviceWorker.register('/sw.js');
  });
  await expect
    .poll(() =>
      page.evaluate(async () => ({
        workers: (await navigator.serviceWorker.getRegistrations()).length,
        caches: await caches.keys(),
      })),
    )
    .toEqual({ workers: 0, caches: [] });
});

test('a saved route opens without a connection, without routing requests, and downloads', async ({
  page,
  context,
}) => {
  await mockServices(context);
  await page.goto(base);
  await routedPair(page);
  await page.locator('#route-name').fill('Offline route');
  await saveRoute(page);
  await expect(page.locator('#saved-count')).toHaveText('(1)');

  await goOffline(context, true);
  let routing = 0;
  context.on('request', (r) => {
    if (r.url().includes('/route/v1/')) routing++;
  });
  await openSavedRoutes(page);
  await page
    .getByRole('button', {
      name: 'Open saved route: Offline route',
      exact: true,
    })
    .click();
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#summary')).toContainText('42 km');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  expect(download.suggestedFilename()).toBe('offline-route.gpx');
  expect(routing).toBe(0);
});

for (const width of [320, 1280])
  test(`the offline notice fits the panel at ${width} px in both languages`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockServices(context);
    await page.goto(base);
    await context.setOffline(true);
    for (const language of ['en', 'pt']) {
      await setLanguage(page, language);
      const notice = page.locator('#offline-notice');
      await expect(notice).toBeVisible();
      const fit = await notice.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const panel = element.closest('aside')!.getBoundingClientRect();
        return {
          inside:
            box.left >= panel.left - 0.5 && box.right <= panel.right + 0.5,
          noOverflow: element.scrollWidth <= element.clientWidth,
        };
      });
      expect(fit).toEqual({ inside: true, noOverflow: true });
    }
  });

test('Calculate route without a connection keeps the route on screen and its download', async ({
  page,
  context,
}) => {
  await mockServices(context);
  await page.goto(base);
  // A planned route needs no button (#296); an imported track shows it.
  await routedPair(page);
  await expect(page.locator('#calculate')).toBeHidden();
  await page.locator('#import').setInputFiles('docs/example.gpx');
  await expect(page.locator('#calculate')).toBeVisible();
  await goOffline(context, true);
  const before = network.routing;
  await page.locator('#calculate').click();
  await expect(page.locator('#status')).toHaveText(
    'No connection. The route on screen is kept; calculate it again when you are back online.',
  );
  await expect(page.locator('#status')).not.toHaveClass(/error/);
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#summary')).toBeVisible();
  expect(network.routing).toBe(before);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
});

test('a route edited without a connection is calculated once when it returns', async ({
  page,
  context,
}) => {
  await mockServices(context);
  await page.goto(base);
  await routedPair(page);
  await goOffline(context, true);
  await page.locator('#location-1').fill('-23.000000, -43.400000');
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#status')).toHaveText(
    'No connection. The route will be calculated when the connection returns.',
    { timeout: 15000 },
  );
  await expect(page.locator('#download')).toBeDisabled();
  // No raw browser wording such as "Failed to fetch" reaches the panel.
  await expect(page.locator('#status')).not.toContainText('fetch');
  const before = network.routing;
  await goOffline(context, false);
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#status')).toHaveText('Route ready.');
  expect(network.routing - before).toBe(1);
});

test('map tiles that failed without a connection are asked again, once, when it returns', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockServices(context);
  const tiles = {
    loaded: 0,
    failed: new Set<string>(),
    retried: [] as string[],
  };
  await context.route('https://tiles.openfreemap.org/**', (r) => {
    const url = r.request().url();
    if (url.includes('/styles/')) return r.fulfill({ json: BASEMAP_STYLE });
    if (network.offline) {
      tiles.failed.add(url);
      return r.abort('internetdisconnected');
    }
    if (tiles.failed.has(url)) tiles.retried.push(url);
    tiles.loaded++;
    return r.fulfill({ status: 204 });
  });
  await page.goto(base);
  // The production build exposes no map object: its first tiles mean ready.
  await page.locator('#map canvas.maplibregl-canvas').waitFor();
  await expect.poll(() => tiles.loaded).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  await goOffline(context, true);
  // Moved while offline: the tiles of the new area fail.
  const map = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(map.x + map.width - 100, map.y + map.height / 2);
  await page.mouse.down();
  await page.mouse.move(map.x + 100, map.y + map.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => tiles.failed.size).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(tiles.retried).toHaveLength(0);
  await goOffline(context, false);
  await expect.poll(() => tiles.retried.length).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  // Each failed tile is asked once more, never in a loop.
  expect(new Set(tiles.retried).size).toBe(tiles.retried.length);
  expect(tiles.retried.every((url) => tiles.failed.has(url))).toBe(true);
});
