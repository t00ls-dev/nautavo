import {
  holdMap,
  mapCanvas,
  mapIdle,
  mapReady,
  mockBasemap,
  overlayFeatures,
} from './map-helpers';
import {
  defaults,
  encodeState,
  encodeStateV1,
  readTrackFile,
} from '../src/core';
import { readFile } from 'node:fs/promises';
import { Fit, le, name, recordFields, semi } from './fit-fixture';
import { test, expect, type Page, type Route } from '@playwright/test';
import { chooseUnits, setSpeed } from './unit-settings';
import {
  base,
  mockRouting,
  osrmAnswer,
  osrmPoints,
  valhallaAnswer,
  libraryEntry,
  routedPoints,
  openAdvancedSettings,
  mockRegion,
  exportAs,
  saveRoute,
  setLanguage,
  mapTool,
  openTab,
  undo,
  openSavedRoutes,
} from './app-helpers';
const start = '-22.930929, -43.238286',
  end = '-23.050160, -43.535240';
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
});
async function setup(page: Page) {
  await mockBasemap(page);
  await mockRouting(page, {
    legs: [
      {
        steps: [
          {
            name: 'Main road',
            ref: 'BR-101',
            distance: 42000,
            duration: 2940,
            maneuver: { type: 'depart' },
          },
        ],
      },
    ],
  });
  await page.goto(base);
  await setLanguage(page, 'en');
  await mapReady(page);
}
async function fillPair(page: Page) {
  await page.locator('#location-0').fill(start);
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
}
for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile points' : 'desktop points', () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    test('typing two coordinate pairs creates a route, then undo restores the prior point', async ({
      page,
    }) => {
      await setup(page);
      await expect(page.locator('#location-0')).toBeVisible();
      await expect(page.locator('#location-1')).toBeVisible();
      await fillPair(page);
      await expect(page.locator('.route-marker')).toHaveCount(2);
      await expect(page.locator('#summary')).toContainText('42 km');
      // The automatic departure (next half hour) also gives an arrival.
      // Distance, ascent (asked on a tap) and the arrival with the time (#302).
      await expect(page.locator('#summary dt')).toHaveText([
        'Distance',
        'Ascent',
        'Arrival',
      ]);
      // Our own estimate from the default 20 km/h, never the router's 49 min.
      await expect(page.locator('#trip-line')).toContainText(
        '20 km/h, no stops',
      );
      await expect(page.locator('#summary')).toContainText('2h 6 min');
      // The route's analyses, in the order of their tabs (#305); on wide
      // screens Elevation is the strip under the map.
      expect(
        await page
          .locator('#route-details > *')
          .evaluateAll((rows) => rows.map((row) => row.id)),
      ).toEqual(
        mobile
          ? [
              'itinerary',
              'weather-section',
              'elevation',
              'surface',
              'daylight-details',
            ]
          : ['itinerary', 'weather-section', 'surface', 'daylight-details'],
      );
      await expect(page.locator('#itinerary .chips')).toHaveText('BR-101');
      await expect(page.locator('#itinerary summary')).toHaveText(
        'Itinerary (1)',
      );
      await undo(page);
      await expect(page.locator('#location-1')).toHaveValue('');
      await expect(page.locator('#location-0')).toHaveValue(start);
      await expect(page.locator('#download')).toBeDisabled();
      await expect(page.locator('.route-marker')).toHaveCount(1);
    });
    test('desktop map clicks fill start and destination', async ({ page }) => {
      test.skip(mobile, 'Phones set points by typing or moving markers.');
      await setup(page);
      await page.locator('#map').click({ position: { x: 130, y: 95 } });
      await expect(page.locator('#location-0')).not.toHaveValue('');
      await expect(page.locator('#location-1')).toHaveValue('');
      await page.locator('#map').click({ position: { x: 210, y: 140 } });
      await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
      await expect(page.locator('.route-marker')).toHaveCount(2);
      // With every point set, a stray click moves nothing (#295) and the
      // hint leaves; choosing a point's number sets it with the next click.
      await expect(page.locator('#map-note')).toBeHidden();
      const first = await page.locator('#location-0').inputValue();
      await page.locator('#map').click({ position: { x: 170, y: 220 } });
      await page.waitForTimeout(300);
      await expect(page.locator('#location-0')).toHaveValue(first);
      await page.getByRole('button', { name: 'Select point 1' }).click();
      await expect(page.locator('#map-note')).toHaveText(
        'Set the start on the map',
      );
      await mapIdle(page);
      await page.locator('#map').click({ position: { x: 170, y: 220 } });
      await expect(page.locator('#location-0')).not.toHaveValue(first);
      await expect(page.locator('#map-note')).toBeHidden();
    });
    test('the edit lock blocks route edits while viewing and download keep working', async ({
      page,
    }) => {
      let routeRequests = 0;
      page.on('request', (request) => {
        if (request.url().includes('/route/v1/driving/')) routeRequests++;
      });
      await setup(page);
      await fillPair(page);
      const requestsBefore = routeRequests;
      await expect(page.locator('.map-marker-draggable')).toHaveCount(2);

      await mapTool(page, 'lock');
      await expect(page.locator('#lock')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.locator('#lock-notice')).toBeVisible();
      await expect(page.locator('#location-0')).toHaveJSProperty(
        'readOnly',
        true,
      );
      for (const id of ['add', 'reverse', 'roundtrip', 'undo', 'calculate'])
        await expect(page.locator(`#${id}`)).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Remove point 2' }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Move point 2', exact: true }),
      ).toBeDisabled();
      await expect(page.locator('#import')).toBeDisabled();
      await expect(page.locator('#apply-json')).toBeDisabled();
      await expect(page.locator('.map-marker-draggable')).toHaveCount(0);

      // The point menu keeps only the elevation query, which is not an edit.
      if (mobile) await holdMap(page);
      else
        await page
          .locator('#map')
          .click({ button: 'right', position: { x: 210, y: 140 } });
      const menu = page.locator('#point-menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['Elevation here']);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      // Map gestures that would place points report the lock instead.
      if (!mobile) {
        await page.locator('#map').click({ position: { x: 130, y: 95 } });
        await page.locator('body').press('Control+z');
        await expect(page.locator('#status')).toHaveText(
          'Route locked. Unlock editing to change it.',
        );
      }
      await expect(page.locator('#point-menu')).toBeHidden();
      await expect(page.locator('#location-0')).toHaveValue(start);
      await expect(page.locator('#location-1')).toHaveValue(end);

      // Viewing and export stay available.
      if (mobile) await mapCanvas(page).press('+');
      else await page.locator('.map-zoom-in').click();
      await page.locator('#fit').click();
      const download = page.waitForEvent('download');
      await exportAs(page, 'download');
      await download;
      expect(routeRequests).toBe(requestsBefore);

      await page.locator('#unlock').click();
      await expect(page.locator('#lock')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(page.locator('#lock-notice')).toBeHidden();
      await expect(page.locator('#location-0')).toHaveJSProperty(
        'readOnly',
        false,
      );
      await expect(page.locator('.map-marker-draggable')).toHaveCount(2);
      // Lock toggles are not undo steps: undo still reverts the last edit.
      await undo(page);
      await expect(page.locator('#location-1')).toHaveValue('');
      await expect(page.locator('#location-0')).toHaveValue(start);
    });
  });
}
test('route marks: arrows by default, parallel lines on a round trip, persisted and translated', async ({
  page,
}) => {
  let routes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/route/v1/driving/')) routes++;
  });
  await setup(page);
  await fillPair(page);
  // A typed route is not framed on its own; arrows are drawn in view.
  await page.locator('#fit').click();
  const arrows = async () => (await overlayFeatures(page, 'rg-marks')).length;
  const passes = async () =>
    (await overlayFeatures(page, 'rg-route')).filter((f) => f.repeated).length;
  await expect.poll(arrows).toBeGreaterThan(0);
  expect(await passes()).toBe(0);
  // Round trip: the mocked router returns the same straight road back.
  await page.locator('#roundtrip').click();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  // The road out and the road back: one offset line each.
  await expect.poll(passes).toBe(2);
  const before = routes;
  await page.locator('#layers-toggle').click();
  await expect(page.locator('#marks-heading')).toHaveText('Route marks');
  await expect(page.locator('#marks-arrows')).toBeChecked();
  // The halfway point was removed: no switch for it.
  await expect(page.locator('#marks-halfway')).toHaveCount(0);
  await page.locator('#marks-arrows').uncheck();
  await expect.poll(arrows).toBe(0);
  await page.keyboard.press('Escape');
  // Device preferences: kept across reloads, never in the link.
  expect(new URL(page.url()).hash).not.toMatch(/arrows/);
  expect(routes).toBe(before);
  await page.reload();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await mapReady(page);
  expect(await arrows()).toBe(0);
  await setLanguage(page, 'pt');
  await page.locator('#layers-toggle').click();
  await expect(page.locator('#marks-heading')).toHaveText('Marcas da rota');
  await expect(page.locator('label:has(#marks-arrows)')).toHaveText(
    'Setas de direção',
  );
  await page.locator('#marks-arrows').check();
  await expect.poll(arrows).toBeGreaterThan(0);
});
test('address searches belong to their own point and do not fire while typing', async ({
  page,
}) => {
  let searches = 0;
  await page.route('**/search?**', async (r) => {
    searches++;
    const q = new URL(r.request().url()).searchParams.get('q')!;
    const isStart = q.includes('Uruguai');
    await r.fulfill({
      json: [
        {
          display_name: isStart
            ? 'Metrô Uruguai, Rio de Janeiro'
            : 'Grumari, Rio de Janeiro',
          lat: isStart ? '-22.930929' : '-23.050160',
          lon: isStart ? '-43.238286' : '-43.535240',
        },
      ],
    });
  });
  await setup(page);
  await page.locator('#location-0').fill('Metrô Uruguai');
  await page.locator('#location-1').fill('Grumari');
  expect(searches).toBe(0);
  await page.locator('#location-0').press('Enter');
  await page.locator('#point-results-0 button').click();
  await expect(page.locator('#location-0')).toHaveValue(
    'Metrô Uruguai, Rio de Janeiro',
  );
  await expect(page.locator('#location-1')).toHaveValue('Grumari');
  await page.locator('#location-1').press('Enter');
  // An Enter result reads like a suggestion (#214): pin, name, the rest of
  // the address and the distance from the start, in the same card.
  const result = page.locator('#point-results-1 button');
  await expect(result).toHaveClass(/suggestion-place/);
  await expect(result.locator('svg')).toHaveCount(1);
  await expect(result.locator('b')).toHaveText('Grumari');
  await expect(result.locator('small')).toHaveText('Rio de Janeiro');
  await expect(result.locator('em')).toHaveText(/km/);
  await expect(result).toHaveAttribute(
    'aria-label',
    /^Grumari, Rio de Janeiro, .+km/,
  );
  await result.click();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  expect(searches).toBe(2);
});
test('a failed route says so in plain words and offers Try again', async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  const answer = (r: Route, json: unknown) =>
    fail ? r.fulfill({ status: 503 }) : r.fulfill({ json });
  await page.route('**/route/v1/driving/**', (r) =>
    answer(r, osrmAnswer(r.request().url())),
  );
  await page.route(/\/route\?json=/, (r) =>
    answer(r, valhallaAnswer(r.request().url())),
  );
  await page.locator('#location-0').fill(start);
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#status')).toHaveText(
    'Could not calculate the route right now. Check the points or try again.',
    { timeout: 15000 },
  );
  await expect(page.locator('#calculate')).toHaveText('Try again');
  fail = false;
  await page.locator('#calculate').click();
  await expect(page.locator('#status')).toHaveText('Route ready.', {
    timeout: 15000,
  });
  // A route ready again needs no button (#296).
  await expect(page.locator('#calculate')).toBeHidden();
});
test('the status names the point still to set', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#status')).toHaveText(
    'Set your start and destination.',
  );
  await page.locator('#location-0').fill(start);
  await page.locator('#location-0').press('Tab');
  await expect(page.locator('#status')).toHaveText('Set your destination.');
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await page.locator('#add').click();
  await expect(page.locator('#status')).toHaveText('Set point 2.');
  await setLanguage(page, 'pt');
  await expect(page.locator('#status')).toHaveText('Defina o ponto 2.');
});
test('undo restores a moved marker and a removed stop', async ({ page }) => {
  await setup(page);
  await fillPair(page);
  // A typed route is not framed on its own; bring the marker into view.
  await page.locator('#fit').click();
  const original = await page.locator('#location-0').inputValue();
  const marker = page.locator('.route-marker').first();
  await marker.scrollIntoViewIfNeeded();
  const box = await marker.boundingBox();
  await page.mouse.move(box!.x + 15, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 45, box!.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#location-0')).not.toHaveValue(original);
  await undo(page);
  await expect(page.locator('#location-0')).toHaveValue(original);
  await page.locator('#add').click();
  await expect(page.locator('#points li')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Remove point 2', exact: true })
    .click();
  await expect(page.locator('#points li')).toHaveCount(2);
  await undo(page);
  await expect(page.locator('#points li')).toHaveCount(3);
});
/**
 * Three steps with OSRM's maneuvers, which answers as the fallback when
 * Valhalla fails; registered after `setup`, so it overrides the shared mock.
 */
async function mockSteps(page: Page, roads = ['Rua A', 'Rua B', 'Rua C']) {
  await page.route(/\/route\?json=/, (r) => r.abort());
  await page.route('**/route/v1/driving/**', async (r) => {
    const coords = osrmPoints(r.request().url());
    const step = (name: string, maneuver: object) => ({
      name,
      distance: 1000,
      duration: 60,
      maneuver,
    });
    await r.fulfill({
      json: osrmAnswer(r.request().url(), {
        distance: 3000,
        duration: 180,
        legs: [
          {
            steps: [
              step(roads[0], { type: 'depart', location: coords[0] }),
              {
                ...step(roads[1], {}),
                ref: 'RJ-116',
                maneuver: {
                  type: 'turn',
                  modifier: 'left',
                  location: [
                    (coords[0][0] + coords[1][0]) / 2,
                    (coords[0][1] + coords[1][1]) / 2,
                  ],
                },
              },
              // No location: plain text, positioned by step lengths.
              step(roads[2], { type: 'roundabout', exit: 2 }),
            ],
          },
        ],
      }),
    });
  });
}
test('the itinerary shows turn directions in both languages', async ({
  page,
}) => {
  await setup(page);
  await mockSteps(page);
  await page.goto(base);
  await page.locator('#location-0').fill(start);
  await page.locator('#location-0').press('Tab');
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  // Long local roads: in the Itinerary (#305), the review line goes to the
  // first one.
  await expect(page.locator('#itinerary details')).not.toHaveAttribute(
    'open',
    '',
  );
  await openTab(page, 'itinerary');
  await page.locator('.review-link').click();
  await expect(page.locator('#itinerary details')).toHaveAttribute('open', '');
  await expect(page.locator('#itinerary')).toContainText(
    'Highlighted roads are local sections to review.',
  );
  await expect(
    page.locator('#itinerary li.local-road').first(),
  ).toBeInViewport();
  const items = page.locator('#itinerary li');
  await expect(items).toHaveText([
    'km 0.0 Depart R. A 1 km',
    'km 16.6 Turn left R. B 1 km',
    // No location: placed by the step lengths, but not a map button.
    'km 2.0 Roundabout, exit 2 R. C 1 km',
  ]);
  await expect(items.locator('button.maneuver-link')).toHaveCount(2);
  // The grid lives inside the button (older Safari ignores grid on buttons),
  // so every row starts at its left edge.
  for (const item of await items.locator('.step-item').all()) {
    const offset = await item.evaluate(
      (e) =>
        e.querySelector('.step-row')!.getBoundingClientRect().left -
        e.getBoundingClientRect().left,
    );
    expect(offset).toBeLessThan(8);
  }
  // The highway reference is in the chips, not on the line.
  await expect(page.locator('#itinerary .chips')).toHaveText('RJ-116');
  // Shortened names are display only; the accessible label keeps them whole.
  await expect(items.nth(1).locator('button')).toHaveAttribute(
    'aria-label',
    // Numbers keep their units with a no-break space (`withUnit`).
    'Show on map: km\u00a016.6 · Turn left · RJ-116 · Rua B · 1\u00a0km',
  );
  await expect(items.nth(2).locator('button')).toHaveCount(0);
  // Choosing an instruction centers the map on it, at street zoom.
  await items.nth(1).locator('button').click();
  await expect(page.locator('.maneuver-marker')).toHaveCount(1);
  const view = await page.evaluate(() => {
    const box = document.querySelector('#map')!.getBoundingClientRect();
    const marker = document
      .querySelector('.maneuver-marker')!
      .getBoundingClientRect();
    return {
      dx: Math.abs(marker.x + marker.width / 2 - (box.x + box.width / 2)),
      dy: Math.abs(marker.y + marker.height / 2 - (box.y + box.height / 2)),
    };
  });
  expect(view.dx).toBeLessThan(3);
  expect(view.dy).toBeLessThan(3);
  await chooseUnits(page, { distance: 'imperial' });
  await expect(items.nth(1)).toContainText('mi 10.3');
  await chooseUnits(page, { distance: 'metric' });
  await expect(items.nth(1).locator('svg.icon-maneuver-left')).toHaveCount(1);
  await expect(items.nth(1).locator('svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await setLanguage(page, 'pt');
  await expect(items.nth(1)).toContainText('Vire à esq. R. B');
  await expect(items.nth(2)).toContainText('Rotatória, 2ª saída');
  await setLanguage(page, 'en');
  await expect(items.nth(1)).toContainText('Turn left R. B');
});
for (const language of ['en', 'pt'] as const)
  test(`itinerary steps keep their instruction and length whole at 320px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await setup(page);
    await mockSteps(page, [
      'Avenida Prefeito Dulcídio Cardoso',
      'Estrada Engenheiro Rufino de Almeida Sobrinho',
      'Avenida Presidente Juscelino Kubitschek de Oliveira',
    ]);
    await page.goto(`${base}?lang=${language}`);
    // Miles: the longest lengths.
    await chooseUnits(page, { distance: 'imperial' });
    await page.locator('#location-0').fill(start);
    await page.locator('#location-0').press('Tab');
    await page.locator('#location-1').fill(end);
    await page.locator('#location-1').press('Tab');
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await page.locator('#itinerary summary').dispatchEvent('click');
    await expect(page.locator('#itinerary li')).toHaveCount(3);
    // The road may give way; the instruction and the length never do.
    const cut = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '#itinerary .maneuver, #itinerary .step-length',
        ),
      ]
        .filter((e) => {
          const box = e.getBoundingClientRect(),
            row = e.closest('.step-row')!.getBoundingClientRect();
          return (
            e.scrollWidth > e.clientWidth + 1 || box.right > row.right + 0.5
          );
        })
        .map((e) => e.textContent),
    );
    expect(cut).toEqual([]);
    await expect(page.locator('#itinerary .step-length').first()).toHaveText(
      language === 'pt' ? '0,6 mi' : '0.6 mi',
    );
  });
test('imports FIT and TCX files by content and reports damaged files', async ({
  page,
}) => {
  await setup(page);
  await page.goto(base);
  const fit = new Fit()
    .define(1, 31, [[5, 16, 0x07]])
    .data(1, name('Serra FIT'))
    .define(0, 20, recordFields);
  for (let i = 0; i < 20; i++)
    fit.record(-22.9, -43.2 + i * 0.005, 100 + i * 5);
  fit
    .define(2, 32, [
      [2, 4, 0x85],
      [3, 4, 0x85],
      [6, 16, 0x07],
    ])
    .data(2, le(semi(-22.9), 4), le(semi(-43.15), 4), name('Viewpoint'));
  const bytes = Buffer.from(fit.file());
  await page.locator('#import').setInputFiles({
    name: 'serra.fit',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await expect(page.locator('#status')).toHaveText(
    'Route imported. Edits recalculate only the changed sections.',
  );
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#location-1')).toHaveValue('Viewpoint');
  // Recorded FIT altitude needs no elevation request.
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/elevation')) requests.push(r.url());
  });
  await openTab(page, 'elevation');
  await expect(page.locator('#elevation-stats')).toContainText(
    'Recorded in the imported file.',
  );
  expect(requests).toEqual([]);

  // TCX detected by content even with another extension, in Portuguese.
  await setLanguage(page, 'pt');
  const point = (lon: number) =>
    `<Trackpoint><Position><LatitudeDegrees>-22.95</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint>`;
  await page.locator('#import').setInputFiles({
    name: 'course.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(
      `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>Costa</Name><Track>${point(-43.3)}${point(-43.25)}${point(-43.2)}</Track></Course></Courses></TrainingCenterDatabase>`,
    ),
  });
  await expect(page.locator('#route-name')).toHaveValue('Costa');
  await expect(page.locator('#download')).toBeEnabled();
  // The track check of this import ends first, so its message cannot
  // replace the error below.
  await expect(page.locator('#status')).toHaveText(
    'Rota importada. Alterações recalculam só os trechos alterados.',
  );

  const damaged = Buffer.from(bytes);
  damaged[30] ^= 0xff;
  await page.locator('#import').setInputFiles({
    name: 'damaged.fit',
    mimeType: 'application/octet-stream',
    buffer: damaged,
  });
  await expect(page.locator('#status')).toHaveText(
    'Este arquivo FIT está corrompido (soma de verificação não confere).',
  );
  // The previous route is kept.
  await expect(page.locator('#route-name')).toHaveValue('Costa');
  await expect(page.locator('#download')).toBeEnabled();
});
test('undo restores the geometry of each GPX import, even with equal points', async ({
  page,
}) => {
  await setup(page);
  await page.goto(base);
  const gpx = (lat: number, lon: number) =>
    Buffer.from(
      `<gpx><trk><name>Same trip</name><trkseg><trkpt lat="-22.9" lon="-43.2"/><trkpt lat="${lat}" lon="${lon}"/><trkpt lat="-23" lon="-43.4"/></trkseg></trk></gpx>`,
    );
  const load = async (buffer: Buffer) => {
    await page.locator('#import').setInputFiles({
      name: 'trip.gpx',
      mimeType: 'application/gpx+xml',
      buffer,
    });
    await expect(page.locator('#download')).toBeEnabled();
  };
  await load(gpx(-22.95, -43.3));
  const summaryA = await page.locator('#summary strong').first().innerText();
  await page.locator('#location-0').fill(start);
  await page.locator('#location-0').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await load(gpx(-22.5, -42.8));
  const summaryB = await page.locator('#summary strong').first().innerText();
  expect(summaryB).not.toBe(summaryA);
  await undo(page);
  await undo(page);
  await expect(page.locator('#summary strong').first()).toHaveText(summaryA);
});
test('editing an imported track reroutes only the track around the edit', async ({
  page,
}) => {
  await setup(page);
  const routes: number[] = [];
  page.on('request', (r) => {
    const points = routedPoints(r.url());
    if (points !== null) routes.push(points);
  });
  // A 30 km straight track with a 4 km out-and-back spur in the middle.
  const track = [
    ...Array.from({ length: 150 }, (_, i) => [-22.9, -43.4 + i * 0.002]),
    ...Array.from({ length: 41 }, (_, i) => [
      -22.9 + (20 - Math.abs(20 - i)) * 0.001,
      -43.4 + 150 * 0.002,
    ]),
    ...Array.from({ length: 150 }, (_, i) => [
      -22.9,
      -43.4 + (150 + i) * 0.002,
    ]),
  ];
  await page.locator('#import').setInputFiles({
    name: 'spur.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      `<gpx><trk><name>Spur</name><trkseg>${track.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk></gpx>`,
    ),
  });
  await expect(page.locator('#download')).toBeEnabled();
  // The check against the roads ends with its own status: waited for, so it
  // cannot replace a later one (Settings applied) under load.
  await expect(page.locator('#status')).toHaveText(
    'Route imported. Edits recalculate only the changed sections.',
    { timeout: 15000 },
  );
  const count = await page.locator('#points li').count();
  expect(count).toBeGreaterThan(3);
  // Automatic stops are named by their place on the route (#208), in order.
  const stops = await Promise.all(
    Array.from({ length: count - 2 }, (_, i) =>
      page.locator(`#location-${i + 1}`).inputValue(),
    ),
  );
  for (const stop of stops) expect(stop).toMatch(/^Stop · km\s\d+\.\d$/);
  const kms = stops.map((s) => Number(s.split('km ')[1]));
  expect(kms).toEqual([...kms].sort((a, b) => a - b));
  await setLanguage(page, 'pt');
  await expect(page.locator('#location-1')).toHaveValue(
    /^Parada · km\s\d+,\d$/,
  );
  await setLanguage(page, 'en');

  await page.locator('#route-name').fill('Renamed spur');
  await openAdvancedSettings(page);
  await page.locator('#save-settings').click();
  await expect(page.locator('#status')).toHaveText('Settings applied.');
  await expect(page.locator('#download')).toBeEnabled();

  await page.locator('#location-1').fill('-22.95, -43.39');
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  expect(routes).toEqual([3]);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  const gpx = await readFile(await download.path(), 'utf8');
  const exported = gpx.match(/<trkpt[^>]*\/>/g)!;
  // Every point after the edited stop's next neighbour is the original track.
  expect(exported.slice(-150)).toEqual(
    track.slice(-150).map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"/>`),
  );
  // The router and the point count stay out of the Itinerary (#210).
  await expect(page.locator('#itinerary')).not.toContainText(
    /Valhalla|OSRM|Imported GPX|points/,
  );

  // Undo returns to the renamed step with the exact imported track, no request.
  await undo(page);
  // Restored synchronously: a reroute would leave the download disabled.
  expect(await page.locator('#download').isEnabled()).toBe(true);
  await expect(page.locator('#route-name')).toHaveValue('Renamed spur');
  expect(routes).toEqual([3]);

  // Calculate route matches an imported track to its roads (#173), never
  // reroutes it through its points; without a match the track is kept.
  await page.locator('#calculate').click();
  await expect(page.locator('#status')).toHaveText(
    'The route could not be calculated along the imported track now. The imported track is kept.',
  );
  await expect(page.locator('#download')).toBeEnabled();
  expect(routes).toEqual([3]);
});
test('invalid coordinates cannot enable a stale GPX download', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  await page.locator('#location-1').fill('99, 200');
  await page.locator('#location-1').press('Enter');
  await expect(page.locator('#status')).toHaveClass('error');
  await expect(page.locator('#download')).toBeDisabled();
  await undo(page);
  await expect(page.locator('#location-1')).toHaveValue(end);
});

test('distance units change without rerouting, changing GPX geometry or the link, and stay on the device', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  let routingRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/route/v1/driving/')) routingRequests++;
  });
  const [before] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  const originalGeometry = (await readFile(await before.path(), 'utf8')).match(
    /<trkpt[^>]*\/>/g,
  );
  const hashBefore = page.url();
  await chooseUnits(page, { distance: 'imperial' });
  await expect(page.locator('#summary')).toContainText('26.1 mi');
  // A viewer preference: the link stays the same.
  expect(page.url()).toBe(hashBefore);
  const [after] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  const newGeometry = (await readFile(await after.path(), 'utf8')).match(
    /<trkpt[^>]*\/>/g,
  );
  expect(newGeometry).toEqual(originalGeometry);
  expect(routingRequests).toBe(0);
  // A device preference, not a route edit: a reload keeps miles.
  await page.reload();
  await expect(page.locator('#summary')).toContainText('26.1 mi', {
    timeout: 15000,
  });
  await chooseUnits(page, { distance: 'auto' });
  await expect(page.locator('#summary')).toContainText('42 km');
});

test('a new device starts at 13 mph in miles, the counterpart of 20 km/h', async ({
  page,
}) => {
  await setup(page);
  await chooseUnits(page, { distance: 'imperial' });
  await fillPair(page);
  await expect(page.locator('#average-speed-value')).toHaveText('13');
  await expect(page.locator('#trip-line')).toContainText('13 mph, no stops');
  // Back in km, the default is 20 km/h again.
  await chooseUnits(page, { distance: 'metric' });
  await expect(page.locator('#average-speed-value')).toHaveText('20');
});

test('average speed: keyboard steps, units, kept on the device and never taken from links', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  // 42 km at the default 20 km/h; the router's 49 min is not used.
  await expect(page.locator('#summary')).toContainText('2h 6 min');
  await expect(page.locator('#average-speed')).toBeEnabled();
  await expect(page.locator('#use-average-speed, #reset-speed')).toHaveCount(0);
  await expect(page.locator('#average-speed-value')).toHaveText('20');
  // Fine steps at low speeds, coarser above, up to 120 km/h. Trip options
  // folds into one line once the route shows (#303).
  await page.locator('#trip-options > summary').click();
  await page.locator('#average-speed').focus();
  await expect(page.locator('#average-speed')).toBeFocused();
  await page.locator('#average-speed').press('Home');
  await expect(page.locator('#average-speed-value')).toHaveText('1');
  await page.locator('#average-speed').press('ArrowRight');
  await expect(page.locator('#average-speed-value')).toHaveText('2');
  await page.locator('#average-speed').press('ArrowRight');
  await expect(page.locator('#average-speed-value')).toHaveText('3');
  await page.locator('#average-speed').press('End');
  await expect(page.locator('#average-speed-value')).toHaveText('120');
  await page.locator('#average-speed').press('ArrowLeft');
  await expect(page.locator('#average-speed-value')).toHaveText('110');
  await expect(page.locator('#speed-range')).toHaveText('1–120 km/h');
  await chooseUnits(page, { distance: 'imperial' });
  // 110 km/h is 68.4 mph: the 70 mph notch.
  await expect(page.locator('#average-speed-value')).toHaveText('70');
  await expect(page.locator('#speed-range')).toHaveText('1–75 mph');
  await expect(page.locator('#average-speed')).toHaveAttribute('step', '1');
  // Settings hands focus back as it closes, which can take the slider's
  // focus after it was given; press End again until the slider gets it.
  const slider = page.locator('#average-speed');
  await expect(async () => {
    await slider.focus();
    await expect(slider).toBeFocused();
    await slider.press('End');
    await expect(page.locator('#average-speed-value')).toHaveText('75', {
      timeout: 1000,
    });
  }).toPass();
  await expect(page.locator('#summary')).toContainText('21 min');
  await chooseUnits(page, { distance: 'metric' });
  await setSpeed(page, 25);
  await expect(page.locator('#trip-line')).toContainText('25 km/h, no stops');
  // Kept on this device across reloads, not in the link.
  await page.reload();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#average-speed-value')).toHaveText('25');
  await expect(page.locator('#trip-line')).toContainText('25 km/h, no stops');
});

test('an older route link with a speed opens with its points and the device speed', async ({
  page,
}) => {
  await setup(page);
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22.930929, -43.238286] },
    { name: 'Destination', coord: [-23.05016, -43.53524] },
  ];
  // Legacy links carried averageSpeedKmh, including out-of-range values.
  for (const averageSpeedKmh of [500, 20]) {
    await page.goto(
      base + encodeStateV1({ ...state, averageSpeedKmh } as typeof state),
    );
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#location-0')).toHaveValue(start);
    await expect(page.locator('#location-1')).toHaveValue(end);
    await expect(page.locator('#trip-line')).toContainText('20 km/h, no stops');
    await expect(page.locator('#summary')).toContainText('2h 6 min');
  }
});

test('an older route link in miles opens in the units detected on this device', async ({
  page,
}) => {
  await setup(page);
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22.930929, -43.238286] },
    { name: 'Destination', coord: [-23.05016, -43.53524] },
  ];
  await page.goto(
    base + encodeStateV1({ ...state, units: 'imperial' } as typeof state),
  );
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#location-0')).toHaveValue(start);
  // The test browser reads English without a country in UTC: km.
  await expect(page.locator('#summary')).toContainText('42 km');
});

test('editing points keeps the map view; only loads and Fit route frame the route', async ({
  page,
}) => {
  await setup(page);
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22.930929, -43.238286] },
    { name: 'Destination', coord: [-23.05016, -43.53524] },
  ];
  // Opening a link frames the route it loads.
  await page.goto(base + encodeState(state));
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  const marker = page.locator('.route-marker').first();
  const framed = (await marker.boundingBox())!;
  const view = async () => {
    const box = (await marker.boundingBox())!;
    return [Math.round(box.x), Math.round(box.y)];
  };
  await page.locator('.map-zoom-in').click();
  await page.locator('.map-zoom-in').click();
  await expect
    .poll(view)
    .not.toEqual([Math.round(framed.x), Math.round(framed.y)]);
  // Wait for both zoom animations to settle.
  let settled: number[] = [];
  await expect
    .poll(async () => {
      const previous = settled;
      settled = await view();
      return previous.join() === settled.join();
    })
    .toBe(true);
  const zoomed = await view();
  // Moving the destination reroutes without moving the map.
  await page.locator('#location-1').fill('-23.1, -43.6');
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#status')).toHaveText('Route ready.');
  expect(await view()).toEqual(zoomed);
  // Undo restores the earlier route in place, too.
  await undo(page);
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  expect(await view()).toEqual(zoomed);
  // Fit route is the user's way back to the whole route.
  await page.locator('#fit').click();
  expect(await view()).not.toEqual(zoomed);
});

test.describe('a browser set to American English', () => {
  test.use({ locale: 'en-US' });
  test('Automatic units follow the browser region and Settings name them', async ({
    page,
  }) => {
    await setup(page);
    await fillPair(page);
    await expect(page.locator('#summary')).toContainText('26.1 mi');
    await expect(page.locator('#speed-unit')).toHaveText('mph');
    await page.locator('#open-settings').click();
    await expect(page.locator('#distance-units')).toHaveValue('auto');
    await expect(page.locator('#distance-units option[value=auto]')).toHaveText(
      'Automatic (mi)',
    );
    await expect(
      page.locator('#temperature-units option[value=auto]'),
    ).toHaveText('Automatic (°F)');
    await page.locator('#distance-units').selectOption('metric');
    await page.locator('#close-settings').click();
    await expect(page.locator('#summary')).toContainText('42 km');
    await setLanguage(page, 'pt');
    await page.locator('#open-settings').click();
    await expect(page.locator('#distance-units option[value=auto]')).toHaveText(
      'Automático (mi)',
    );
    await expect(
      page.locator('#distance-units option[value=metric]'),
    ).toHaveText('Quilômetros');
  });
});

test.describe('a browser set to British English in Australia', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Australia/Sydney' });
  test('Automatic units follow the time zone over the language region', async ({
    page,
  }) => {
    await setup(page);
    await fillPair(page);
    await expect(page.locator('#summary')).toContainText('42 km');
    await expect(page.locator('#speed-unit')).toHaveText('km/h');
    await page.locator('#open-settings').click();
    await expect(page.locator('#distance-units option[value=auto]')).toHaveText(
      'Automatic (km)',
    );
    await expect(
      page.locator('#temperature-units option[value=auto]'),
    ).toHaveText('Automatic (°C)');
  });
});

test('an invalid settings URL leaves every server unchanged', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  const hash = new URL(page.url()).hash;
  await openAdvancedSettings(page);
  await page.locator('#valhalla').fill('https://example.org/valhalla');
  await page.locator('#weather-server').fill('https://example.org/weather');
  await page.locator('#nominatim').fill('not a server');
  await page.locator('#save-settings').click();
  await expect(page.locator('#status')).toHaveClass('error');
  await expect(page.locator('#download')).toBeEnabled();
  expect(new URL(page.url()).hash).toBe(hash);
  expect(
    await page.evaluate(() => localStorage.getItem('weather-server')),
  ).toBeNull();
  await page.locator('#nominatim').fill('https://example.org/nominatim');
  await page.locator('#save-settings').click();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  expect(new URL(page.url()).hash).not.toBe(hash);
  expect(
    await page.evaluate(() => localStorage.getItem('weather-server')),
  ).toBe('https://example.org/weather');
});

test('a v1 route link still opens and is rewritten as a short v2 link', async ({
  page,
}) => {
  await setup(page);
  const state = defaults();
  state.name = 'Legacy link';
  state.points = [
    { name: 'Start', coord: [-22.930929, -43.238286] },
    { name: 'Destination', coord: [-23.05016, -43.53524] },
  ];
  const legacy = encodeStateV1(state);
  await page.goto(base + legacy);
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#location-0')).toHaveValue(start);
  await expect(page.locator('#location-1')).toHaveValue(end);
  await expect(page.locator('#route-name')).toHaveValue('Legacy link');
  await expect(page).toHaveURL(/#v2=/);
  expect(new URL(page.url()).hash.length).toBeLessThan(legacy.length);
});

test.describe('servers suggested by a link', () => {
  const linkWith = (osrm?: string) => {
    const state = defaults();
    state.points = [
      { name: 'Start', coord: [-22.930929, -43.238286] },
      { name: 'Destination', coord: [-23.05016, -43.53524] },
    ];
    if (osrm) state.osrm = osrm;
    // OSRM first, so the link's OSRM server is the one asked.
    state.prefer = false;
    return base + encodeState(state);
  };
  const track = (page: Page) => {
    const hosts: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/route/v1/driving/'))
        hosts.push(new URL(r.url()).host);
    });
    return hosts;
  };
  test('open with the default servers until the visitor opts in', async ({
    page,
  }) => {
    await setup(page);
    const hosts = track(page);
    await page.goto(linkWith('https://example.org/osrm'));
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#server-notice')).toBeVisible();
    await expect(page.locator('#server-notice-text')).toContainText(
      'example.org',
    );
    expect(hosts).toEqual(['router.project-osrm.org']);
    expect(page.url()).not.toContain('example');
    await expect(page.locator('#osrm')).toHaveValue(
      'https://router.project-osrm.org',
    );
    await page.locator('#use-link-servers').click();
    await expect(page.locator('#server-notice')).toBeHidden();
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    expect(hosts.at(-1)).toBe('example.org');
    await expect(page.locator('#osrm')).toHaveValue('https://example.org/osrm');
    await undo(page);
    await expect(page.locator('#osrm')).toHaveValue(
      'https://router.project-osrm.org',
    );
  });
  test('keeping the defaults dismisses the notice without contacting the link server', async ({
    page,
  }) => {
    await setup(page);
    const hosts = track(page);
    await page.goto(linkWith('https://example.org/osrm'));
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await page.locator('#keep-default-servers').click();
    await expect(page.locator('#server-notice')).toBeHidden();
    expect(hosts.every((host) => host === 'router.project-osrm.org')).toBe(
      true,
    );
  });
  test('a link with default servers shows no notice', async ({ page }) => {
    await setup(page);
    await page.goto(linkWith());
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#server-notice')).toBeHidden();
  });
});

test('the route name is visible and names the downloaded file, metadata and track', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  const name = 'Passeio <Alto> & Grumari';
  await expect(page.locator('#route-name')).toBeVisible();
  await page.locator('#route-name').fill(name);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  expect(download.suggestedFilename()).toBe('passeio-alto-grumari.gpx');
  const xml = await readFile(await download.path(), 'utf8');
  const names = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return [
      doc.querySelector('metadata name')?.textContent,
      doc.querySelector('trk name')?.textContent,
      doc.querySelectorAll('trkpt').length,
    ];
  }, xml);
  expect(names).toEqual([name, name, 2]);
  await page.reload();
  await expect(page.locator('#route-name')).toHaveValue(name);
  await page.locator('#route-name').fill('');
  const [fallback] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  expect(fallback.suggestedFilename()).toBe('start-to-destination.gpx');
});

test('the edit lock disables and enables opening saved routes, however the list was drawn', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  await page.locator('#route-name').fill('Locked route');
  await saveRoute(page);
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  await openSavedRoutes(page);
  const open = page.locator('#saved-list .library-open');
  await expect(open).toBeEnabled();
  await mapTool(page, 'lock');
  await expect(open).toBeDisabled();
  // A language change while locked draws the list again, still disabled.
  await setLanguage(page, 'pt');
  await expect(page.locator('#saved-list .library-open')).toBeDisabled();
  await page.locator('#unlock').click();
  await expect(page.locator('#saved-list .library-open')).toBeEnabled();
});

const saveTexts = {
  en: {
    saved: 'Route saved on this device.',
    ready: 'Route ready.',
    delete: 'Delete saved route: Weekend route',
    deleted: 'Saved route deleted.',
    undo: 'Undo',
    restored: 'Saved route restored.',
  },
  pt: {
    saved: 'Rota salva neste dispositivo.',
    ready: 'Rota pronta.',
    delete: 'Excluir rota salva: Weekend route',
    deleted: 'Rota salva excluída.',
    undo: 'Desfazer',
    restored: 'Rota salva restaurada.',
  },
};
for (const language of ['en', 'pt'] as const)
  test(`a deleted saved route comes back exactly with Undo, at 320 px in ${language}`, async ({
    page,
  }) => {
    const say = saveTexts[language];
    await page.setViewportSize({ width: 320, height: 640 });
    await page.clock.install();
    await setup(page);
    await setLanguage(page, language);
    await fillPair(page);
    await saveRoute(page, 'Weekend route');
    await expect(page.locator('#status')).toHaveText(say.saved);
    const saved = await libraryEntry(page, 'routes', 'weekend route');
    expect(saved).not.toBeNull();
    await openSavedRoutes(page);
    const message = page.locator('#library-status');
    // The save is said once, at the top (#213).
    await expect(message).toBeEmpty();
    await page.getByRole('button', { name: say.delete, exact: true }).click();
    await expect(page.locator('#saved-count')).toHaveText('(0)');
    expect(await libraryEntry(page, 'routes', 'weekend route')).toBeNull();
    // The route on screen is no longer said to be saved.
    await expect(page.locator('#status')).toHaveText(say.ready);
    await expect(message).toContainText(say.deleted);
    await message.getByRole('button', { name: say.undo }).click();
    await expect(message).toHaveText(say.restored);
    await expect(page.locator('#saved-count')).toHaveText('(1)');
    expect(await libraryEntry(page, 'routes', 'weekend route')).toEqual(saved);
    // Undo goes after 8 s; the message stays.
    await page.getByRole('button', { name: say.delete, exact: true }).click();
    const undo = message.getByRole('button', { name: say.undo });
    await expect(undo).toBeVisible();
    await page.clock.runFor(8100);
    await expect(undo).toBeHidden();
    await expect(message).toHaveText(say.deleted);
  });

test('Undo never overwrites a route saved again under the same name', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await setup(page);
  await fillPair(page);
  await saveRoute(page, 'Weekend route');
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  await openSavedRoutes(page);
  await page
    .getByRole('button', { name: 'Delete saved route: Weekend route' })
    .click();
  await expect(page.locator('#saved-count')).toHaveText('(0)');
  await saveRoute(page);
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  const again = await libraryEntry(page, 'routes', 'weekend route');
  await page
    .locator('#library-status')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(page.locator('#library-status')).toHaveText(
    'A saved route with this name already exists.',
  );
  expect(await libraryEntry(page, 'routes', 'weekend route')).toEqual(again);
});

test('only explicitly saved named routes persist, and reopening does not reroute', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  await expect(page.locator('#saved-count')).toHaveText('(0)');
  // The save sheet asks for a name (#301): none, and nothing is saved.
  await page.locator('#save-route').click();
  await page.locator('#save-confirm').click();
  await expect(page.locator('#save-error')).toHaveText(
    'Name the route to save it.',
  );
  await page.locator('#save-cancel').click();
  await page.locator('#route-name').fill('Weekend route');
  await expect(page.locator('#saved-count')).toHaveText('(0)');
  await saveRoute(page);
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  // The same name again replaces it, and the sheet says so.
  await page.locator('#save-route').click();
  await expect(page.locator('#save-name')).toHaveValue('Weekend route');
  await expect(page.locator('#save-confirm')).toHaveText('Update saved route');
  await page.locator('#save-confirm').click();
  await expect(page.locator('#status')).toHaveText(
    'Route saved on this device.',
  );
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  await page.goto(base);
  await openSavedRoutes(page);
  await expect(page.locator('#saved-list strong')).toHaveText('Weekend route');
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/route/v1/driving/')) requests++;
  });
  await page
    .getByRole('button', {
      name: 'Open saved route: Weekend route',
      exact: true,
    })
    .click();
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#route-name')).toHaveValue('Weekend route');
  await expect(page.locator('#summary')).toContainText('42 km');
  expect(requests).toBe(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', {
        name: 'Download saved route: Weekend route',
        exact: true,
      })
      .click(),
  ]);
  const xml = await readFile(await download.path(), 'utf8');
  expect((xml.match(/<trkpt /g) || []).length).toBe(2);
  expect(download.suggestedFilename()).toBe('weekend-route.gpx');
});
test('route backups restore deleted routes and skip existing names', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  await page.locator('#route-name').fill('Backup test');
  await saveRoute(page);
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  // The backup lives in Settings.
  await page.locator('#open-settings').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backup-routes').click(),
  ]);
  const backup = await readFile(await download.path());
  expect(
    (JSON.parse(backup.toString()) as { routes: unknown[] }).routes,
  ).toHaveLength(1);
  await page.locator('#close-settings').click();
  await openSavedRoutes(page);
  await page
    .getByRole('button', {
      name: 'Delete saved route: Backup test',
      exact: true,
    })
    .click();
  await expect(page.locator('#saved-count')).toHaveText('(0)');
  await page.locator('#open-settings').click();
  for (let i = 0; i < 2; i++) {
    await page.locator('#restore-routes').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: backup,
    });
    await expect(page.locator('#saved-count')).toHaveText('(1)');
    await expect(page.locator('#restore-routes')).toHaveValue('');
  }
  await expect(page.locator('#backup-status')).toContainText(
    'Existing names were kept.',
  );
  await page.locator('#close-settings').click();
  await expect(page.locator('#saved-list strong')).toHaveText('Backup test');
});
test('a route saved before turn directions gets them once, keeping its geometry', async ({
  page,
}) => {
  await setup(page);
  // One step-only request: the same road, now with directions.
  const routeRequests: string[] = [];
  await page.route('**/route/v1/driving/**', (r) => {
    routeRequests.push(r.request().url());
    return r.fulfill({
      json: {
        code: 'Ok',
        waypoints: [
          { location: [-43.2, -22.9], distance: 0 },
          { location: [-43.1, -22.9], distance: 0 },
        ],
        routes: [
          {
            distance: 10200,
            duration: 600,
            geometry: {
              coordinates: [
                [-43.2, -22.9],
                [-43.1, -22.9],
              ],
            },
            legs: [
              {
                steps: [
                  {
                    name: 'Rua A',
                    distance: 5000,
                    duration: 300,
                    maneuver: { type: 'depart', location: [-43.2, -22.9] },
                  },
                  {
                    name: 'Rua B',
                    distance: 5200,
                    duration: 300,
                    maneuver: {
                      type: 'turn',
                      modifier: 'left',
                      location: [-43.15, -22.9],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto(base);
  const state = defaults();
  state.name = 'Old route';
  state.points = [
    { name: 'Start', coord: [-22.9, -43.2] },
    { name: 'End', coord: [-22.9, -43.1] },
  ];
  // Steps as saved before #23: a kind, but no turn direction or location.
  const segments = [
    [
      [-22.9, -43.2],
      [-22.9, -43.15],
      [-22.9, -43.1],
    ],
  ];
  const backup = {
    format: 'nautavo-library',
    version: 1,
    routes: [
      {
        name: 'Old route',
        state,
        route: {
          segments,
          steps: [
            {
              name: 'Rua A',
              ref: '',
              distance: 5000,
              duration: 300,
              kind: 'depart',
            },
            {
              name: 'Rua B',
              ref: '',
              distance: 5200,
              duration: 300,
              kind: 'turn',
            },
          ],
          distance: 10200,
          duration: 600,
          provider: 'OSRM',
        },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
  await page.locator('#restore-routes').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await openSavedRoutes(page);
  const open = () =>
    page
      .getByRole('button', { name: 'Open saved route: Old route', exact: true })
      .click();
  await open();
  await expect(page.locator('#download')).toBeEnabled();
  expect(routeRequests).toHaveLength(0);
  await openTab(page, 'itinerary');
  await expect(page.locator('#itinerary li')).toHaveText([
    'km 0.0 Depart R. A 5 km',
    'km 5.1 Turn left R. B 5.2 km',
  ]);
  expect(routeRequests).toHaveLength(1);
  // The saved geometry is kept: three points, not the router's two.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  const xml = await readFile(await download.path(), 'utf8');
  expect((xml.match(/<trkpt /g) || []).length).toBe(3);
  // The saved entry now has the directions: reopening asks nothing. Wait for
  // the entry to be written before leaving the page.
  await expect
    .poll(async () =>
      JSON.stringify(await libraryEntry(page, 'routes')).includes(
        '"modifier":"left"',
      ),
    )
    .toBe(true);
  // A fresh page without the route link, which would calculate the linked
  // route itself if opening took longer than the route-change debounce.
  await page.goto(base);
  await openSavedRoutes(page);
  await open();
  await openTab(page, 'itinerary');
  await expect(page.locator('#itinerary li').nth(1)).toContainText('Turn left');
  expect(routeRequests).toHaveLength(1);
});
test('a saved route whose road changed keeps its steps and is not asked again', async ({
  page,
}) => {
  await setup(page);
  const routeRequests: string[] = [];
  // The router now takes another road, 2 km off the saved one.
  await page.route('**/route/v1/driving/**', (r) => {
    routeRequests.push(r.request().url());
    return r.fulfill({
      json: {
        code: 'Ok',
        waypoints: [
          { location: [-43.2, -22.9], distance: 0 },
          { location: [-43.1, -22.9], distance: 0 },
        ],
        routes: [
          {
            distance: 14000,
            duration: 900,
            geometry: {
              coordinates: [
                [-43.2, -22.9],
                [-43.15, -22.88],
                [-43.1, -22.9],
              ],
            },
            legs: [
              {
                steps: [
                  {
                    name: 'Rua X',
                    distance: 14000,
                    duration: 900,
                    maneuver: { type: 'depart', location: [-43.2, -22.9] },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto(base);
  const state = defaults();
  state.name = 'Changed road';
  state.points = [
    { name: 'Start', coord: [-22.9, -43.2] },
    { name: 'End', coord: [-22.9, -43.1] },
  ];
  const backup = {
    format: 'nautavo-library',
    version: 1,
    routes: [
      {
        name: 'Changed road',
        state,
        route: {
          segments: [
            [
              [-22.9, -43.2],
              [-22.9, -43.1],
            ],
          ],
          steps: [
            {
              name: 'Rua A',
              ref: '',
              distance: 5000,
              duration: 300,
              kind: 'depart',
            },
            {
              name: 'Rua B',
              ref: '',
              distance: 5200,
              duration: 300,
              kind: 'turn',
            },
          ],
          distance: 10200,
          duration: 600,
          provider: 'OSRM',
        },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
  await page.locator('#restore-routes').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await openSavedRoutes(page);
  const open = () =>
    page
      .getByRole('button', {
        name: 'Open saved route: Changed road',
        exact: true,
      })
      .click();
  await open();
  await openTab(page, 'itinerary');
  await expect(page.locator('#directions-status')).toHaveText(
    'Directions not added: the road has changed. Calculate route to update it.',
  );
  await expect(page.locator('#itinerary li').nth(1)).toContainText('R. B');
  expect(routeRequests).toHaveLength(1);
  // Remembered in the saved entry: after a reload, no new request.
  await page.waitForTimeout(500);
  await page.reload();
  await openSavedRoutes(page);
  await open();
  await openTab(page, 'itinerary');
  await expect(page.locator('#directions-status')).toContainText(
    'the road has changed',
  );
  await page.waitForTimeout(2000);
  expect(routeRequests).toHaveLength(1);
});
/** OSRM map matching: depart on Rua A (Rua B after the first request), then a right turn. `fail` aborts like a lost connection. */
async function mockMatch(page: Page, fail: () => boolean = () => false) {
  const matches: string[] = [];
  await page.route('**/match/v1/driving/**', (r) => {
    matches.push(r.request().url());
    if (fail()) return r.abort('internetdisconnected');
    const coords = new URL(r.request().url()).pathname
      .split('/driving/')[1]
      .split(';')
      .map((p) => p.split(',').map(Number));
    return r.fulfill({
      json: {
        code: 'Ok',
        matchings: [
          {
            legs: [
              {
                steps: [
                  {
                    name: matches.length === 1 ? 'Rua A' : 'Rua B',
                    distance: 900,
                    duration: 90,
                    maneuver: {
                      type: 'depart',
                      location: coords[0],
                    },
                  },
                  {
                    name: 'Rua B',
                    distance: 900,
                    duration: 90,
                    maneuver: {
                      type: 'turn',
                      modifier: 'right',
                      location: coords[5],
                    },
                  },
                  {
                    name: 'Rua B',
                    distance: 0,
                    duration: 0,
                    maneuver: { type: 'arrive', location: coords.at(-1) },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });
  return matches;
}
/** Imports a 60-point ride heading east, about 6.5 km. */
async function importRide(page: Page) {
  const track = Array.from({ length: 60 }, (_, i) => [
    -22.9,
    -43.4 + i * 0.001,
  ]);
  const gpx = `<gpx><trk><name>Ride</name><trkseg>${track.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk></gpx>`;
  await page.locator('#import').setInputFiles({
    name: 'ride.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await expect(page.locator('#download')).toBeEnabled();
}
test('an imported track gets directions by map matching when the itinerary opens', async ({
  page,
}) => {
  await setup(page);
  const matches = await mockMatch(page);
  await page.goto(base);
  await importRide(page);
  expect(matches).toHaveLength(0);
  await openTab(page, 'itinerary');
  // 6.5 km traced every 300 m: 23 points in 3 chunks of up to 10.
  await expect(page.locator('#itinerary li').first()).toContainText(
    'Depart R. A',
    { timeout: 15000 },
  );
  await expect(page.locator('#itinerary li').nth(1)).toContainText(
    'Turn right R. B',
  );
  expect(matches).toHaveLength(3);
  expect(
    matches.every(
      (u) => new URL(u).pathname.split('/driving/')[1].split(';').length <= 10,
    ),
  ).toBe(true);
  // The exact imported track is kept.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download'),
  ]);
  const xml = await readFile(await download.path(), 'utf8');
  expect((xml.match(/<trkpt /g) || []).length).toBe(60);
  // Closing and reopening asks nothing more.
  await openTab(page, 'itinerary');
  await openTab(page, 'itinerary');
  expect(matches).toHaveLength(3);
});
test('a TCX course carries the turns, asking an imported track for them once (#288)', async ({
  page,
}) => {
  await setup(page);
  const matches = await mockMatch(page);
  await page.goto(base);
  await importRide(page);
  // A choice of the Export menu (#301), named.
  await expect(page.locator('#download-tcx')).toHaveAttribute(
    'aria-label',
    'Download TCX with turns',
  );
  const course = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportAs(page, 'download-tcx'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.tcx$/);
    return readFile(await download.path(), 'utf8');
  };
  const tcx = await course();
  // The directions come the way the Itinerary gets them, on this choice.
  expect(matches).toHaveLength(3);
  expect((tcx.match(/<Trackpoint>/g) || []).length).toBe(60);
  expect(tcx).toContain('<PointType>Right</PointType>');
  expect(tcx).toContain('<Notes>Turn right · Rua B</Notes>');
  // Elevation was not opened: the status says how to include it (#290).
  await expect(page.locator('#status')).toHaveText(
    'File saved without elevation. Open Elevation before downloading to include it.',
  );
  // Asked once: a second course asks nothing.
  await course();
  expect(matches).toHaveLength(3);
});
test('a FIT course carries the same turns, as course points', async ({
  page,
}) => {
  await setup(page);
  const matches = await mockMatch(page);
  await page.goto(base);
  await importRide(page);
  await expect(page.locator('#download-fit')).toHaveAttribute(
    'aria-label',
    'Download FIT with turns',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'download-fit'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.fit$/);
  const fit = readTrackFile(
    new Uint8Array(await readFile(await download.path())),
  );
  expect(matches).toHaveLength(3);
  expect(fit.format).toBe('FIT');
  expect(fit.segments.flat()).toHaveLength(60);
  expect(fit.waypoints.map((w) => w.name)).toContain('R. B');
  await expect(page.locator('#status')).toHaveText(
    'File saved without elevation. Open Elevation before downloading to include it.',
  );
});
test('downloads carry the elevation the page already has, never asking for it (#290)', async ({
  page,
}) => {
  await setup(page);
  await mockMatch(page);
  const asked: string[] = [];
  await page.route('**/v1/elevation?**', (r) => {
    asked.push(r.request().url());
    const n = new URL(r.request().url()).searchParams
      .get('latitude')!
      .split(',').length;
    return r.fulfill({
      json: { elevation: Array.from({ length: n }, (_, i) => 100 + i) },
    });
  });
  await page.goto(base);
  await importRide(page);
  const file = async (id: 'download' | 'download-tcx') => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportAs(page, id),
    ]);
    return readFile(await download.path(), 'utf8');
  };
  // Elevation not opened: no request, no elevation in the files.
  expect(await file('download')).not.toContain('<ele>');
  expect(await file('download-tcx')).not.toContain('<AltitudeMeters>');
  expect(asked).toEqual([]);
  // Opened by the user: every track point takes the loaded profile.
  await openTab(page, 'elevation');
  await expect(page.locator('#elevation-chart svg')).toBeVisible();
  const requests = asked.length;
  const gpx = await file('download');
  expect((gpx.match(/<ele>/g) || []).length).toBe(60);
  await expect(page.locator('#status')).toHaveText('GPX downloaded.');
  const tcx = await file('download-tcx');
  expect((tcx.match(/<AltitudeMeters>/g) || []).length).toBe(60);
  // The downloads asked nothing more.
  expect(asked).toHaveLength(requests);
});
test('the Export choices fit a 320 px phone (pt)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await setup(page);
  await page.goto(`${base}?lang=pt`);
  await importRide(page);
  await page.locator('#export').click();
  for (const [id, label] of [
    ['#download', 'Baixar GPX'],
    ['#download-tcx', 'Baixar TCX com curvas'],
    ['#download-fit', 'Baixar FIT com curvas'],
    ['#share', 'Copiar link'],
  ]) {
    const action = page.locator(id);
    await expect(action).toBeVisible();
    await expect(action).toContainText(label);
    // The name on one line, the choice inside the screen (#301).
    const name = await action.evaluate((e) => {
      const range = document.createRange();
      range.selectNode(e.querySelector('.button-label')!.firstChild!);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
        .size;
    });
    expect(name).toBe(1);
    const box = (await action.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
test('directions that fail without a connection are added once it returns', async ({
  page,
  context,
}) => {
  await setup(page);
  let offline = false;
  const matches = await mockMatch(page, () => offline);
  await page.goto(base);
  await importRide(page);
  offline = true;
  await context.setOffline(true);
  await openTab(page, 'itinerary');
  await expect(page.locator('#directions-status')).toHaveText(
    'No connection. Directions will be added when the connection returns.',
    { timeout: 15000 },
  );
  const asked = matches.length;
  await page.waitForTimeout(1500);
  expect(matches).toHaveLength(asked);
  offline = false;
  await context.setOffline(false);
  await expect(page.locator('#itinerary li').nth(1)).toContainText(
    'Turn right R. B',
    { timeout: 15000 },
  );
  await expect(page.locator('#directions-status')).toBeHidden();
});
test('download still works if persistent browser storage is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined });
  });
  await setup(page);
  await fillPair(page);
  await page.locator('#route-name').fill('Temporary');
  await saveRoute(page);
  await expect(page.locator('#status')).toContainText('Could not save locally');
  await expect(page.locator('#download')).toBeEnabled();
});

test.beforeEach(async ({ page }) => {
  await mockRegion(page);
});

test.beforeEach(async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({ json: { features: [] } }),
  );
});

test('the chosen language survives the logo link, undo, reloads and shared links', async ({
  page,
}) => {
  await setup(page);
  await fillPair(page);
  const routeStart = await page.locator('#location-0').inputValue();
  await setLanguage(page, 'pt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await page.locator('a.brand').click();
  await expect(page.locator('#location-0')).toHaveValue('');
  await expect(page.locator('#language')).toHaveValue('pt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await undo(page);
  await expect(page.locator('#location-0')).toHaveValue(routeStart);
  await expect(page.locator('#language')).toHaveValue('pt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await page.goto(base);
  await expect(page.locator('#language')).toHaveValue('pt');
  await page.goto(base + encodeState({ ...defaults(), language: 'en' }));
  await expect(page.locator('#language')).toHaveValue('en');
  await page.goto(base);
  await expect(page.locator('#language')).toHaveValue('pt');
  await page.goto(base + 'help');
  await expect(page.locator('#language')).toHaveValue('pt');
});
