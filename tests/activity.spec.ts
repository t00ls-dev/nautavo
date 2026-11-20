import { test, expect, type Page } from '@playwright/test';
import { base, coveredControls, overlapping } from './app-helpers';
import { mapReady, mockBasemap } from './map-helpers';
import { activityGpx, ride } from './activity-fixture';

/** Requests to the routing, search, weather and elevation services. */
async function setup(page: Page, lang: 'en' | 'pt' = 'en') {
  const services: string[] = [];
  await page.route('https://**/*', (r) => {
    services.push(r.request().url());
    return r.fulfill({ status: 204 });
  });
  await mockBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem('detect-region', 'off');
    localStorage.setItem('distance-units', 'metric');
    localStorage.setItem('temperature-units', 'celsius');
  });
  await page.goto(`${base}${lang === 'pt' ? '?lang=pt' : ''}`);
  if (lang === 'en') await page.locator('#language').selectOption('en');
  await mapReady(page);
  return services;
}
const importActivity = (page: Page) =>
  page.locator('#import').setInputFiles({
    name: 'ride.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(activityGpx(ride())),
  });

test('a recording opens as an activity, apart from the planned route (#156)', async ({
  page,
}) => {
  const services = await setup(page);
  const before = page.url();
  await importActivity(page);
  const activity = page.locator('#activity');
  await expect(activity).toBeVisible();
  await expect(page.locator('#activity-title')).toHaveText('Morning ride');
  await expect(page.locator('#activity-stats')).toContainText('Moving time');
  await expect(page.locator('#activity-stats')).toContainText('3 min');
  await expect(page.locator('#activity-values')).toContainText('Heart rate');
  await expect(page.locator('#activity-values')).toContainText('Power');
  // The planner steps aside, untouched: its points, link and exports.
  await expect(page.locator('#points')).toBeHidden();
  await expect(page.locator('#download')).toBeHidden();
  await expect(page.locator('#activity-replay')).toBeVisible();
  expect(page.url()).toBe(before);
  await expect(page.locator('.activity-marker')).toHaveCount(2);
  // Nothing about the activity is sent anywhere.
  expect(services.filter((url) => !url.includes('tiles'))).toEqual([]);

  await page.locator('#activity-close').click();
  await expect(activity).toBeHidden();
  await expect(page.locator('#points')).toBeVisible();
  await expect(page.locator('.activity-marker')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText(
    'Activity closed. The planned route is as you left it.',
  );
  expect(page.url()).toBe(before);
});

test('an activity without a name takes the file name (#156)', async ({
  page,
}) => {
  await setup(page);
  await page.locator('#import').setInputFiles({
    name: 'Serra da Estrela.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      activityGpx(ride()).replace('<name>Morning ride</name>', ''),
    ),
  });
  await expect(page.locator('#activity-title')).toHaveText('Serra da Estrela');
});

test('Use as route imports the recording as before (#156)', async ({
  page,
}) => {
  await setup(page);
  await importActivity(page);
  await page.locator('#activity-route').click();
  await expect(page.locator('#activity')).toBeHidden();
  await expect(page.locator('#status')).toHaveText(
    /Route imported\. Edits recalculate only the changed sections\./,
  );
  await expect(page.locator('#location-0')).not.toHaveValue('');
});

test.describe('activity replay on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('plays at the recorded pace, shows its values and skips the pause', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-11-20T09:00:00-03:00') });
    await setup(page);
    await importActivity(page);
    await page.locator('#activity-replay').click();
    const screen = page.locator('#nav-screen');
    await expect(screen).toBeVisible();
    // A data page, not navigation: no turn banner over the map.
    await expect(page.locator('.nav-banner')).toBeHidden();
    await expect(page.locator('#nav-activity')).toBeVisible();
    // No turns ahead in a recording: no list of them.
    await expect(page.locator('#nav-list-toggle')).toBeHidden();
    await expect(page.locator('#nav-replay-rate option')).toHaveText([
      '1×',
      '10×',
      '60×',
      '300×',
    ]);
    // At 25 s: 125 m along, heart rate 122, 5 m/s.
    const range = page.locator('#nav-replay-position');
    const max = Number(await range.getAttribute('max'));
    await range.evaluate(
      (el: HTMLInputElement, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      Math.round((25 / 190) * max),
    );
    await expect(page.locator('.nav-activity-hr b')).toHaveText('122');
    // Values stay in their columns whatever their digits.
    const columns = () =>
      page
        .locator('.nav-activity-value')
        .evaluateAll((cells) =>
          cells.map((c) => Math.round(c.getBoundingClientRect().x)),
        );
    const before = await columns();
    await expect(page.locator('.nav-activity-speed b')).toHaveText('18');
    // Navigation's speed badge, voice and compass have no place here.
    await expect(page.locator('#nav-speed')).toBeHidden();
    await expect(page.locator('#nav-voice')).toBeHidden();
    await expect(page.locator('#nav-time')).toHaveText('0:25');
    await range.evaluate(
      (el: HTMLInputElement, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      Math.round((60 / 190) * max),
    );
    await expect(page.locator('#nav-time')).toHaveText('1:00');
    expect(await columns()).toEqual(before);
    // Values shown: a value taken off stays off on this device.
    // Taps, as on a phone: the screen cancels touches on the map.
    await page.locator('#nav-values').tap();
    await page.locator('#nav-values-menu label', { hasText: 'Cadence' }).tap();
    await expect(
      page.locator('#nav-values-menu input').nth(2),
    ).not.toBeChecked();
    await expect(page.locator('.nav-activity-cadence')).toBeHidden();
    // Temperature and time of day start hidden; cadence joins them.
    expect(
      await page.evaluate(() => localStorage.getItem('activity-values')),
    ).toBe('temperature,clock,cadence');
    await page.locator('#nav-values-menu label', { hasText: 'Speed' }).tap();
    await expect(page.locator('.nav-activity-speed')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-values-menu')).toBeHidden();
    // Playing past the pause jumps it and says so.
    await range.evaluate(
      (el: HTMLInputElement, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      Math.round((95 / 190) * max),
    );
    // At 10×, 2 s of play covers 20 s of the ride past the pause.
    await page.locator('#nav-replay-rate').selectOption('10');
    await page.locator('#nav-replay-toggle').click();
    await page.clock.runFor(2000);
    await expect(page.locator('#nav-activity-notice')).toHaveText(
      'Stop of 2 min skipped',
    );
    // Passing the highest point says so.
    await page.clock.runFor(4000);
    await expect(page.locator('#nav-activity-notice')).toHaveText(
      'Highest point: 30 m',
    );
    await page.locator('#nav-stop').click();
    await expect(screen).toBeHidden();
    await expect(page.locator('#activity-replay')).toBeFocused();
  });
});

for (const [width, height] of [
  [320, 640],
  [390, 844],
  [1280, 800],
] as const)
  for (const lang of ['en', 'pt'] as const)
    test(`the activity view and its replay fit at ${width} px in ${lang} (#156)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await setup(page, lang);
      await importActivity(page);
      await expect(page.locator('#activity')).toBeVisible();
      // Every value on one line, nothing past the panel's edge.
      const clipped = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '#activity-values li, #activity-stats > div',
          ),
        ]
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent),
      );
      expect(clipped).toEqual([]);
      expect(
        await overlapping(page, [
          '#activity-values li',
          '#activity-stats > div',
        ]),
      ).toEqual([]);
      // The panel scrolls: its last buttons in view, nothing covers them.
      await page.locator('#activity-close').scrollIntoViewIfNeeded();
      expect(await coveredControls(page, '#activity')).toEqual([]);
      await page.locator('#activity-replay').click();
      await expect(page.locator('#nav-activity')).toBeVisible();
      expect(
        await overlapping(page, [
          '.nav-activity',
          '.nav-banner',
          '.nav-map-tools',
          '.nav-bar',
          '#nav-speed',
        ]),
      ).toEqual([]);
      expect(await coveredControls(page, '#nav-screen')).toEqual([]);
    });
