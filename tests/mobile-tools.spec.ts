import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { holdMap, mockBasemap, BASEMAP_STYLE, mapCanvas } from './map-helpers';
import { base, gpxPoints, mockRegion } from './app-helpers';
const features = {
  features: [
    {
      properties: { name: 'Lisboa', country: 'Portugal' },
      geometry: { type: 'Point', coordinates: [-9.14, 38.72] },
    },
    {
      properties: { name: 'Porto' },
      geometry: { type: 'Point', coordinates: [-8.6, 41.1] },
    },
  ],
};
const coords = Array.from({ length: 1000 }, (_, i) => [
  -22.9 - i * 0.0001,
  -43.1 - i * 0.0001,
]);
const gpx = `<gpx><trk><trkseg>${coords.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk></gpx>`;
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(page);
  await mockRegion(page);
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({ json: features }),
  );
});
test('on a phone, map taps and holds never set route points', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('**/*', async (r) => {
    if (r.request().url().startsWith('http://127.0.0.1')) await r.continue();
    else await r.fulfill({ status: 204 });
  });
  await page.goto(base);
  // No hint to set points on the map: phones type them or move markers.
  await expect(page.locator('#map-note')).toBeHidden();
  await page.touchscreen.tap(205, 245);
  await expect(page.locator('.route-marker')).toHaveCount(0);
  // A separate gesture: a hold right after a tap is the one-finger zoom.
  await page.waitForTimeout(400);
  await holdMap(page);
  const menu = page.locator('#point-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Elevation here']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('.route-marker')).toHaveCount(0);
  await expect(page.locator('#points li')).toHaveCount(2);
  await context.close();
});
test('point menu supports desktop keyboard and Escape', async ({ page }) => {
  await page.goto(base);
  await mapCanvas(page).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('#point-menu')).toBeVisible();
  const elevation = page
    .locator('#point-menu')
    .getByRole('menuitem', { name: 'Elevation here' });
  await expect(elevation).toBeFocused();
  // The only item: the arrow keys keep it focused.
  await page.keyboard.press('ArrowDown');
  await expect(elevation).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#point-menu')).toBeHidden();
});
test('autocomplete selects by keyboard and explicitly falls back to Nominatim after failure', async ({
  page,
}) => {
  let nominatim = 0;
  await page.route('**/search?**', (r) => {
    nominatim++;
    return r.fulfill({
      json: [{ display_name: 'Fallback city', lat: '41', lon: '-8' }],
    });
  });
  await page.goto(base);
  await page.locator('#location-0').fill('Lisboa');
  await expect(
    page.locator('#suggestions-0 [role=option].suggestion-place'),
  ).toHaveCount(2);
  // My location and Choose on map come first.
  for (let i = 0; i < 3; i++)
    await page.locator('#location-0').press('ArrowDown');
  await page.locator('#location-0').press('Enter');
  await expect(page.locator('#location-0')).toHaveValue('Lisboa, Portugal');
  expect(nominatim).toBe(0);
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({ status: 503 }),
  );
  await page.locator('#location-1').fill('Other city');
  await expect(page.locator('#status')).toContainText(
    'Suggestions unavailable',
  );
  expect(nominatim).toBe(0);
  await page.locator('#location-1').press('Enter');
  await expect(page.locator('#point-results-1 button')).toHaveCount(1);
  expect(nominatim).toBe(1);
});
test('old autocomplete request is aborted and cannot replace newer suggestions', async ({
  page,
}) => {
  let oldStarted!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let aborted = false;
  page.on('requestfailed', (r) => {
    if (r.url().includes('q=Older')) aborted = true;
  });
  await page.route('https://photon.komoot.io/**', async (r) => {
    if (new URL(r.request().url()).searchParams.get('q') === 'Older') {
      oldStarted();
      await pending;
    }
    await r.fulfill({ json: features });
  });
  await page.goto(base);
  await page.locator('#location-0').fill('Older');
  await started;
  await page.locator('#location-0').fill('Newer');
  release();
  await expect(
    page.locator('#suggestions-0 [role=option].suggestion-place'),
  ).toHaveCount(2);
  await expect.poll(() => aborted).toBe(true);
});
test('full geometry survives drawing and share uses the same GPX and custom filename', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {
      value: (data: ShareData) => data.files?.[0].type === 'application/xml',
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files![0];
        Object.assign(window, {
          sharedGpx: {
            name: file.name,
            type: file.type,
            xml: await file.text(),
            title: data.title,
          },
        });
      },
    });
  });
  await page.goto(base);
  await page.locator('#import').setInputFiles({
    name: 'dense.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#route-name').fill('Custom file');
  await page.locator('#share-gpx').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { sharedGpx?: { name: string } }).sharedGpx
            ?.name,
      ),
    )
    .toBe('custom-file.gpx');
  const shared = await page.evaluate(
    () =>
      (window as unknown as { sharedGpx: { xml: string; type: string } })
        .sharedGpx,
  );
  expect(shared.type).toBe('application/xml');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  const xml = await readFile((await download.path())!, 'utf8');
  expect(gpxPoints(xml)).toEqual(coords);
  expect(gpxPoints(shared.xml)).toEqual(coords);
  await page.locator('.map-zoom-in').click();
  const [after] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  expect(gpxPoints(await readFile((await after.path())!, 'utf8'))).toEqual(
    coords,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Cancelled', 'AbortError')),
    }),
  );
  const status = await page.locator('#status').textContent();
  await page.locator('#share-gpx').click();
  await expect(page.locator('#status')).toHaveText(status!);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      value: () =>
        Promise.reject(new DOMException('Unavailable', 'NotAllowedError')),
    }),
  );
  // Any other failure downloads the same file instead.
  const [fallback] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#share-gpx').click(),
  ]);
  expect(fallback.suggestedFilename()).toBe('custom-file.gpx');
  await expect(page.locator('#status')).toHaveText('GPX downloaded.');
});
test('sharing is hidden without file support', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'canShare', { value: undefined }),
  );
  await page.goto(base);
  await expect(page.locator('#share-gpx')).toBeHidden();
});

for (const width of [320, 390]) {
  test(`destination and stop suggest while typing without a search button at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    await expect(
      page.locator('.point-location-form button:not(.point-grip)'),
    ).toHaveCount(0);
    await page.locator('#location-1').fill('Li');
    await expect(
      page.locator('#suggestions-1 [role=option].suggestion-place'),
    ).toHaveCount(0);
    await page.locator('#location-1').pressSequentially('sboa');
    await expect(
      page.locator('#suggestions-1 [role=option].suggestion-place'),
    ).toHaveCount(2);
    await expect(page.locator('#status')).toHaveText('Choose a place.');
    await page
      .locator('#suggestions-1 [role=option].suggestion-place')
      .first()
      .click();
    await expect(page.locator('#location-1')).toHaveValue('Lisboa, Portugal');
    await page.locator('#add').click();
    await page.locator('#location-1').fill('Porto');
    await expect(
      page.locator('#suggestions-1 [role=option].suggestion-place'),
    ).toHaveCount(2);
    for (let i = 0; i < 4; i++)
      await page.locator('#location-1').press('ArrowDown');
    await page.locator('#location-1').press('Enter');
    await expect(page.locator('#location-1')).toHaveValue('Porto');
    await expect(page.locator('#location-2')).toHaveValue('Lisboa, Portugal');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
}

test('empty suggestions offer an explicit Enter search and translate both ways', async ({
  page,
}) => {
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({ json: { features: [] } }),
  );
  await page.goto(base);
  await page.locator('#location-1').fill('Nowhere');
  await expect(page.locator('#status')).toHaveText(
    'No suggestions found. Press Enter to search addresses.',
  );
  await page.locator('#language').selectOption('pt');
  await expect(page.locator('#status')).toHaveText(
    'Nenhuma sugestão encontrada. Pressione Enter para buscar endereços.',
  );
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#status')).toHaveText(
    'No suggestions found. Press Enter to search addresses.',
  );
});
test('long press on the map cannot start a native text selection, but the panel can', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('**/*', async (r) => {
    if (r.request().url().startsWith('http://127.0.0.1')) await r.continue();
    else await r.fulfill({ status: 204 });
  });
  await page.goto(base);
  const result = await page.evaluate(() => {
    const select = (node: Node) => {
      const event = new Event('selectstart', {
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const map = document.getElementById('map')!;
    const label = document.createElement('span');
    label.textContent = 'Map text';
    map.append(label);
    return {
      mapStyle: getComputedStyle(map).userSelect,
      panelStyle: getComputedStyle(document.getElementById('route-panel')!)
        .userSelect,
      mapText: select(label.firstChild!),
      panelText: select(document.querySelector('#route-panel h1')!.firstChild!),
    };
  });
  expect(result).toEqual({
    mapStyle: 'none',
    panelStyle: 'auto',
    mapText: true,
    panelText: false,
  });
  // Page selection is off only while a finger is on the map.
  const box = (await page.locator('#map').boundingBox())!;
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 150, y: box.y + 200 }],
  });
  await expect(page.locator('html')).toHaveClass(/map-touching/);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(page.locator('html')).not.toHaveClass(/map-touching/);
  await session.detach();
  await page.waitForTimeout(400);
  // The nautavo point menu still opens on hold.
  await holdMap(page);
  await expect(page.locator('#point-menu')).toBeVisible();
  await context.close();
});
test('one-finger zoom: double tap and drag down zooms in, up zooms out, without the point menu', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const zooms: number[] = [];
  await page.route('**/*', async (r) => {
    const url = r.request().url();
    const tile = url.match(/openfreemap\.org\/planet\/(\d+)\//);
    if (tile) zooms.push(Number(tile[1]));
    if (url.startsWith('http://127.0.0.1')) await r.continue();
    else if (url.includes('openfreemap.org/styles/'))
      await r.fulfill({ json: BASEMAP_STYLE });
    else await r.fulfill({ status: 204 });
  });
  await page.goto(base);
  await expect.poll(() => zooms.length).toBeGreaterThan(0);
  const box = (await page.locator('#map').boundingBox())!;
  const x = box.x + 160,
    y = box.y + 200;
  const session = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty = y) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }],
    });
  const quickZoom = async (dy: number) => {
    await touch('touchStart');
    await touch('touchEnd');
    await page.waitForTimeout(80);
    await touch('touchStart');
    for (let step = 1; step <= 10; step++) {
      await touch('touchMove', y + (dy * step) / 10);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(600); // Longer than the point menu's long press.
    await touch('touchEnd');
    await page.waitForTimeout(400);
  };
  const zoom = () =>
    page.evaluate(() =>
      (
        window as unknown as { plannerMap: { getZoom(): number } }
      ).plannerMap.getZoom(),
    );
  const before = await zoom();
  await quickZoom(300);
  await expect.poll(zoom).toBeGreaterThanOrEqual(before + 2);
  await expect(page.locator('#point-menu')).toBeHidden();
  const zoomedIn = await zoom();
  await quickZoom(-300);
  await expect.poll(zoom).toBeLessThanOrEqual(zoomedIn - 2);
  await expect(page.locator('#point-menu')).toBeHidden();
  const start = await zoom();
  // Tap, then hold still: still the zoom gesture, never the point menu.
  await touch('touchStart');
  await touch('touchEnd');
  await page.waitForTimeout(80);
  await touch('touchStart');
  await page.waitForTimeout(800);
  await expect(page.locator('#point-menu')).toBeHidden();
  await touch('touchEnd');
  // Released without dragging: one level in, like a double tap.
  await expect
    .poll(async () => Math.round(await zoom()))
    .toBe(Math.round(start) + 1);
  // A single long press still opens it.
  await touch('touchStart');
  await page.waitForTimeout(700);
  await touch('touchEnd');
  await expect(page.locator('#point-menu')).toBeVisible();
  await session.detach();
  await context.close();
});

// A touch device that can share files, as Firefox for iOS, which drops a
// download's name: every export shares a named file instead.
const shareMock = () => {
  Object.defineProperty(navigator, 'canShare', { value: () => true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (data: ShareData) => {
      const shared = ((window as unknown as { shared?: string[] }).shared ??=
        []);
      // Only the file: iOS saves a title or text as a second, text file.
      if (Object.keys(data).join() !== 'files')
        throw new Error('Share only the file');
      shared.push(`${data.files![0].name} ${data.files![0].type}`);
    },
  });
};
const sharedFiles = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { shared?: string[] }).shared);
for (const language of ['en', 'pt'] as const)
  test(`on a touch device that can share files, exports share named files (${language})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
    await mockBasemap(page);
    await page.addInitScript(shareMock);
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.goto(base);
    if (language === 'pt') await page.locator('#language').selectOption('pt');
    const label = language === 'pt' ? 'Compartilhar GPX' : 'Share GPX';
    await expect(page.locator('#download')).toHaveAccessibleName(label);
    await page.locator('#import').setInputFiles({
      name: 'dense.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(gpx),
    });
    await expect(page.locator('#download')).toBeEnabled();
    // The name is in More actions, where Share GPX merged into the main action.
    await page.locator('#more-actions').click();
    await expect(page.locator('#share-gpx')).toBeHidden();
    await page.locator('#route-name').fill('Shared ride');
    await page.locator('#route-name').press('Tab');
    await page.locator('#download').click();
    await expect
      .poll(() => sharedFiles(page))
      .toEqual(['shared-ride.gpx application/gpx+xml']);
    // Saved routes and the backup share too.
    await page.locator('#save-route').click();
    await expect(page.locator('#saved-count')).toHaveText('(1)');
    await page.locator('.saved-routes > summary').click();
    await page
      .getByRole('button', {
        name:
          language === 'pt'
            ? 'Compartilhar rota salva: Shared ride'
            : 'Share saved route: Shared ride',
        exact: true,
      })
      .click();
    await page.locator('#open-settings').click();
    await expect(page.locator('#backup-routes')).toHaveText(
      language === 'pt' ? 'Compartilhar backup' : 'Share backup',
    );
    await page.locator('#backup-routes').click();
    await expect
      .poll(async () => (await sharedFiles(page))?.slice(1))
      .toEqual([
        'shared-ride.gpx application/gpx+xml',
        expect.stringMatching(
          /^nautavo-backup-\d{4}-\d\d-\d\d\.json application\/json$/,
        ),
      ]);
    expect(downloads).toBe(0);
    await context.close();
  });

test('a touch device without file sharing keeps Download GPX', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(page);
  await page.goto(base);
  await expect(page.locator('#download')).toHaveAccessibleName('Download GPX');
  await expect(page.locator('#backup-routes')).toHaveText('Export backup');
  await page.locator('#import').setInputFiles({
    name: 'dense.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  await context.close();
});

for (const width of [320, 360, 390, 430, 760])
  for (const language of ['en', 'pt'] as const)
    test(`Share GPX keeps its label on one line at ${width}px in ${language}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
      await mockBasemap(page);
      await page.addInitScript(shareMock);
      await page.goto(base);
      if (language === 'pt') await page.locator('#language').selectOption('pt');
      const button = page.locator('#download');
      await expect(button).toHaveAccessibleName(
        language === 'pt' ? 'Compartilhar GPX' : 'Share GPX',
      );
      // The GPX button on the bar, and the backup button in Settings.
      const fits = (target: Locator) =>
        target.evaluate((e) => {
          const label = e.querySelector('.button-label') ?? e;
          const range = document.createRange();
          range.selectNodeContents(label);
          const lines = new Set(
            [...range.getClientRects()].map((r) => Math.round(r.top)),
          );
          return lines.size <= 1 && e.scrollWidth <= e.clientWidth + 1;
        });
      expect(await fits(button)).toBe(true);
      await page.locator('#open-settings').click();
      await expect(page.locator('#backup-routes')).toBeVisible();
      expect(await fits(page.locator('#backup-routes'))).toBe(true);
      await context.close();
    });
