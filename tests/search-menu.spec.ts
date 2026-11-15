import { mockBasemap } from './map-helpers';
import { defaults, encodeState } from '../src/core';
import { test, expect, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:5173/';
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
  if (lang === 'en') await page.locator('#language').selectOption('en');
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
  await expect(page.locator('.leaflet-marker-icon.route-marker')).toHaveCount(
    2,
  );
});

test('My location sets the point to a position rounded to about 100 m', async ({
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
    '-22.912000, -43.177000',
  );
});

test('a locked route offers no menu in its fields', async ({ page }) => {
  await setup(page);
  await page.locator('#lock').click();
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
    await setup(page);
    await page.locator('#location-1').tap();
    const option = page
      .locator('#suggestions-1')
      .getByRole('option', { name: 'Choose on map' });
    await expect(option).toBeVisible();
    // The keyboard closing blurs the field before the tap arrives.
    await page.locator('#location-1').evaluate((input) => input.blur());
    const box = (await option.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + 40, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(page.locator('.placement-bar')).toContainText(
      'Move the map to place point 2',
    );
  });
});
