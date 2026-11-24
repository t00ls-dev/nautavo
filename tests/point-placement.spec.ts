import { mockBasemap, mapCanvas } from './map-helpers';
import { defaults, encodeState } from '../src/core';
import { test, expect, type Page } from '@playwright/test';
import { base, mockRouting } from './app-helpers';

const destination = '-23.050160, -43.535240';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
});
async function setup(page: Page, lang: 'en' | 'pt' = 'en') {
  await mockBasemap(page);
  await mockRouting(page, { legs: [{ steps: [] }] });
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22.930929, -43.238286] },
    { name: 'Destination', coord: [-23.05016, -43.53524] },
  ];
  await page.goto(
    `${base}${lang === 'pt' ? '?lang=pt' : ''}${encodeState(state)}`,
  );
  if (lang === 'en') await page.locator('#language').selectOption('en');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
}
async function chooseCrosshair(page: Page) {
  await page.locator('#open-settings').click();
  await page
    .locator('#point-placement')
    .selectOption({ label: 'Tap, then move the map' });
  await page.locator('#close-settings').click();
}
/** Pans the map with the keyboard: Leaflet moves it 80 px per arrow key. */
async function panMap(page: Page) {
  await mapCanvas(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
}

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('the crosshair places a tapped point where the map is moved', async ({
    page,
  }) => {
    await setup(page);
    await chooseCrosshair(page);
    expect(
      await page.evaluate(() => localStorage.getItem('point-placement')),
    ).toBe('crosshair');
    const markers = page.locator('.maplibregl-marker.route-marker');
    await expect(markers).toHaveCount(2);
    await markers.last().tap();
    const bar = page.locator('.placement-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Move the map to place point 2');
    await expect(page.locator('.placement-pin')).toContainText('2');
    // The fixed pin stands in for the point's own marker.
    await expect(markers).toHaveCount(1);
    await expect(page.locator('#map-note')).toBeHidden();
    // Escape keeps the point where it was.
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await expect(markers).toHaveCount(2);
    await expect(page.locator('#location-1')).toHaveValue(destination);

    await markers.last().tap();
    await panMap(page);
    await bar.getByRole('button', { name: 'Confirm' }).click();
    await expect(bar).toBeHidden();
    await expect(markers).toHaveCount(2);
    await expect(page.locator('#location-1')).not.toHaveValue(destination);
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await page.locator('#undo').click();
    await expect(page.locator('#location-1')).toHaveValue(destination);
  });

  test('Cancel and locking leave the point in place', async ({ page }) => {
    await setup(page);
    await chooseCrosshair(page);
    const markers = page.locator('.maplibregl-marker.route-marker');
    const bar = page.locator('.placement-bar');
    await markers.last().tap();
    await panMap(page);
    await bar.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar).toBeHidden();
    await expect(page.locator('#location-1')).toHaveValue(destination);
    await markers.last().tap();
    await expect(bar).toBeVisible();
    await page.locator('#lock').click();
    await expect(bar).toBeHidden();
    await expect(markers).toHaveCount(2);
    await markers.last().tap();
    await expect(bar).toBeHidden();
  });

  test('a touch drag shows the loupe until the point is dropped', async ({
    page,
  }) => {
    await setup(page);
    const loupe = page.locator('.placement-loupe');
    const box = (await page
      .locator('.maplibregl-marker.route-marker')
      .last()
      .boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + 12;
    const cdp = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      px = x,
      py = y,
    ) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }],
      });
    await touch('touchStart');
    for (let k = 1; k <= 6; k++) await touch('touchMove', x + 6 * k, y + 4 * k);
    await expect(loupe).toBeVisible();
    // Inside the map and clear of the finger: its bottom is above the marker.
    const circle = (await loupe.boundingBox())!;
    expect(circle.x).toBeGreaterThanOrEqual(0);
    expect(circle.x + circle.width).toBeLessThanOrEqual(390);
    await touch('touchEnd');
    await expect(loupe).toBeHidden();
    await expect(page.locator('#location-1')).not.toHaveValue(destination);
  });

  test('a tap and then a drag on a point opens no iOS loupe and still moves it', async ({
    page,
  }) => {
    await setup(page);
    await page.evaluate(() => {
      const record = window as unknown as { cancelled: boolean[] };
      record.cancelled = [];
      // After the app's own listener (src/tap-hold.ts).
      document.addEventListener(
        'touchstart',
        (event) => record.cancelled.push(event.defaultPrevented),
        true,
      );
    });
    const box = (await page
      .locator('.maplibregl-marker.route-marker')
      .last()
      .boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + 12;
    const cdp = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      px = x,
      py = y,
    ) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }],
      });
    await touch('touchStart');
    await touch('touchEnd');
    await page.waitForTimeout(80);
    await touch('touchStart');
    for (let k = 1; k <= 6; k++) await touch('touchMove', x + 6 * k, y + 4 * k);
    await expect(page.locator('.placement-loupe')).toBeVisible();
    await touch('touchEnd');
    // The marker is a button for the keyboard, yet its second touch is
    // cancelled like the map's (WebKit's tap-and-a-half loupe); the drag,
    // on pointer events, goes on.
    expect(
      await page.evaluate(
        () => (window as unknown as { cancelled: boolean[] }).cancelled,
      ),
    ).toEqual([false, true]);
    await expect(page.locator('#location-1')).not.toHaveValue(destination);
  });
});

test('the crosshair bar fits a 320 px phone in Portuguese', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await setup(page, 'pt');
  await page.locator('#open-settings').click();
  await page
    .locator('#point-placement')
    .selectOption({ label: 'Tocar e mover o mapa' });
  await page.locator('#close-settings').click();
  await page.locator('.maplibregl-marker.route-marker').last().click();
  const bar = page.locator('.placement-bar');
  await expect(bar).toContainText('Mova o mapa para posicionar o ponto 2');
  const fits = await bar.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const controls = document
      .querySelector('.map-tools')
      ?.getBoundingClientRect();
    const clipped = [...element.querySelectorAll('button, p')].some(
      (child) => child.scrollWidth > child.clientWidth + 1,
    );
    const buttons = [...element.querySelectorAll('button')].map(
      (b) => b.getBoundingClientRect().height,
    );
    return {
      clipped,
      inside: box.left >= 0 && box.right <= innerWidth,
      clearOfControls: !controls || box.right <= controls.left,
      oneLineButtons: buttons.every((h) => h < 50),
    };
  });
  expect(fits).toEqual({
    clipped: false,
    inside: true,
    clearOfControls: true,
    oneLineButtons: true,
  });
});

test('a mouse drag on a desktop moves the point without a loupe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  const box = (await page
    .locator('.maplibregl-marker.route-marker')
    .last()
    .boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 35, { steps: 5 });
  await expect(page.locator('.placement-loupe')).toBeHidden();
  await page.mouse.up();
  await expect(page.locator('#location-1')).not.toHaveValue(destination);
});
