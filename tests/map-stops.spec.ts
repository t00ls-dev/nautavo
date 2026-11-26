import { closePanel, mapIdle, mapReady, mockBasemap } from './map-helpers';
import { defaults, encodeState, type Coord } from '../src/core';
import { test, expect, type Page } from '@playwright/test';
import {
  base,
  mockRouting,
  routedPoints,
  setLanguage,
  mapTool,
  undo,
} from './app-helpers';

const start: Coord = [-22.930929, -43.238286];
const destination: Coord = [-23.05016, -43.53524];

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
});
/**
 * Adding and removing stops on the map (#285): the route line's handle
 * (src/route-drag.ts), the trash zone and a marker's popup
 * (src/point-removal.ts).
 */

/** A place on the straight line between the two points, `share` along it. */
const along = (share: number): Coord => [
  start[0] + (destination[0] - start[0]) * share,
  start[1] + (destination[1] - start[1]) * share,
];
/**
 * A route (straight, as the mock answers), with its map idle: two points, or
 * three with a stop halfway.
 */
async function setup(
  page: Page,
  { stop = false, lang = 'en' }: { stop?: boolean; lang?: 'en' | 'pt' } = {},
) {
  await mockBasemap(page);
  await mockRouting(page);
  const state = defaults();
  state.points = [
    { name: 'Start', coord: start },
    ...(stop ? [{ name: 'Stop 1', coord: along(0.5) }] : []),
    { name: 'Destination', coord: destination },
  ];
  await page.goto(
    `${base}${lang === 'pt' ? '?lang=pt' : ''}${encodeState(state)}`,
  );
  if (lang === 'en') await setLanguage(page, 'en');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await mapReady(page);
  await mapIdle(page);
}
/** Page position of a place on the planner map. */
async function onPage(page: Page, coord: Coord) {
  const point = await page.evaluate(
    (c) =>
      (
        window as unknown as {
          plannerMap: { project(c: Coord): { x: number; y: number } };
        }
      ).plannerMap.project(c),
    coord,
  );
  const box = (await page.locator('#map').boundingBox())!;
  return { x: box.x + point.x, y: box.y + point.y };
}
/** Every route request the page sends from now on, by its point count. */
function routeRequests(page: Page) {
  const counts: number[] = [];
  page.on('request', (request) => {
    const n = routedPoints(request.url());
    if (n !== null) counts.push(n);
  });
  return counts;
}
const handle = (page: Page) => page.locator('.route-handle');
const pointFields = (page: Page) => page.locator('#points input[id^=location]');
const markers = (page: Page) => page.locator('.maplibregl-marker.route-marker');
const trash = (page: Page) => page.locator('.map-trash');
const popup = (page: Page) => page.locator('.point-popup');
/** Page position of the trash zone's circle. */
async function trashCircle(page: Page) {
  const box = (await trash(page).locator('span').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
/**
 * Takes marker `n` by its head with the mouse and moves it so its tip lands
 * on `to`.
 */
async function dragMarker(
  page: Page,
  n: number,
  to: () => Promise<{ x: number; y: number }>,
) {
  const box = (await markers(page).nth(n).boundingBox())!;
  // The head is 22 px above the tip (anchor 15, 36).
  await page.mouse.move(box.x + 15, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 40, { steps: 4 });
  const target = await to();
  await page.mouse.move(target.x, target.y - 22, { steps: 8 });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('dragging the line inserts a stop between the points of its leg', async ({
    page,
  }) => {
    await setup(page);
    const requests = routeRequests(page);
    const middle = await onPage(page, along(0.5));
    // Away from the line, no handle.
    await page.mouse.move(middle.x + 60, middle.y - 60);
    await expect(handle(page)).toHaveCount(0);
    await page.mouse.move(middle.x + 4, middle.y + 3);
    await expect(handle(page)).toBeVisible();
    // Hovering and dragging ask nothing.
    await page.mouse.down();
    await page.mouse.move(middle.x + 40, middle.y + 80, { steps: 8 });
    await expect(page.locator('.route-handle.dragging')).toBeVisible();
    expect(requests).toEqual([]);
    await page.mouse.up();
    await expect(pointFields(page)).toHaveCount(3);
    await expect(page.locator('#download')).toBeEnabled();
    // One route request, through the new stop.
    expect(requests).toEqual([3]);
    // Undo returns to the route without the stop, without a request.
    await undo(page);
    await expect(pointFields(page)).toHaveCount(2);
    expect(requests).toEqual([3]);
  });

  test('a click on the handle adds the stop where it is', async ({ page }) => {
    await setup(page);
    const quarter = await onPage(page, along(0.25));
    await page.mouse.move(quarter.x, quarter.y);
    await expect(handle(page)).toBeVisible();
    await page.mouse.click(quarter.x, quarter.y);
    await expect(pointFields(page)).toHaveCount(3);
    // The stop is the second point, on the line.
    const [lat, lon] = (await pointFields(page).nth(1).inputValue())
      .split(',')
      .map(Number);
    expect(Math.abs(lat - along(0.25)[0])).toBeLessThan(0.002);
    expect(Math.abs(lon - along(0.25)[1])).toBeLessThan(0.002);
  });

  test('no handle while the route is locked', async ({ page }) => {
    await setup(page);
    await mapTool(page, 'lock');
    await expect(page.locator('#lock')).toHaveAttribute('aria-pressed', 'true');
    const middle = await onPage(page, along(0.5));
    await page.mouse.move(middle.x, middle.y);
    await page.waitForTimeout(200);
    await expect(handle(page)).toHaveCount(0);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a stop dropped on the trash zone leaves the route', async ({
    page,
  }) => {
    await setup(page, { stop: true });
    const requests = routeRequests(page);
    await expect(trash(page)).toBeHidden();
    await dragMarker(page, 1, () => trashCircle(page));
    await expect(trash(page)).toBeVisible();
    await expect(trash(page)).toHaveClass(/hot/);
    await expect(trash(page)).toContainText('Release to remove');
    await page.mouse.up();
    await expect(trash(page)).toBeHidden();
    await expect(pointFields(page)).toHaveCount(2);
    await expect(page.locator('#download')).toBeEnabled();
    expect(requests).toEqual([2]);
    // Undo brings it back with its route, without a request.
    await undo(page);
    await expect(pointFields(page)).toHaveCount(3);
    expect(requests).toEqual([2]);
  });

  test('away from the trash the drag only moves the stop', async ({ page }) => {
    await setup(page, { stop: true });
    const box = (await markers(page).nth(1).boundingBox())!;
    await dragMarker(page, 1, async () => ({ x: box.x + 80, y: box.y - 60 }));
    await expect(trash(page)).toBeVisible();
    await expect(trash(page)).not.toHaveClass(/hot/);
    await expect(trash(page)).toContainText('Drag here to remove');
    await page.mouse.up();
    await expect(trash(page)).toBeHidden();
    await expect(pointFields(page)).toHaveCount(3);
  });

  test('with two points there is no trash zone or Remove', async ({ page }) => {
    await setup(page);
    const map = (await page.locator('#map').boundingBox())!;
    await dragMarker(page, 1, async () => ({
      x: map.x + map.width / 2,
      y: map.y + map.height / 2,
    }));
    await expect(trash(page)).toBeHidden();
    await page.mouse.up();
    await expect(page.locator('#download')).toBeEnabled();
    await mapIdle(page);
    await markers(page).last().click();
    await expect(popup(page)).toHaveCount(0);
  });

  test('a click or right click on a stop offers Remove', async ({ page }) => {
    await setup(page, { stop: true });
    await markers(page).nth(1).click();
    await expect(popup(page)).toBeVisible();
    // Its number, as on the marker, and its place on the route.
    await expect(popup(page).locator('.point-popup-number')).toHaveText('2');
    await expect(popup(page).locator('strong')).toHaveText(/^(km|mi)\s\d/);
    // A click elsewhere on the map closes it: its left edge, clear of the
    // route and the popup.
    const map = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(map.x + 30, map.y + map.height / 2);
    await expect(popup(page)).toHaveCount(0);
    await markers(page).nth(1).click({ button: 'right' });
    // Not the map point menu: the stop's own popup.
    await expect(page.locator('#point-menu')).toBeHidden();
    await popup(page).getByRole('button', { name: 'Remove stop' }).click();
    await expect(pointFields(page)).toHaveCount(2);
    await expect(popup(page)).toHaveCount(0);
  });

  test('Delete removes the focused stop', async ({ page }) => {
    await setup(page, { stop: true });
    await markers(page).nth(1).focus();
    await page.keyboard.press('Delete');
    await expect(pointFields(page)).toHaveCount(2);
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('a tap on the line shows the handle, a tap on it adds the stop', async ({
    page,
  }) => {
    await setup(page);
    await closePanel(page);
    const middle = await onPage(page, along(0.5));
    await page.touchscreen.tap(middle.x + 6, middle.y);
    await expect(handle(page)).toBeVisible();
    // A tap elsewhere takes it away.
    await page.touchscreen.tap(middle.x + 100, middle.y - 120);
    await expect(handle(page)).toHaveCount(0);
    await page.touchscreen.tap(middle.x, middle.y);
    await expect(handle(page)).toBeVisible();
    // Past the double tap: a second touch that soon is MapLibre's zoom
    // gesture, and its touch on a marker is cancelled (src/tap-hold.ts).
    await page.waitForTimeout(600);
    await handle(page).tap();
    await expect(pointFields(page)).toHaveCount(3);
  });

  for (const width of [320, 390])
    test(`a tapped stop's popup fits and removes it at ${width} px (pt)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await setup(page, { stop: true, lang: 'pt' });
      await closePanel(page);
      await markers(page).nth(1).tap();
      const remove = popup(page).getByRole('button', {
        name: 'Remover parada',
      });
      await expect(remove).toBeVisible();
      // Whole in the map, its button on one line.
      const box = (await popup(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const button = (await remove.boundingBox())!;
      expect(button.height).toBeLessThan(50);
      // The point's name is never cut (a long one may wrap), and a stop's
      // number and place on the route fit on one line.
      const name = popup(page).locator('strong');
      await expect(name).toHaveText(/^km\s\d/);
      await expect(popup(page).locator('.point-popup-number')).toHaveText('2');
      expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      const lineHeight = await name.evaluate((e) =>
        parseFloat(getComputedStyle(e).lineHeight),
      );
      expect((await name.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
      await remove.tap();
      await expect(pointFields(page)).toHaveCount(2);
    });

  test('with the crosshair, a tapped stop offers Move point', async ({
    page,
  }) => {
    await setup(page, { stop: true });
    await page.locator('#open-settings').click();
    await page
      .locator('#point-placement')
      .selectOption({ label: 'Tap, then move the map' });
    await page.locator('#close-settings').click();
    await closePanel(page);
    await markers(page).nth(1).tap();
    await popup(page).getByRole('button', { name: 'Move point' }).tap();
    await expect(page.locator('.placement-bar')).toContainText(
      'Move the map to place point 2',
    );
  });
});
