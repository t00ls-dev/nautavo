import { test, expect, type Page } from '@playwright/test';
import { holdMap, mapIdle, mapReady, mockBasemap } from './map-helpers';
import { base, mockRouting, setLanguage } from './app-helpers';

/** Turning the planner map (#133): gestures, compass and a turned map. */
const start = '-22.9068, -43.1729',
  end = '-22.99, -43.3';

async function setup(page: Page) {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(page);
  await mockRouting(page, { distance: 15000, duration: 900 });
  await page.goto(base);
  await mapReady(page);
}
async function route(page: Page) {
  await page.locator('#location-0').fill(start);
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
}
const bearing = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { plannerMap: { getBearing(): number } }
    ).plannerMap.getBearing(),
  );
const turn = (page: Page, degrees: number) =>
  page.evaluate((d) => {
    (
      window as unknown as {
        plannerMap: { gl(): { setBearing(b: number): void } };
      }
    ).plannerMap
      .gl()
      .setBearing(d);
  }, degrees);
/** Where a coordinate is on the page. */
const onPage = async (page: Page, coord: [number, number]) => {
  const box = (await page.locator('#map').boundingBox())!;
  const p = await page.evaluate(
    (c) =>
      (
        window as unknown as {
          plannerMap: {
            project(c: [number, number]): { x: number; y: number };
          };
        }
      ).plannerMap.project(c),
    coord,
  );
  return { x: p.x + box.x, y: p.y + box.y };
};

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a right drag turns the map, the compass shows and puts north up again', async ({
    page,
  }) => {
    await setup(page);
    await route(page);
    await page.locator('#fit').click();
    const compass = page.locator('#compass');
    await expect(compass).toBeHidden();
    // Above the route, clear of the handle that adds a stop from its line.
    await page.mouse.move(800, 250);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(900, 250, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await mapIdle(page);
    expect(Math.abs(await bearing(page))).toBeGreaterThan(20);
    // Turning is not a choice of a point.
    await expect(page.locator('#point-menu')).toBeHidden();
    await expect(compass).toBeVisible();
    await expect(compass).toHaveAccessibleName('North up');
    // The route stays framed at the same turn.
    const turned = await bearing(page);
    await page.locator('#fit').click();
    expect(await bearing(page)).toBeCloseTo(turned, 5);
    // A right click without a drag still opens the point menu.
    await page.mouse.click(700, 300, { button: 'right' });
    await expect(page.locator('#point-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await setLanguage(page, 'pt');
    await expect(compass).toHaveAccessibleName('Norte para cima');
    await compass.click();
    await expect.poll(() => bearing(page)).toBe(0);
    await expect(compass).toBeHidden();
  });

  test('on a turned map a dragged point lands under the pointer and the map click sets the selected point', async ({
    page,
  }) => {
    await setup(page);
    await route(page);
    await turn(page, 70);
    await page.locator('#fit').click();
    await mapIdle(page);
    const marker = page.locator('.route-marker').nth(1);
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + 15, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 75, box.y + 35, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('#location-1')).not.toHaveValue(end);
    const value = (await page.locator('#location-1').inputValue())
      .split(',')
      .map(Number) as [number, number];
    // The tip (15, 36 in the pin) follows the pointer exactly.
    const tip = await onPage(page, value);
    expect(Math.abs(tip.x - (box.x + 75))).toBeLessThan(1.5);
    expect(Math.abs(tip.y - (box.y + 35 + 21))).toBeLessThan(1.5);
    // A click sets the point chosen in the list where it was clicked.
    await page.getByRole('button', { name: 'Select point 2' }).click();
    await mapIdle(page);
    await page.mouse.click(700, 420);
    const clicked = (await page.locator('#location-1').inputValue())
      .split(',')
      .map(Number) as [number, number];
    const at = await onPage(page, clicked);
    expect(Math.abs(at.x - 700)).toBeLessThan(1.5);
    expect(Math.abs(at.y - 420)).toBeLessThan(1.5);
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  /** Two fingers 160 px apart around the map, turned by `degrees` as they move. */
  async function twoFingers(page: Page, degrees: number, spread = 1) {
    const box = (await page.locator('#map').boundingBox())!;
    const cx = box.x + 195,
      cy = box.y + 220,
      r = 80;
    const session = await page.context().newCDPSession(page);
    const points = (angle: number, radius: number) => {
      const a = (angle * Math.PI) / 180;
      return [
        { x: cx - radius * Math.cos(a), y: cy - radius * Math.sin(a), id: 0 },
        { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), id: 1 },
      ];
    };
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(0, r),
    });
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points(
          (degrees * step) / 12,
          r * (1 + ((spread - 1) * step) / 12),
        ),
      });
      await page.waitForTimeout(25);
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
    await mapIdle(page);
  }

  test('two fingers turn the map past a threshold; a pinch with a small twist only zooms', async ({
    page,
  }) => {
    await setup(page);
    await page.locator('#panel-toggle').click();
    const zoom = () =>
      page.evaluate(() =>
        (
          window as unknown as { plannerMap: { getZoom(): number } }
        ).plannerMap.getZoom(),
      );
    const before = await zoom();
    await twoFingers(page, 6, 1.6);
    expect(await zoom()).toBeGreaterThan(before + 0.3);
    expect(await bearing(page)).toBe(0);
    await expect(page.locator('#compass')).toBeHidden();
    await twoFingers(page, 50);
    expect(Math.abs(await bearing(page))).toBeGreaterThan(20);
    await expect(page.locator('#compass')).toBeVisible();
    await expect(page.locator('#point-menu')).toBeHidden();
  });

  test('a long press on a turned map opens the point menu for the pressed place', async ({
    page,
  }) => {
    let asked: string | null = null;
    await setup(page);
    await page.route('**/v1/elevation?**', (r) => {
      asked = new URL(r.request().url()).searchParams.get('latitude');
      return r.fulfill({ json: { elevation: [12] } });
    });
    await page.locator('#panel-toggle').click();
    await turn(page, 90);
    await mapIdle(page);
    await holdMap(page, 120, 200);
    await expect(page.locator('#point-menu')).toBeVisible();
    // Before the popup pans the map into view.
    const box = (await page.locator('#map').boundingBox())!;
    const pressed = await page.evaluate(
      (p) =>
        (
          window as unknown as {
            plannerMap: { unproject(p: { x: number; y: number }): number[] };
          }
        ).plannerMap.unproject(p),
      { x: 120, y: 200 },
    );
    await page.locator('#point-menu').getByRole('menuitem').click();
    await expect(page.locator('.elevation-point-value')).toContainText('12');
    expect(Number(asked)).toBeCloseTo(pressed[0], 2);
    expect(box.width).toBe(390);
  });

  for (const [width, language] of [
    [320, 'pt'],
    [390, 'en'],
  ] as const)
    test(`the compass fits the tool column at ${width}px (${language})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await setup(page);
      await setLanguage(page, language);
      await page.locator('#panel-toggle').click();
      await turn(page, 45);
      const compass = page.locator('#compass');
      await expect(compass).toBeVisible();
      const box = (await compass.boundingBox())!;
      // Below the tool column, whose last button is More map tools (#307).
      const undo = (await page.locator('#map-more').boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(box.x - undo.x)).toBeLessThan(1);
      expect(box.y).toBeGreaterThanOrEqual(undo.y + undo.height + 8);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expect(compass).toHaveAccessibleName(
        language === 'pt' ? 'Norte para cima' : 'North up',
      );
    });
});
