import { test, expect, type Page, type Route } from '@playwright/test';
import { BASEMAP_STYLE, mockBasemap, mapCanvas } from './map-helpers';
import { readFile } from 'node:fs/promises';
import { base, openAdvancedSettings } from './app-helpers';
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.fulfill({ status: 204 }));
  await mockBasemap(page);
  await page.route('https://ipwho.is/**', (r) => r.fulfill({ status: 503 }));
});
/** Requests of the base map, by kind. */
function watchBasemap(page: Page) {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/openfreemap|maps\.eox|elevation-tiles/.test(r.url()))
      requests.push(r.url());
  });
  return {
    requests,
    has: (pattern: string) => requests.some((url) => url.includes(pattern)),
  };
}
const canvas = (page: Page) => page.locator('#map canvas.maplibregl-canvas');

test('draws one vector map, loads only the selected layer, updates credits and keeps layer preferences out of route state', async ({
  page,
}) => {
  const watch = watchBasemap(page);
  await page.goto(base);
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => watch.has('/planet/')).toBe(true);
  expect(watch.has('eox.at') || watch.has('elevation-tiles')).toBe(false);
  await expect(page.locator('#map-no-style')).toBeHidden();
  await expect(page.locator('.map-credits-dialog')).toContainText(
    'OpenFreeMap',
  );
  const hash = new URL(page.url()).hash;
  watch.requests.length = 0;
  await page.locator('#layers-toggle').click();
  await page
    .getByRole('menuitemradio', { name: 'Topographic', exact: true })
    .click();
  await expect(page.locator('.map-credits-dialog')).toContainText(
    'Terrain Tiles',
  );
  await expect
    .poll(() => watch.has('elevation-tiles-prod/terrarium'))
    .toBe(true);
  expect(watch.has('eox.at')).toBe(false);
  // Terrain may still be loading here on a busy machine (it is still the
  // layer shown); that terrain stops after a switch is checked
  // deterministically by the "leaving Topographic" tests below.
  watch.requests.length = 0;
  await page.locator('#layers-toggle').click();
  await page
    .getByRole('menuitemradio', { name: 'Satellite', exact: true })
    .click();
  // The 2025 edition is the default; its license is in the credits.
  await expect(page.locator('.map-credits-dialog')).toContainText(
    'EOxCloudless',
  );
  await expect(page.locator('.map-credits-dialog')).toContainText(
    'Copernicus Sentinel data 2025',
  );
  await expect.poll(() => watch.has('s2cloudless-2025_3857')).toBe(true);
  expect(watch.has('overlay_bright')).toBe(false);
  expect(new URL(page.url()).hash).toBe(hash);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute(
    'data-map-layer',
    'satellite',
  );
  await expect(page.locator('.map-credits-dialog')).toContainText(
    'OpenFreeMap',
  );
  await expect(page.locator('.map-credits-dialog')).toContainText(
    'OpenStreetMap',
  );
  watch.requests.length = 0;
  await openAdvancedSettings(page);
  await page.locator('#satellite-vintage').selectOption('2016');
  await expect(page.locator('.map-credits-dialog')).toContainText(
    '2016 & 2017',
  );
  await expect.poll(() => watch.has('s2cloudless_3857')).toBe(true);
  await page.reload();
  await expect(page.locator('.map-credits-dialog')).toContainText(
    '2016 & 2017',
  );
  await expect(page.locator('#satellite-vintage')).toHaveValue('2016');
});

for (const [layer, attribute] of [
  ['Standard', 'standard'],
  ['Satellite', 'satellite'],
] as const)
  test(`leaving Topographic for ${layer} stops its terrain requests`, async ({
    page,
  }) => {
    // The first terrain tiles load, so neighbors are asked for too; the rest
    // are held until after the switch.
    let started = 0,
      finished = 0;
    const held: Route[] = [];
    await page.route(
      'https://s3.amazonaws.com/elevation-tiles-prod/**',
      async (r) => {
        if (++started <= 6) return r.fallback();
        held.push(r);
      },
    );
    page.on('requestfinished', (r) => {
      if (r.url().includes('elevation-tiles')) finished++;
    });
    await page.goto(base);
    await expect(canvas(page)).toBeVisible();
    await page.locator('#layers-toggle').click();
    await page
      .getByRole('menuitemradio', { name: 'Topographic', exact: true })
      .click();
    await expect.poll(() => held.length).toBeGreaterThan(4);
    await expect.poll(() => finished).toBe(6);
    await page.locator('#layers-toggle').click();
    await page.getByRole('menuitemradio', { name: layer, exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute(
      'data-map-layer',
      attribute,
    );
    // Requests the browser sent before the switch can reach the test a
    // little later on a busy machine; count from after them.
    await page.waitForTimeout(1000);
    const asked = started;
    // Answers that come late for a layer no longer shown are not used, and
    // start no new terrain request.
    for (const r of held)
      await r.fallback().catch(() => {
        /* Aborted with the layer. */
      });
    await page.waitForTimeout(1500);
    expect(started).toBe(asked);
    expect(finished).toBe(6);
  });
test('the first load draws at half resolution, then at the screen resolution', async ({
  browser,
}) => {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(context);
  // Tiles held back keep the first load from finishing.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await context.route('https://tiles.openfreemap.org/planet/**', async (r) => {
    await held;
    await r.fulfill({ status: 204 });
  });
  const page = await context.newPage();
  const ratio = () =>
    canvas(page).evaluate(
      (el: HTMLCanvasElement) =>
        Math.round((el.width / el.clientWidth) * 100) / 100,
    );
  await page.goto(base);
  await expect(canvas(page)).toBeVisible();
  expect(await ratio()).toBe(0.5);
  release();
  await expect.poll(ratio).toBe(2);
  await context.close();
});
test('without the style or WebGL the route still draws with a notice', async ({
  page,
}) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort());
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(base);
  await expect(page.locator('#map-no-style')).toBeVisible();
  await page.locator('#import').setInputFiles('docs/example.gpx');
  await expect(page.locator('.route-marker').first()).toBeVisible();
  // The longer Portuguese notice stays clear of the hint and the map tools.
  await page.locator('#language').selectOption('pt');
  const notice = (await page.locator('#map-no-style').boundingBox())!;
  for (const selector of ['#map-note', '#locate', '#layers-toggle']) {
    const other = (await page.locator(selector).boundingBox())!;
    expect(
      notice.x + notice.width <= other.x ||
        notice.y >= other.y + other.height ||
        notice.y + notice.height <= other.y,
    ).toBe(true);
  }
  await page.locator('#language').selectOption('en');
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.reload();
  await expect(page.locator('#map-no-gl')).toBeVisible();
  await expect(page.locator('#map-no-style')).toBeHidden();
  // The tools of a map that cannot be drawn are hidden; Undo stays (#216).
  for (const tool of [
    '#layers-toggle',
    '#locate',
    '#fullscreen',
    '#lock',
    '#fit',
    '#map-note',
  ])
    await expect(page.locator(tool)).toBeHidden();
  await expect(page.locator('#undo')).toBeVisible();
  await page.locator('#language').selectOption('pt');
  await expect(page.locator('#map-no-gl')).toContainText(
    'Este navegador não consegue desenhar o mapa',
  );
});
test('a style that failed loads once more when the connection returns', async ({
  page,
}) => {
  let styles = 0;
  await page.route('https://tiles.openfreemap.org/styles/**', (r) => {
    styles++;
    return r.abort();
  });
  await page.goto(base);
  await expect(page.locator('#map-no-style')).toBeVisible();
  expect(styles).toBe(1);
  await page.unroute('https://tiles.openfreemap.org/styles/**');
  await page.route('https://tiles.openfreemap.org/styles/**', (r) => {
    styles++;
    return r.fulfill({ json: BASEMAP_STYLE });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#map-no-style')).toBeHidden();
  await expect(canvas(page)).toBeVisible();
  expect(styles).toBe(2);
  // Once loaded, another online event asks for nothing.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(300);
  expect(styles).toBe(2);
});
test('menu works by keyboard, closes outside and translates both ways', async ({
  page,
}) => {
  await page.goto(base);
  await page.locator('#layers-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitemradio', { name: 'Standard', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute(
    'data-map-layer',
    'topographic',
  );
  await expect(page.locator('#layers-menu')).toBeHidden();
  await page.locator('#layers-toggle').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers-toggle')).toBeFocused();
  await page.locator('#layers-toggle').click();
  await page.locator('#fit').click();
  await expect(page.locator('#layers-menu')).toBeHidden();
  await page.locator('#language').selectOption('pt');
  await expect(page.locator('#layers-toggle')).toContainText('Camadas do mapa');
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#layers-toggle')).toContainText('Map layers');
});
test('blocked localStorage does not prevent layer switching', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }),
  );
  await page.goto(base);
  await page.locator('#layers-toggle').click();
  await page
    .getByRole('menuitemradio', { name: 'Satellite', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-map-layer',
    'satellite',
  );
  await expect(canvas(page)).toBeVisible();
});
test('mobile layers stay accessible without overlapping other map controls or the sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(base);
  const box = (await page.locator('#layers-toggle').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  for (const selector of ['#locate', '#fullscreen', '#panel-toggle', '#lock']) {
    const other = (await page.locator(selector).boundingBox())!;
    expect(
      box.x + box.width <= other.x ||
        box.x >= other.x + other.width ||
        box.y + box.height <= other.y ||
        box.y >= other.y + other.height,
    ).toBe(true);
  }
  await page.locator('#layers-toggle').click();
  const menu = (await page.locator('#layers-menu').boundingBox())!,
    sheet = (await page.locator('#panel-toggle').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  expect(menu.y + menu.height).toBeLessThanOrEqual(sheet.y);
  await page
    .getByRole('menuitemradio', { name: 'Satellite', exact: true })
    .click();
  // Satellite always shows the map's labels: no switch and no notice.
  await page.locator('#layers-toggle').click();
  await expect(page.locator('#map-labels')).toHaveCount(0);
  await expect(page.locator('#layers-menu')).not.toContainText('2025 imagery');
});
test('GPX bytes remain identical across map layers and saved state contains no layer choice', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-03T00:00:00Z'));
  await page.goto(base);
  await page.locator('#import').setInputFiles('docs/example.gpx');
  await expect(page.locator('#download')).toBeEnabled();
  let original: string | undefined;
  for (const name of ['Standard', 'Topographic', 'Satellite']) {
    await page.locator('#layers-toggle').click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#download').click(),
    ]);
    const xml = await readFile((await download.path())!, 'utf8');
    if (!original) original = xml;
    else expect(xml).toBe(original);
  }
  await page.locator('#route-name').fill('Layer-independent');
  await page.locator('#save-route').click();
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('#open-settings')
      .click()
      .then(() => page.locator('#backup-routes').click()),
  ]);
  const data = JSON.parse(await readFile((await backup.path())!, 'utf8'));
  expect(JSON.stringify(data)).not.toContain('map-layer');
  expect(JSON.stringify(data)).not.toContain('satellite-vintage');
});

test('satellite overzoom enlarges native level 14 imagery instead of requesting missing levels', async ({
  page,
}) => {
  const zooms: number[] = [];
  page.on('request', (request) => {
    const match = request.url().match(/GoogleMapsCompatible\/(\d+)\//);
    if (match) zooms.push(Number(match[1]));
  });
  await page.goto(base);
  await page.locator('#import').setInputFiles({
    name: 'near.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx><trk><trkseg><trkpt lat="38.72" lon="-9.14"/><trkpt lat="38.72001" lon="-9.14001"/></trkseg></trk></gpx>',
    ),
  });
  await page.locator('#layers-toggle').click();
  await page
    .getByRole('menuitemradio', { name: 'Satellite', exact: true })
    .click();
  await expect.poll(() => zooms.includes(14)).toBe(true);
  await page.locator('.map-zoom-in').click();
  await page.waitForTimeout(500);
  expect(Math.max(...zooms)).toBe(14);
});

test('switching layers immediately after a nearby GPX import keeps its route framed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { value: ['pt-BR'] });
  });
  await page.goto(base);
  await page.locator('#import').setInputFiles('docs/example.gpx');
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#layers-toggle').click();
  await page.locator('[data-layer=satellite]').click();
  const bounds = (await page.locator('#map').boundingBox())!;
  const sheet = (await page.locator('#route-panel').boundingBox())!;
  await expect
    .poll(async () =>
      page.locator('.route-marker').evaluateAll(
        (markers, limit) =>
          markers.length === 7 &&
          markers.every((marker) => {
            const box = marker.getBoundingClientRect();
            return (
              box.left >= limit.left &&
              box.right <= limit.right &&
              box.top >= 44 &&
              box.bottom <= limit.bottom
            );
          }),
        {
          left: bounds.x,
          right: bounds.x + bounds.width - 55,
          bottom: sheet.y,
        },
      ),
    )
    .toBe(true);
});
test('GPX import during a running zoom takes precedence over that view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  // Phones have no zoom buttons; the map keyboard shortcut starts the same zoom.
  await mapCanvas(page).press('+');
  await page.locator('#import').setInputFiles('docs/example.gpx');
  await expect(page.locator('#download')).toBeEnabled();
  const bounds = (await page.locator('#map').boundingBox())!;
  await expect
    .poll(async () => {
      const marker = await page.locator('.route-marker').first().boundingBox();
      return (
        marker !== null &&
        marker.x >= bounds.x &&
        marker.x + marker.width <= bounds.x + bounds.width
      );
    })
    .toBe(true);
});
