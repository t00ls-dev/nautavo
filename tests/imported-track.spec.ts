import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodePolyline } from '../src/road-attributes';
import { base, gpxPoints } from './app-helpers';
import { at, north, road } from './local-frame';
import { mapReady, mockBasemap, overlayCount } from './map-helpers';
const gpx = (points: [number, number][]) =>
  `<gpx><trk><name>Ride</name><trkseg>${points
    .map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"/>`)
    .join('')}</trkseg></trk></gpx>`;
/** A recorded ride east along a road, with a GPS zigzag while stopped. */
const zigzag = [at(1500, 40), at(1510, -35), at(1500, 60), at(1505, -45)];
const withZigzag = [...road(0, 1500), ...zigzag, ...road(1510, 3000)];
/** The same ride with a stretch on a path no road follows. */
const withPath = [
  ...road(0, 1000),
  ...[100, 200, 300, 400].map((y) => at(1000 + y, y)),
  ...[300, 200, 100].map((y) => at(1800 - y, y)),
  ...road(1800, 3000),
];

async function setup(page: Page, matched = road(0, 3000, 50)) {
  const requests = { trace: 0, routing: 0 };
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(page);
  await page.route('**/trace_route', async (r) => {
    requests.trace++;
    await r.fulfill({
      json: {
        trip: {
          status: 0,
          summary: { length: 3, time: 300 },
          legs: [
            {
              shape: encodePolyline(matched),
              maneuvers: [
                { street_names: ['Rua A'], length: 3, time: 300, type: 1 },
                { street_names: [], length: 0, time: 0, type: 4 },
              ],
            },
          ],
        },
      },
    });
  });
  page.on('request', (r) => {
    if (r.url().includes('/route/v1/') || r.url().includes('/route?'))
      requests.routing++;
  });
  await page.goto(base);
  await mapReady(page);
  return requests;
}
const importTrack = (page: Page, points: [number, number][]) =>
  page.locator('#import').setInputFiles({
    name: 'ride.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx(points)),
  });
async function exported(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  return gpxPoints(await readFile(await download.path(), 'utf8'));
}

test('a track is aligned to the roads after import, and the recording can be kept', async ({
  page,
}) => {
  const requests = await setup(page);
  await importTrack(page, withZigzag);
  await expect(page.locator('#status')).toHaveText(
    'Track aligned to the roads.',
  );
  expect(requests.trace).toBe(1);
  expect(requests.routing).toBe(0);
  const notes = page.locator('#summary-notes');
  await expect(notes).toContainText('Track aligned to the roads.');
  // The exported track follows the road, without the zigzag.
  const fixed = await exported(page);
  expect(Math.max(...fixed.map((c) => Math.abs(north(c))))).toBeLessThan(31);
  // Kept as recorded on request, every point back.
  await notes.getByRole('button', { name: 'Keep the recorded track' }).click();
  await expect(page.locator('#status')).toHaveText('Recorded track restored.');
  const raw = await exported(page);
  expect(raw).toHaveLength(withZigzag.length);
  expect(Math.max(...raw.map((c) => Math.abs(north(c))))).toBeGreaterThan(55);
});

test('a late track check keeps the error of a newer failed import', async ({
  page,
}) => {
  await setup(page);
  // Holds the check's answer until the second import has failed.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/trace_route', async (r) => {
    await held;
    await r.fallback();
  });
  await importTrack(page, withZigzag);
  await expect(page.locator('#status')).toHaveText(
    'Checking the track against the roads…',
  );
  await page.locator('#import').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a track'),
  });
  const error = 'This file is not a valid GPX, TCX or FIT file.';
  await expect(page.locator('#status')).toHaveText(error);
  release();
  // The check still applies to the route on screen, without its message.
  await expect(page.locator('#summary-notes')).toContainText(
    'Track aligned to the roads.',
  );
  await expect(page.locator('#status')).toHaveText(error);
});

for (const [width, language] of [
  [320, 'pt'],
  [1280, 'en'],
] as const)
  test(`a stretch no road follows is kept and flagged at ${width}px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    if (language === 'pt') await page.locator('#language').selectOption('pt');
    await importTrack(page, withPath);
    const warning = page.locator('#summary-notes .unfollowable');
    await expect(warning).toContainText(
      language === 'pt'
        ? 'Esta rota não pode ser seguida exatamente em 1 trecho:'
        : 'This route cannot be followed exactly in 1 place:',
    );
    await expect.poll(() => overlayCount(page, 'rg-unfollowable')).toBe(1);
    // The recorded path stays in the route.
    const points = await exported(page);
    expect(Math.max(...points.map(north))).toBeGreaterThan(390);
    // The notice fits the panel: nothing runs off its edge.
    const box = (await warning.boundingBox())!;
    const panel = (await page.locator('#route-panel').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    expect(
      await warning.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
  });

test('on an imported track, Calculate route, Reverse and Round trip never reroute it', async ({
  page,
}) => {
  // The matcher draws its road 10 m beside the recording.
  const requests = await setup(page, road(0, 3000, 50, 10));
  await importTrack(page, road(0, 3000));
  await expect(page.locator('#status')).toHaveText(
    'Track aligned to the roads.',
  );
  await page.locator('#calculate').click();
  await expect(page.locator('#status')).toHaveText(
    'Route calculated along the imported track.',
  );
  // The road, with its directions (Rua shows abbreviated as R.).
  await expect(page.locator('#itinerary')).toContainText('Depart · R. A');
  const aligned = await exported(page);
  for (const c of aligned) expect(north(c)).toBeCloseTo(10, 0);
  await page.locator('#reverse').click();
  await expect(page.locator('#status')).toHaveText('Route ready.');
  await page.locator('#roundtrip').click();
  await expect(page.locator('#download')).toBeEnabled();
  expect(requests.routing).toBe(0);
});

for (const language of ['en', 'pt'] as const)
  test(`copying the link of an imported route says it will be recalculated (${language})`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setup(page);
    if (language === 'pt') await page.locator('#language').selectOption('pt');
    await importTrack(page, road(0, 3000));
    await expect(page.locator('#download')).toBeEnabled();
    await page.locator('#share').click();
    await expect(page.locator('#status')).toHaveText(
      language === 'pt'
        ? 'Link copiado. Ao abrir, a rota é recalculada e pode diferir da trilha importada; compartilhe o GPX para a trilha exata.'
        : 'Link copied. Opening it recalculates the route, which can differ from the imported track; share the GPX for the exact track.',
    );
  });
