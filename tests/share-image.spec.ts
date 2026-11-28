import { test, expect, type Page } from '@playwright/test';
import { defaults, encodeState } from '../src/core';
import { activityGpx, ride } from './activity-fixture';
import { base, exportAs, mockRouting, setLanguage } from './app-helpers';
import { mapReady, mockBasemap } from './map-helpers';

/**
 * The share image (#45): Route image in the Export menu and Share image in a
 * recorded activity open the sheet, draw the image on the device and save
 * it as a PNG. Every service answers empty, so the image has no weather or
 * climbs to show; the base map and routing are mocked.
 */
async function setup(page: Page) {
  const requests: string[] = [];
  await page.route('https://**/*', (r) => {
    requests.push(r.request().url());
    return r.fulfill({ status: 204 });
  });
  await mockBasemap(page);
  await mockRouting(page);
  await page.addInitScript(() => {
    localStorage.setItem('detect-region', 'off');
    localStorage.setItem('distance-units', 'metric');
    localStorage.setItem('temperature-units', 'celsius');
  });
  return requests;
}
async function openRoute(page: Page, lang: 'en' | 'pt' = 'en') {
  const state = defaults();
  state.name = 'Lake loop';
  state.points = [
    { name: 'Town square', coord: [48.85, 2.35] },
    { name: 'Lookout', coord: [48.87, 2.4] },
  ];
  await page.goto(
    `${base}${lang === 'pt' ? '?lang=pt' : ''}${encodeState(state)}`,
  );
  if (lang === 'en') await setLanguage(page, 'en');
  await expect(page.locator('#share-image')).toBeEnabled({ timeout: 15000 });
  await mapReady(page);
}
/** The size of the image the sheet shows, once it is drawn. */
async function previewSize(page: Page) {
  await expect(page.locator('#share-image-share')).toBeEnabled({
    timeout: 20000,
  });
  return page
    .locator('#share-image-preview')
    .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
}
const format = (page: Page, value: 'feed' | 'story') =>
  page.locator(`.share-image-format input[value="${value}"]`).check({
    force: true,
  });

test('Route image draws the route as a pass and saves it as a PNG (#45)', async ({
  page,
}) => {
  const requests = await setup(page);
  await openRoute(page);
  await exportAs(page, 'share-image');
  const sheet = page.locator('#share-image-dialog');
  await expect(sheet).toBeVisible();
  expect(await previewSize(page)).toEqual([1080, 1350]);
  await format(page, 'story');
  await expect
    .poll(() =>
      page
        .locator('#share-image-preview')
        .evaluate((img: HTMLImageElement) => img.naturalHeight),
    )
    .toBe(1920);
  // Weather and climbs need data the page does not have: off, with a hint.
  await expect(page.locator('#share-image-weather')).toBeDisabled();
  await expect(page.locator('#share-image-weather')).not.toBeChecked();
  await expect(page.locator('#share-image-climbs')).toBeDisabled();
  // The activity's options belong to activities only.
  await expect(page.locator('#share-image-hr')).toBeHidden();
  // The message carries the route's link.
  await expect(page.locator('#share-image-message')).toHaveValue(/#v2=/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#share-image-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('lake-loop.png');
  await expect(sheet).toBeHidden();
  // Nothing is asked for the image but the base map: no elevation or weather.
  expect(
    requests.filter((url) => /open-meteo/.test(url) && /elevation/.test(url)),
  ).toEqual([]);
});

test('Share image of an activity offers each recorded value on its own (#45)', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto(base);
  await setLanguage(page, 'en');
  await mapReady(page);
  await page.locator('#import').setInputFiles({
    name: 'ride.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(activityGpx(ride())),
  });
  await expect(page.locator('#activity')).toBeVisible();
  await page.locator('#activity-share').click();
  expect(await previewSize(page)).toEqual([1080, 1350]);
  for (const id of ['speed', 'hr', 'cadence', 'power'])
    await expect(page.locator(`#share-image-${id}`)).toBeVisible();
  // The route's options and message are not the activity's.
  await expect(page.locator('#share-image-day')).toBeHidden();
  await expect(page.locator('#share-image-message')).toBeHidden();
  // Leaving the heart rate out draws the image again.
  const before = await page.locator('#share-image-preview').getAttribute('src');
  await page.locator('#share-image-hr').uncheck({ force: true });
  await expect(page.locator('#share-image-preview')).not.toHaveAttribute(
    'src',
    before!,
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#share-image-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('morning-ride.png');
  // The activity itself is never sent anywhere.
  expect(
    requests.filter((url) => !/tiles\.openfreemap\.org/.test(url)),
  ).toEqual([]);
});

for (const lang of ['en', 'pt'] as const)
  test(`the share sheet fits a 320 px phone with one-line labels (${lang})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setup(page);
    await openRoute(page, lang);
    await exportAs(page, 'share-image');
    await previewSize(page);
    const fit = await page.evaluate(() => {
      const sheet = document.querySelector('#share-image-dialog')!;
      const oneLine = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          el.getBoundingClientRect().height <=
          parseFloat(style.lineHeight || '0') * 1.5 + 1
        );
      };
      return {
        overflow: sheet.scrollWidth - sheet.clientWidth,
        title: oneLine(sheet.querySelector('h2')!),
        buttons: [...sheet.querySelectorAll('.share-image-actions button')].map(
          (b) => b.getBoundingClientRect().height,
        ),
        formats: [...sheet.querySelectorAll('.share-image-format span')].map(
          (s) => s.getBoundingClientRect().height,
        ),
      };
    });
    expect(fit.overflow).toBe(0);
    expect(fit.title).toBe(true);
    // Each button and format keeps its label on one line.
    expect(new Set(fit.buttons).size).toBe(1);
    for (const height of fit.formats) expect(height).toBeLessThan(30);
  });
