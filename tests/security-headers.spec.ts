import { test, expect, type Page } from '@playwright/test';
import { previewBase, mockRegion } from './app-helpers';
import { mapCanvas, mockBasemap } from './map-helpers';
import { SECURITY_HEADERS } from '../src/security-headers';

/** Content Security Policy problems: blocked loads and rejected sources. */
function watchPolicy(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text()))
      problems.push(message.text());
  });
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.fulfill({ status: 204 }));
  await mockBasemap(page);
  await mockRegion(page);
});

test('the production build sends the security headers on every page', async ({
  page,
}) => {
  for (const path of ['', 'help', 'changelog']) {
    const response = await page.request.get(previewBase + path);
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      expect(response.headers()[name.toLowerCase()], `${path} ${name}`).toBe(
        value,
      );
  }
});

test('the app, its map layers and the help pages run under the policy', async ({
  page,
}) => {
  const problems = watchPolicy(page);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto(previewBase);
  await expect(mapCanvas(page)).toBeVisible();
  await expect
    .poll(() => requested.some((url) => url.includes('/planet/')))
    .toBe(true);
  // Topographic draws contours in maplibre-contour's blob: worker.
  for (const [layer, tiles] of [
    ['Topographic', 'elevation-tiles-prod/terrarium'],
    ['Satellite', 'tiles.maps.eox.at'],
  ]) {
    await page.locator('#layers-toggle').click();
    await page.getByRole('menuitemradio', { name: layer, exact: true }).click();
    await expect
      .poll(() => requested.some((url) => url.includes(tiles)))
      .toBe(true);
  }
  for (const path of ['help', 'changelog?lang=pt']) {
    await page.goto(previewBase + path);
    await expect(page.locator('h1:visible')).toBeVisible();
  }
  expect(problems).toEqual([]);
});
