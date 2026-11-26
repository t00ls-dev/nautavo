import { mockBasemap } from './map-helpers';
import { defaults, encodeState } from '../src/core';
import { test, expect, type Page } from '@playwright/test';
import { base, boxSettled, setLanguage, mapTool } from './app-helpers';

const start = '-22.900000, -43.100000';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
});
async function setup(page: Page, lang: 'en' | 'pt' = 'en') {
  await mockBasemap(page);
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({
      json: {
        features: [
          {
            geometry: { type: 'Point', coordinates: [-43.0, -22.9] },
            properties: {
              name: 'Posto Shell',
              street: 'Avenida Roberto Silveira',
              city: 'Maricá',
              country: 'Brasil',
            },
          },
        ],
      },
    }),
  );
  await page.route('**/route/v1/driving/**', async (r) => {
    const part = new URL(r.request().url()).pathname.split('/driving/')[1];
    const points = part.split(';').map((p) => p.split(',').map(Number));
    await r.fulfill({
      json: {
        code: 'Ok',
        waypoints: points.map((location) => ({ location, distance: 0 })),
        routes: [
          {
            distance: 10000,
            duration: 600,
            geometry: { coordinates: points },
            legs: points.slice(1).map(() => ({ steps: [] })),
          },
        ],
      },
    });
  });
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22.9, -43.1] },
    { name: 'Destination', coord: null },
  ];
  await page.goto(
    `${base}${lang === 'pt' ? '?lang=pt' : ''}${encodeState(state)}`,
  );
  if (lang === 'en') await setLanguage(page, 'en');
  await expect(page.locator('#location-0')).toHaveValue(start);
}

test('a focused field offers My location and Choose on map, then places with their distance', async ({
  page,
}) => {
  await setup(page);
  const menu = page.locator('#suggestions-1');
  await page.locator('#location-1').focus();
  await expect(menu.getByRole('option')).toHaveText([
    'My location',
    'Choose on map',
  ]);
  await expect(page.locator('#location-1')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.locator('#location-1').pressSequentially('posto');
  const place = menu.locator('.suggestion-place');
  await expect(place).toHaveCount(1);
  await expect(place.locator('b')).toHaveText('Posto Shell');
  await expect(place.locator('small')).toHaveText(
    'Avenida Roberto Silveira, Maricá, Brasil',
  );
  // From the start, 0.1° of longitude away at this latitude.
  await expect(place.locator('em')).toHaveText('10.2 km');
  await expect(place).toHaveAccessibleName(
    'Posto Shell, Avenida Roberto Silveira, Maricá, Brasil, 10.2 km',
  );
  await page.keyboard.press('Escape');
  await expect(menu.getByRole('option')).toHaveCount(0);
});

test('Choose on map places an empty point under the crosshair', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('#location-1').focus();
  await page
    .locator('#suggestions-1')
    .getByRole('option', { name: 'Choose on map' })
    .click();
  const bar = page.locator('.placement-bar');
  await expect(bar).toContainText('Move the map to place point 2');
  await expect(page.locator('.placement-pin')).toBeVisible();
  await bar.getByRole('button', { name: 'Confirm' }).click();
  await expect(bar).toBeHidden();
  await expect(page.locator('#location-1')).toHaveValue(
    /^-?\d+\.\d{6}, -?\d+\.\d{6}$/,
  );
  await expect(page.locator('.maplibregl-marker.route-marker')).toHaveCount(2);
});

test('My location sets the point to the exact position', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({
    latitude: -22.912345,
    longitude: -43.176543,
    accuracy: 10,
  });
  await setup(page, 'pt');
  await page.locator('#location-1').focus();
  await page
    .locator('#suggestions-1')
    .getByRole('option', { name: 'Minha localização' })
    .click();
  await expect(page.locator('#location-1')).toHaveValue(
    '-22.912345, -43.176543',
  );
});

test('a locked route offers no menu in its fields', async ({ page }) => {
  await setup(page);
  await mapTool(page, 'lock');
  await page.locator('#location-1').focus();
  await expect(page.locator('#suggestions-1').getByRole('option')).toHaveCount(
    0,
  );
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('a tap still chooses when the field lost focus first, as on iPhones', async ({
    page,
  }) => {
    // The page's clock is held while the tap arrives, so the 300 ms the list
    // waits after a blur does not depend on how fast the test machine is.
    await page.clock.install();
    await setup(page);
    await page.locator('#location-1').tap();
    const option = page
      .locator('#suggestions-1')
      .getByRole('option', { name: 'Choose on map' });
    await expect(option).toBeVisible();
    // The field raised the sheet (#204): aim once the menu stops moving.
    await boxSettled(page, '#suggestions-1');
    const box = (await option.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + 40, y: box.y + box.height / 2 };
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    // The keyboard closing blurs the field before the tap arrives.
    await page.locator('#location-1').evaluate((input) => input.blur());
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.clock.resume();
    await expect(page.locator('.placement-bar')).toContainText(
      'Move the map to place point 2',
    );
  });
  test('a tapped suggestion sets its point and presses nothing under the finger (#256)', async ({
    page,
  }) => {
    await setup(page);
    // A new route: Start is empty and the sheet starts low, as on a first visit.
    await page.goto(base);
    await setLanguage(page, 'en');
    const field = page.locator('#location-0');
    await field.tap();
    await field.pressSequentially('posto');
    const place = page
      .locator('#suggestions-0')
      .getByRole('option', { name: /Posto Shell/ });
    await expect(place).toBeVisible();
    await boxSettled(page, '#suggestions-0');
    const box = (await place.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // The list closes as the finger lifts; the click the browser sends after
    // the touch then lands on whatever moved under it.
    await page.touchscreen.tap(point.x, point.y);
    await expect(field).toHaveValue(/^Posto Shell/);
    // The case only means something while a control sits under the finger.
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('button, summary, input')
            ?.tagName,
        point,
      ),
    ).toBeTruthy();
    // A click that slipped through would land right after the tap.
    await page.waitForTimeout(300);
    await expect(field).toHaveValue(/^Posto Shell/);
    await expect(page.locator('#location-1')).toHaveValue('');
    // Trip options, which show from the first point on (#306), stay closed.
    await expect(page.locator('#trip-options')).not.toHaveAttribute('open', '');
  });
});
