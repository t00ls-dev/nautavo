import { test, expect, type Page } from '@playwright/test';
import { base, coveredControls, overlapping } from './app-helpers';
import { mapReady, mockBasemap } from './map-helpers';
import { activityGpx, extremeRide, ride } from './activity-fixture';

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
const importActivity = (page: Page, samples = ride()) =>
  page.locator('#import').setInputFiles({
    name: 'ride.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(activityGpx(samples)),
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
  // Fit route, alone in its group once Lock and Undo step aside, keeps
  // every corner rounded.
  await expect(page.locator('#undo')).toBeHidden();
  await expect(page.locator('#fit')).toHaveCSS('border-radius', '10px');
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
    // At the start the grade is not known yet: the hyphen, without its unit.
    await expect(page.locator('.nav-activity-grade b')).toHaveText('-');
    await expect(page.locator('.nav-activity-grade small')).toHaveText('');
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
    await expect(page.locator('.nav-activity-grade small')).toHaveText('%');
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
    // The replay moves only as the test runs the paused clock: a running
    // one let a busy machine carry it past the moments checked below.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    // At 10×, 2 s of play covers 20 s of the ride past the pause.
    await page.locator('#nav-replay-rate').selectOption('10');
    await page.locator('#nav-replay-toggle').click();
    await page.clock.runFor(2000);
    const notices = page.locator('#nav-activity-notices > .nav-chip');
    // Records passed together stack: the heart rate reached its highest
    // right after the pause.
    await expect(notices).toHaveText([
      'Max. HR140 bpm',
      'Stop of 2 min skipped',
    ]);
    // Jumping to the end passes the top speed and the highest point
    // together; the highest point, the last one, says so in the color of
    // its map label. A jump, not every frame of the way: the software map
    // drawing each one is slow on a busy machine.
    await page.clock.fastForward(8000);
    const notice = notices.last();
    await expect(notice.locator('span')).toHaveText('Highest point');
    await expect(notice.locator('b')).toHaveText('30 m');
    await expect(notice).toHaveClass(/activity-peak-altitude/);
    await expect(notice).toHaveCSS('border-top-color', 'rgb(116, 66, 11)');
    // The ones from before the jump have left; these leave 5 s after they
    // came.
    await expect(notices).toHaveCount(2);
    await page.clock.fastForward(5000);
    await expect(notices).toHaveCount(0);
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

test('charts share one cursor that shows the point on the map (#156)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const services = await setup(page);
  await importActivity(page);
  // Open on a wide screen, one chart per channel recorded.
  await expect(page.locator('#activity-charts-row')).toHaveAttribute('open');
  await expect(page.locator('.activity-chart-head > .sr-only')).toHaveText([
    'Altitude',
    'Speed',
    'Heart rate',
    'Cadence',
    'Power',
  ]);
  await expect(page.locator('.activity-chart-hr b')).toHaveText(
    'avg. 132 · max. 140 bpm',
  );
  // The 2 min pause takes no distance: a tick at its place on every chart.
  await expect(page.locator('.chart-tick')).toHaveCount(5);
  const svg = page.locator('.activity-chart-hr .activity-chart-svg');
  const box = (await svg.boundingBox())!;
  // A fifth of the way: 200 m, before the pause, heart rate 124.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await expect(page.locator('.activity-chart-hr b')).toHaveText('124 bpm');
  await expect(page.locator('.activity-chart-power b')).toHaveText('200 W');
  // Every chart's guide at that point (a vertical line has no width to see).
  expect(
    await page
      .locator('.activity-chart .chart-guide')
      .evaluateAll((lines) =>
        lines.map((l) => (l as SVGLineElement).style.display),
      ),
  ).toEqual(['', '', '', '', '']);
  await expect(page.locator('.activity-chart-readout')).toContainText('0.2 km');
  await expect(page.locator('div.chart-cursor')).toHaveCount(1);
  await page.mouse.move(box.x + box.width / 2, box.y - 200);
  await expect(page.locator('div.chart-cursor')).toHaveCount(0);
  await expect(page.locator('.activity-chart-hr b')).toHaveText(
    'avg. 132 · max. 140 bpm',
  );
  expect(services.filter((url) => !url.includes('tiles'))).toEqual([]);
});

test('the recorded track is colored by its own zones while it is open (#156)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setup(page);
  const option = (id: string) => page.locator(`[data-coloring="${id}"]`);
  await page.locator('#layers-toggle').click();
  // The activity colorings show only while an activity is open.
  await expect(option('activity-hr')).toBeHidden();
  await page.keyboard.press('Escape');
  await importActivity(page);
  await page.locator('#layers-toggle').click();
  await expect(option('activity-speed')).toBeVisible();
  await expect(option('activity-power')).toBeVisible();
  await expect(option('grade')).toHaveAttribute('aria-disabled', 'false');
  // Only what the activity can draw is listed, not planner data the view
  // would have to request.
  for (const id of ['surface', 'daylight'])
    await expect(option(id)).toBeHidden();
  await option('activity-hr').click();
  await expect(option('activity-hr')).toHaveAttribute('aria-checked', 'true');
  const legend = page.locator('.route-legend');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.route-legend-unit')).toHaveText('bpm');
  await expect(legend.locator('.route-legend-tick')).toHaveCount(4);
  await page.keyboard.press('Escape');
  // Not a device preference: closing the activity brings the planner's back.
  expect(
    await page.evaluate(() => localStorage.getItem('route-coloring')),
  ).toBeNull();
  await page.locator('#activity-close').click();
  await expect(legend).toBeHidden();
  await page.locator('#layers-toggle').click();
  await expect(option('none')).toHaveAttribute('aria-checked', 'true');
  await expect(option('activity-hr')).toBeHidden();
});

test('a value the activity did not record is not offered as a coloring (#156)', async ({
  page,
}) => {
  await setup(page);
  await importActivity(
    page,
    ride().map((sample) => {
      delete sample.power;
      return sample;
    }),
  );
  await page.locator('#layers-toggle').click();
  await expect(page.locator('[data-coloring="activity-hr"]')).toBeVisible();
  await expect(page.locator('[data-coloring="activity-power"]')).toBeHidden();
  await expect(
    page.locator('.coloring-reason:not(:empty):visible'),
  ).toHaveCount(0);
});

test('the fastest point, highest heart rate and highest point are marked (#156)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setup(page);
  await importActivity(page, extremeRide());
  const peaks = page.locator('.activity-peak');
  await expect(peaks).toHaveCount(3);
  await expect(page.locator('.activity-peak-hr')).toHaveText('190 bpm');
  await expect(page.locator('.activity-peak-altitude')).toHaveText('2,400 m');
  // Each label whole on the map and apart from the others.
  expect(await overlapping(page, ['.activity-peak'])).toEqual([]);
  const map = (await page.locator('#map').boundingBox())!;
  for (const peak of await peaks.all()) {
    const b = (await peak.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(map.x);
    expect(b.y).toBeGreaterThanOrEqual(map.y);
    expect(b.x + b.width).toBeLessThanOrEqual(map.x + map.width);
    expect(b.y + b.height).toBeLessThanOrEqual(map.y + map.height);
  }
  await page.locator('#activity-close').click();
  await expect(peaks).toHaveCount(0);
});

for (const [width, height] of [
  [320, 640],
  [360, 740],
  [390, 844],
  [430, 932],
  [667, 375],
  [1440, 900],
] as const)
  for (const lang of ['en', 'pt'] as const)
    test(`the charts of a long recording fit at ${width}x${height} in ${lang} (#156)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await setup(page, lang);
      // Miles: the longest speed and distance labels.
      await page.addInitScript(() =>
        localStorage.setItem('distance-units', 'imperial'),
      );
      await page.reload();
      await mapReady(page);
      await importActivity(page, extremeRide());
      // Four-digit values grouped as every other label, here and in the
      // power chart alike.
      await expect(page.locator('#activity-values')).toContainText(
        lang === 'pt' ? '1.290 W, máx. 1.700' : '1,290 W, max. 1,700',
      );
      const row = page.locator('#activity-charts-row');
      // Closed on a phone, where the summary fills the half sheet; open on a
      // wide screen.
      if (width < 760 || height <= 500) {
        await expect(row).not.toHaveAttribute('open');
        await row.locator('summary').click();
      } else await expect(row).toHaveAttribute('open');
      await expect(page.locator('.activity-chart')).toHaveCount(5);
      const clipped = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.activity-chart-head, .chart-axis, .activity-chart-readout',
          ),
        ]
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent),
      );
      expect(clipped).toEqual([]);
      // Every header on one line.
      const tall = await page
        .locator('.activity-chart-head')
        .evaluateAll(
          (heads) =>
            heads.filter((h) => h.getBoundingClientRect().height > 24).length,
        );
      expect(tall).toBe(0);
    });

test.describe('activity replay notices', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('records passed together stack and leave on their own (#156)', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-11-20T09:00:00-03:00') });
    await setup(page);
    // Heart rate, cadence and power all peak on the last point.
    await importActivity(page, extremeRide());
    const topSpeed = await page
      .locator('.map-extreme.activity-peak-speed')
      .textContent();
    await page.locator('#activity-replay').click();
    await page.locator('#nav-replay-rate').selectOption('300');
    await page.locator('#nav-replay-toggle').click();
    await page.clock.runFor(1000);
    const notices = page.locator('#nav-activity-notices > .nav-chip');
    await expect(notices.locator('span')).toHaveText([
      'Max. speed',
      'Max. HR',
      'Max. cadence',
      'Max. power',
    ]);
    // The same value as the peak's label on the planner map.
    await expect(notices.first().locator('b')).toHaveText(topSpeed!);
    // Each in its value's color, apart from the others.
    await expect(notices.nth(1)).toHaveClass(/activity-peak-hr/);
    expect(
      await overlapping(page, ['#nav-activity-notices > .nav-chip']),
    ).toEqual([]);
    await page.clock.runFor(5000);
    await expect(notices).toHaveCount(0);
  });
});
