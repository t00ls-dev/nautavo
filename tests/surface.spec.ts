import { expect, test, type Page, type Route } from '@playwright/test';
import { defaults, encodeState, meters } from '../src/core';
import { decodePolyline } from '../src/routing';
import { chooseUnits } from './unit-settings';
import { coloringKinds } from './map-helpers';
import { base, setLanguage } from './app-helpers';

/**
 * A mocked Valhalla `/trace_attributes`: one edge between each pair of sent
 * points, gravel between longitude 0.3 and 0.5 and paved elsewhere.
 */
function traceAnswer(body: string) {
  const coords = decodePolyline(
    (JSON.parse(body) as { encoded_polyline: string }).encoded_polyline,
  );
  const edges = coords.slice(1).map((c, i) => {
    const middle = (c[1] + coords[i][1]) / 2;
    return {
      length: meters(coords[i], c) / 1000,
      surface: middle > 0.3 && middle < 0.5 ? 'gravel' : 'paved_smooth',
    };
  });
  return {
    edges,
    matched_points: coords.map((_, k) => ({
      type: 'matched',
      edge_index: Math.min(k, edges.length - 1),
      distance_along_edge: k < edges.length ? 0 : 1,
    })),
  };
}

async function setup(page: Page, lon = 1) {
  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('auto-departure', 'off'));
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  // The road runs east along the equator to the requested destination.
  await page.route('**/route/v1/driving/**', (r) => {
    const to = Number(
      new URL(r.request().url()).pathname.split(';')[1].split(',')[0],
    );
    const count = Math.round(to * 100);
    return r.fulfill({
      json: {
        code: 'Ok',
        waypoints: [
          { location: [0, 0], distance: 0 },
          { location: [to, 0], distance: 0 },
        ],
        routes: [
          {
            distance: to * 111195,
            duration: to * 3600,
            geometry: {
              coordinates: Array.from({ length: count + 1 }, (_, i) => [
                (i / count) * to,
                0,
              ]),
            },
            legs: [],
          },
        ],
      },
    });
  });
  const state = { ...defaults(), language: 'en' as const };
  state.points = [
    { name: 'Start', coord: [0, 0] },
    { name: 'Destination', coord: [0, lon] },
  ];
  await page.goto(base + encodeState(state));
  await expect(page.locator('#download')).toBeEnabled();
}

async function mockTrace(
  page: Page,
  answer: (route: Route, index: number) => Promise<void> | void = (r) =>
    r.fulfill({ json: traceAnswer(r.request().postData()!) }),
) {
  const requests: { at: number; body: string }[] = [];
  await page.route('**/trace_attributes', (r) => {
    requests.push({ at: Date.now(), body: r.request().postData()! });
    return answer(r, requests.length - 1);
  });
  return requests;
}

/** Chooses the Surface coloring in Map layers: the request's explicit choice. */
async function chooseSurface(page: Page) {
  await page.locator('#layers-toggle').click();
  await page.locator('[data-coloring="surface"]').click();
  await page.keyboard.press('Escape');
}
const legend = (page: Page) => page.locator('.route-legend');
const items = (page: Page) => legend(page).locator(':scope > span');

test('surface is asked only when its coloring is chosen, and the legend gives each share and translates', async ({
  page,
}) => {
  await setup(page);
  const requests = await mockTrace(page);
  await page.waitForTimeout(300);
  expect(requests).toHaveLength(0);
  await chooseSurface(page);
  await expect.poll(() => coloringKinds(page)).toContain('unpaved');
  await expect.poll(() => coloringKinds(page)).toContain('paved');
  // About 89 km paved and 22 km gravel on a 111 km route.
  await expect(items(page)).toHaveText(['Paved80%', 'Unpaved20%']);
  expect(requests).toHaveLength(1);
  // A POST to the Valhalla server with the sent shape and attributes.
  const sent = JSON.parse(requests[0].body) as {
    filters: { attributes: string[] };
  };
  expect(sent).toMatchObject({ costing: 'auto', shape_match: 'map_snap' });
  expect(sent.filters.attributes).toContain('edge.surface');
  await setLanguage(page, 'pt');
  await expect(items(page)).toHaveText(['Asfalto80%', 'Sem asfalto20%']);
  // Units and another coloring and back reuse the answer kept.
  await chooseUnits(page, { distance: 'imperial' });
  await page.locator('#layers-toggle').click();
  await page.locator('[data-coloring="none"]').click();
  await page.keyboard.press('Escape');
  await chooseSurface(page);
  await expect(items(page)).toHaveCount(2);
  expect(requests).toHaveLength(1);
});

test('surface that fails without a connection loads once it returns', async ({
  page,
  context,
}) => {
  await setup(page);
  let offline = true;
  const requests = await mockTrace(page, (r) =>
    offline
      ? r.abort('internetdisconnected')
      : r.fulfill({ json: traceAnswer(r.request().postData()!) }),
  );
  await context.setOffline(true);
  await chooseSurface(page);
  await expect(legend(page)).toHaveText(
    'No connection. The surface will load when the connection returns.',
  );
  await expect(legend(page).locator('.route-legend-retry')).toHaveCount(0);
  const asked = requests.length;
  await page.waitForTimeout(1500);
  expect(requests).toHaveLength(asked);
  offline = false;
  await context.setOffline(false);
  await expect(items(page)).toHaveCount(2);
  expect(requests).toHaveLength(asked + 1);
});

test('a failed surface says so in the legend, and Try again asks once more', async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  const requests = await mockTrace(page, (r) =>
    fail
      ? r.fulfill({ status: 503 })
      : r.fulfill({ json: traceAnswer(r.request().postData()!) }),
  );
  await chooseSurface(page);
  await expect(legend(page).locator('.route-legend-status')).toHaveText(
    'Surface unavailable.',
  );
  fail = false;
  await legend(page).locator('.route-legend-retry').click();
  await expect(items(page)).toHaveText(['Paved80%', 'Unpaved20%']);
  expect(requests).toHaveLength(2);
});

test('a long route is asked in spaced pieces and a failed piece shows as unknown', async ({
  page,
}) => {
  // About 445 km: three pieces of up to 190 km.
  await setup(page, 4);
  const requests = await mockTrace(page, (r, i) =>
    i === 1
      ? r.fulfill({ status: 503 })
      : r.fulfill({ json: traceAnswer(r.request().postData()!) }),
  );
  await chooseSurface(page);
  await expect(items(page)).toHaveCount(3, { timeout: 15000 });
  expect(requests).toHaveLength(3);
  // Serialized on the routing queue, at least 1.5 s apart.
  for (let i = 1; i < requests.length; i++)
    expect(requests[i].at - requests[i - 1].at).toBeGreaterThanOrEqual(1400);
  await expect(items(page).last()).toContainText('Unknown');
});

test('editing a point asks again only for the pieces that changed', async ({
  page,
}) => {
  await setup(page, 4);
  const requests = await mockTrace(page);
  await chooseSurface(page);
  await expect(items(page)).toHaveCount(2, { timeout: 15000 });
  expect(requests).toHaveLength(3);
  // The same road comes back: every piece is in the page-memory cache.
  await page.locator('#location-1').fill('0, 4.0000001');
  await page.locator('#location-1').press('Tab');
  await expect(legend(page)).toHaveText('Loading surface…');
  await expect(items(page)).toHaveCount(2, { timeout: 10000 });
  expect(requests).toHaveLength(3);
});

test('an answer for an older route is discarded', async ({ page }) => {
  await setup(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const requests = await mockTrace(page, async (r, i) => {
    if (i === 0) await held;
    return r.fulfill({ json: traceAnswer(r.request().postData()!) });
  });
  await chooseSurface(page);
  await expect.poll(() => requests.length).toBe(1);
  // A new route while the first answer is pending.
  await page.locator('#location-1').fill('0, 0.5');
  await page.locator('#location-1').press('Tab');
  // The new route waits on the routing queue behind the held answer.
  release();
  // Only the new route's surface: about 55 km, gravel from 33 to 55 km.
  await expect(items(page)).toHaveText(['Paved60%', 'Unpaved40%'], {
    timeout: 10000,
  });
  expect(requests).toHaveLength(2);
});

// Each kind keeps its swatch, name and share together; the two usual kinds
// share one line from 320 px, and a third (Unknown) wraps whole.
for (const width of [320, 360, 390, 430])
  test(`the surface legend keeps its items whole and beside the credits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() =>
      localStorage.setItem('route-coloring', 'surface'),
    );
    await setup(page, 4);
    // A failed piece: paved, unpaved and unknown on the map.
    await mockTrace(page, (r, i) =>
      i === 1
        ? r.fulfill({ status: 503 })
        : r.fulfill({ json: traceAnswer(r.request().postData()!) }),
    );
    // The legend shows on the map once the sheet is lowered.
    await page.locator('#panel-toggle').click();
    await expect(items(page)).toHaveCount(3, { timeout: 15000 });
    const layout = () =>
      legend(page).evaluate((box) => {
        const credits = document
          .querySelector('.map-credits')!
          .getBoundingClientRect();
        const tops = [...box.children].map((c) =>
          Math.round(c.getBoundingClientRect().top),
        );
        return {
          right: box.getBoundingClientRect().right,
          credits: credits.left,
          // An item on two lines is taller than one line of the legend.
          tallest: Math.max(
            ...[...box.children].map((c) => c.getBoundingClientRect().height),
          ),
          firstTwo: tops[0] === tops[1],
        };
      });
    for (const language of ['pt', 'en']) {
      await setLanguage(page, language);
      await expect(items(page).last()).toContainText(
        language === 'pt' ? 'Sem dados' : 'Unknown',
      );
      const { right, credits, tallest, firstTwo } = await layout();
      expect(right).toBeLessThanOrEqual(credits);
      expect(tallest).toBeLessThan(26);
      expect(firstTwo).toBe(true);
    }
  });
