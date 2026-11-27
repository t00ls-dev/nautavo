import { mockBasemap } from './map-helpers';
import { defaults, encodeState } from '../src/core';
import { test, expect, type Page } from '@playwright/test';
import { base, boxSettled, setLanguage } from './app-helpers';

const coords = [
  '-22.930929, -43.238286',
  '-22.960000, -43.300000',
  '-23.000000, -43.400000',
  '-23.050160, -43.535240',
];

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
});
async function setup(page: Page, lang: 'en' | 'pt' = 'en') {
  await mockBasemap(page);
  await page.route('**/route/v1/driving/**', async (r) => {
    const part = new URL(r.request().url()).pathname.split('/driving/')[1];
    const points = part.split(';').map((p) => p.split(',').map(Number));
    await r.fulfill({
      json: {
        code: 'Ok',
        waypoints: points.map((location) => ({ location, distance: 0 })),
        routes: [
          {
            distance: 42000,
            duration: 2940,
            geometry: { coordinates: points },
            legs: points.slice(1).map(() => ({ steps: [] })),
          },
        ],
      },
    });
  });
  const state = defaults();
  state.points = coords.map((c, i) => ({
    name: `Point ${i + 1}`,
    coord: c.split(', ').map(Number) as [number, number],
  }));
  await page.goto(
    `${base}${lang === 'pt' ? '?lang=pt' : ''}${encodeState(state)}`,
  );
  if (lang === 'en') await setLanguage(page, 'en');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
}
const values = (page: Page) =>
  page
    .locator('#points input')
    .evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );

test('dragging a grip moves the point, renumbering the rows as it goes', async ({
  page,
}) => {
  await setup(page);
  // The summary, Trip options and the tabs come first (#305): the rows
  // are scrolled into the middle of the panel before the drag.
  await page
    .locator('#points')
    .evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await boxSettled(page, '#points');
  const grip = (await page.locator('.point-grip').nth(3).boundingBox())!;
  const x = grip.x + grip.width / 2,
    y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Two rows up (rows are 56 px apart).
  await page.mouse.move(x, y - 120, { steps: 8 });
  await expect(page.locator('#points li.dragging')).toHaveCount(1);
  await expect(page.locator('#points .point-number')).toHaveText([
    '1',
    '3',
    '4',
    '2',
  ]);
  await page.mouse.up();
  await expect(page.locator('#points li.dragging')).toHaveCount(0);
  expect(await values(page)).toEqual([
    coords[0],
    coords[3],
    coords[1],
    coords[2],
  ]);
  await expect(page.locator('#points .point-number')).toHaveText([
    '1',
    '2',
    '3',
    '4',
  ]);
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await page.locator('#undo').click();
  expect(await values(page)).toEqual(coords);
});

test('a press on the grip without moving changes nothing', async ({ page }) => {
  await setup(page);
  await page.locator('.point-grip').nth(1).click();
  expect(await values(page)).toEqual(coords);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('the arrow keys move a point from its focused grip', async ({ page }) => {
  await setup(page);
  const grip = page.locator('.point-grip').nth(1);
  await expect(grip).toHaveAccessibleName('Move point 2');
  await grip.focus();
  await page.keyboard.press('ArrowDown');
  expect(await values(page)).toEqual([
    coords[0],
    coords[2],
    coords[1],
    coords[3],
  ]);
  // Focus follows the point to its new row.
  await expect(page.locator('.point-grip').nth(2)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await values(page)).toEqual([
    coords[1],
    coords[0],
    coords[2],
    coords[3],
  ]);
  await expect(page.locator('.point-grip').first()).toBeFocused();
  // The first row cannot go further up.
  await page.keyboard.press('ArrowUp');
  expect((await values(page))[0]).toBe(coords[1]);
});

test('a locked route cannot be reordered', async ({ page }) => {
  await setup(page);
  await page.locator('#lock').click();
  await expect(page.locator('.point-grip').first()).toBeDisabled();
  const grip = (await page.locator('.point-grip').nth(3).boundingBox())!;
  await page.mouse.move(grip.x + 20, grip.y + 20);
  await page.mouse.down();
  await page.mouse.move(grip.x + 20, grip.y - 100, { steps: 5 });
  await page.mouse.up();
  expect(await values(page)).toEqual(coords);
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 320, height: 640 },
    isMobile: true,
    hasTouch: true,
  });
  test('a touch drag reorders without scrolling the panel, in Portuguese', async ({
    page,
  }) => {
    await setup(page, 'pt');
    await expect(page.locator('.point-grip').first()).toHaveAccessibleName(
      'Mover ponto 1',
    );
    // The route's numbers come first on the sheet (#206), so at half height
    // the rows sit at its bottom: open it fully, as a traveler would.
    await page.locator('#panel-toggle').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('body')).toHaveClass(/sheet-full/);
    await page
      .locator('#points')
      .evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await boxSettled(page, '#points');
    const grip = (await page.locator('.point-grip').first().boundingBox())!;
    const x = grip.x + grip.width / 2,
      y = grip.y + grip.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', py = y) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: py }],
      });
    await touch('touchStart');
    for (let k = 1; k <= 8; k++) await touch('touchMove', y + 9 * k);
    await expect(page.locator('#points li.dragging')).toHaveCount(1);
    await touch('touchEnd');
    expect(await values(page)).toEqual([
      coords[1],
      coords[0],
      coords[2],
      coords[3],
    ]);
    // Every row keeps its controls on one line at 320 px.
    const rows = await page
      .locator('#points li')
      .evaluateAll((items) =>
        items.map((li) => Math.round(li.getBoundingClientRect().height)),
      );
    expect(rows).toEqual([48, 48, 48, 48]);
  });
});

for (const language of ['en', 'pt'] as const)
  test(`empty fields name their role and fit at 320 px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(language === 'pt' ? `${base}?lang=pt` : base);
    // Add stop shows from the first point on (#306).
    await page.locator('#location-0').fill('-22.93, -43.24');
    await page.locator('#location-0').press('Tab');
    await page.locator('#add').click();
    const fields = await page.locator('#points input').evaluateAll((inputs) =>
      inputs.map((element) => {
        const input = element as HTMLInputElement;
        const style = getComputedStyle(input);
        const room =
          input.getBoundingClientRect().width -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) -
          parseFloat(style.borderLeftWidth) -
          parseFloat(style.borderRightWidth);
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return {
          text: input.placeholder,
          fits: context.measureText(input.placeholder).width <= room,
        };
      }),
    );
    expect(fields).toEqual(
      (language === 'pt'
        ? ['Início', 'Adicionar parada', 'Destino']
        : ['Starting point', 'Add a stop', 'Destination']
      ).map((text) => ({ text, fits: true })),
    );
  });
