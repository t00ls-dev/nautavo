import { test, expect, type Page } from '@playwright/test';
import { chooseUnits } from './unit-settings';
import {
  base,
  coveredControls,
  mockRouting,
  openAdvancedSettings,
  mockRegion,
  overlapping,
  setLanguage,
  openTripOptions,
  openTab,
} from './app-helpers';
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.fulfill({ status: 204 }));
  await mockRegion(page);
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({ json: { features: [] } }),
  );
});
const sheetHeight = async (page: Page) =>
  Math.round((await page.locator('#sheet').boundingBox())!.height);

test('trip options are available before a route exists', async ({ page }) => {
  await page.goto(base);
  // Not on the empty planner (#306): from the first point on, closed.
  await expect(page.locator('#trip-options')).toBeHidden();
  await page.locator('#location-0').fill('-22.97, -43.18');
  await page.locator('#location-0').press('Tab');
  await expect(page.locator('#summary')).toBeHidden();
  await openTripOptions(page);
  for (const id of ['departure', 'average-speed', 'prefer'])
    await expect(page.locator(`#trip-options #${id}`)).toBeVisible();
  // Units moved to Settings and apply at once.
  await expect(page.locator('#trip-options select')).toHaveCount(0);
  await chooseUnits(page, { distance: 'imperial' });
  await expect(page.locator('#speed-unit')).toHaveText('mph');
});

test('settings open in a dialog, report errors inside it and close when applied', async ({
  page,
}) => {
  await page.goto(base);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeHidden();
  await openAdvancedSettings(page);
  await expect(dialog).toBeVisible();
  await page.locator('#osrm').fill('https://user:secret@router.example');
  await page.locator('#save-settings').click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#settings-status')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#open-settings')).toBeFocused();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-status')).toBeEmpty();
  // Closing without applying discards the edit.
  await expect(page.locator('#osrm')).toHaveValue(
    'https://router.project-osrm.org',
  );
  await page.locator('#photon').fill('https://photon.example');
  await page.locator('#save-settings').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#status')).toHaveText('Settings applied.');
  await setLanguage(page, 'pt');
  await expect(page.locator('#open-settings')).toHaveAccessibleName(
    'Configurações',
  );
});

for (const [width, language] of [
  [320, 'pt'],
  [320, 'en'],
  [1280, 'en'],
] as const)
  test(`settings come in sections with Advanced folded at ${width}px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(base);
    await setLanguage(page, language);
    await page.locator('#open-settings').click();
    const dialog = page.locator('#settings-dialog');
    // What applies at once comes first, in sections (#211).
    await expect(dialog.locator('.settings-section h3')).toHaveText(
      language === 'pt'
        ? [
            'Idioma',
            'Unidades',
            'Mapa e pontos',
            'Cópia de segurança',
            'Navegação',
          ]
        : ['Language', 'Units', 'Map and points', 'Backup', 'Navigation'],
    );
    // The language lives here, not in the header (#304), and the
    // Navigation switches keep to one line each.
    await expect(page.locator('header #language')).toHaveCount(0);
    await expect(page.locator('#language')).toBeVisible();
    const lines = await dialog
      .locator('[aria-labelledby="settings-navigation"] .check span')
      .evaluateAll((spans) =>
        spans.map((e) =>
          Math.round(
            e.getBoundingClientRect().height /
              parseFloat(getComputedStyle(e).lineHeight),
          ),
        ),
      );
    expect(lines).toEqual([1, 1, 1]);
    // Servers and their Apply button wait folded in Advanced.
    await expect(page.locator('.settings-advanced')).not.toHaveAttribute(
      'open',
      '',
    );
    await expect(page.locator('#osrm')).toBeHidden();
    await expect(page.locator('#save-settings')).toBeHidden();
    // A unit change applies without Apply.
    await page.locator('#distance-units').selectOption('imperial');
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await page.locator('.settings-advanced > summary').click();
    await expect(page.locator('#save-settings')).toBeVisible();
    const escaped = await dialog.evaluate((d) => {
      const box = d.getBoundingClientRect();
      return [...d.querySelectorAll('h3,summary,label,button,select,input')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width && (r.left < box.left || r.right > box.right + 0.5);
        })
        .map((e) => e.id || e.textContent);
    });
    expect(escaped).toEqual([]);
  });

test('wide screens collapse the side panel from its header', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base);
  const map = () => page.locator('#map').boundingBox();
  expect((await map())!.width).toBe(880);
  await page.locator('#panel-toggle').click();
  await expect(page.locator('#route-panel')).toBeHidden();
  await expect.poll(async () => (await map())!.width).toBe(1280);
  await expect(page.locator('#panel-toggle')).toBeVisible();
  await page.locator('#panel-toggle').click();
  await expect(page.locator('#location-0')).toBeVisible();
});

test.describe('bottom sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('closed sheet keeps status and export actions; More actions shows the rest', async ({
    page,
  }) => {
    await mockRouting(page);
    await page.goto(base);
    // The empty planner has no route actions yet (#306), and its closed
    // sheet keeps the prompt.
    await expect(page.locator('.action-bar')).toBeHidden();
    await page.locator('#panel-toggle').click();
    await expect(page.locator('#peek-status')).toHaveText(
      'Set your start and destination.',
    );
    await page.locator('#panel-toggle').click();
    await page.locator('#location-0').fill('-22.97, -43.18');
    await page.locator('#location-0').press('Tab');
    await page.locator('#location-1').fill('-23.02, -43.48');
    await page.locator('#location-1').press('Tab');
    await expect(page.locator('#summary')).toBeVisible();
    await page.locator('#panel-toggle').click();
    await expect(page.locator('#route-panel')).toBeHidden();
    // Save route and Export (#301); the name is asked when saving.
    await expect(page.locator('#save-route')).toBeVisible();
    await expect(page.locator('#export')).toBeVisible();
    await expect(page.locator('#route-name')).toBeHidden();
    await page.locator('#export').click();
    await expect(page.locator('#share')).toBeVisible();
    const more = page.locator('#more-actions');
    await expect(more).toHaveAccessibleName('More actions');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    // One menu at a time.
    await expect(page.locator('#export-menu')).toBeHidden();
    await expect(page.locator('.secondary-actions .file-button')).toBeVisible();
    await expect(page.locator('#travel-route')).toBeVisible();
    await more.click();
    await expect(page.locator('#travel-route')).toBeHidden();
  });

  test('the open sheet shows the status once, at the top, and Calculate route spans its row', async ({
    page,
  }) => {
    await page.goto(base);
    const message =
      'Route imported. Edits recalculate only the changed sections.';
    // Calculate route as after a failed calculation, when it shows (#296).
    await page.evaluate((text) => {
      document.getElementById('status')!.textContent = text;
      document.getElementById('status')!.removeAttribute('data-empty-prompt');
      document.getElementById('calculate')!.hidden = false;
    }, message);
    const peek = page.locator('#peek-status');
    await expect(peek).toHaveText(message);
    // Whole in up to two lines, not cut off.
    const lines = await peek.evaluate((element) => ({
      clipped: element.scrollHeight > element.clientHeight + 1,
      count: Math.round(
        element.clientHeight / parseFloat(getComputedStyle(element).lineHeight),
      ),
    }));
    expect(lines).toEqual({ clipped: false, count: 2 });
    // The panel row keeps the live region for screen readers only.
    const status = page.locator('#status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    expect((await status.boundingBox())!.width).toBeLessThanOrEqual(1);
    // The whole row, at the standard control height (#206).
    const row = (await page.locator('.status-row').boundingBox())!,
      calculate = (await page.locator('#calculate').boundingBox())!;
    expect(Math.abs(calculate.width - row.width)).toBeLessThanOrEqual(1);
    expect(calculate.height).toBe(44);
  });
  test('dragging the handle moves between closed, half and full height', async ({
    page,
    context,
  }) => {
    await page.goto(base);
    const half = await sheetHeight(page);
    expect(half).toBe(464);
    const session = await context.newCDPSession(page);
    const drag = async (to: number) => {
      const handle = (await page.locator('#panel-toggle').boundingBox())!;
      const from = handle.y + 10;
      const touch = (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        y?: number,
      ) =>
        session.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: y === undefined ? [] : [{ x: 195, y }],
        });
      await touch('touchStart', from);
      for (let step = 1; step <= 8; step++)
        await touch('touchMove', from + ((to - from) * step) / 8);
      await touch('touchEnd');
    };
    await drag(70);
    await expect(page.locator('body')).toHaveClass(/sheet-full/);
    await expect.poll(() => sheetHeight(page)).toBe(784);
    await expect(page.locator('#route-panel')).toBeVisible();
    await drag(420);
    await expect(page.locator('body')).not.toHaveClass(/sheet-full/);
    await expect.poll(() => sheetHeight(page)).toBe(half);
    await drag(830);
    await expect(page.locator('#route-panel')).toBeHidden();
    await expect(page.locator('#panel-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // The first tap after a drag still toggles, and reopens at the last open
    // height; browsers may drop the click of that tap.
    await page.locator('#panel-toggle').tap();
    await expect(page.locator('#route-panel')).toBeVisible();
    await expect.poll(() => sheetHeight(page)).toBe(half);
    await drag(70);
    await expect.poll(() => sheetHeight(page)).toBe(784);
    await page.locator('#panel-toggle').tap();
    await expect(page.locator('#route-panel')).toBeHidden();
  });

  test('a tap on the handle presses nothing that moved under the finger (#256)', async ({
    page,
  }) => {
    await page.goto(base);
    // Clicks that reach the page outside the handle: the one a touch sends
    // after its release, aimed at what is under the finger once the sheet moved.
    await page.evaluate(() => {
      const stray: string[] = [];
      (window as unknown as { stray: string[] }).stray = stray;
      addEventListener('click', (event) => {
        const target = event.target as Element;
        if (!target.closest('#panel-toggle'))
          stray.push(target.id || target.tagName);
      });
    });
    const handle = page.locator('#panel-toggle');
    const tap = async () => {
      const box = (await handle.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    // Closing moves the handle down, leaving the map under the finger;
    // opening moves it up, leaving the panel there.
    await tap();
    await expect(page.locator('#route-panel')).toBeHidden();
    await page.waitForTimeout(300);
    await tap();
    await expect(page.locator('#route-panel')).toBeVisible();
    // A click that slipped through would land right after the tap.
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => (window as unknown as { stray: string[] }).stray,
      ),
    ).toEqual([]);
  });

  test('arrow keys on the handle change the sheet height', async ({ page }) => {
    await page.goto(base);
    const handle = page.locator('#panel-toggle');
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('body')).toHaveClass(/sheet-full/);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('body')).toHaveClass(/sheet-full/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#route-panel')).toBeHidden();
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    // Enter toggles back to the last open height.
    await page.keyboard.press('Enter');
    await expect(page.locator('#route-panel')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/sheet-full/);
  });
});

/** What a phone in landscape shows over the planner map. */
const PLANNER_OVERLAYS = [
  '#sheet',
  '.planner header',
  '.map-top-right',
  '#map-note',
  '.map-notice',
  '.map-credits-toggle',
];
test.describe('phones in landscape (#252)', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const [width, height] of [
    [568, 320],
    [667, 375],
    [852, 393],
    [932, 430],
  ] as const)
    for (const language of ['en', 'pt'] as const)
      test(`the panel is beside the map, with the summary and Navigate, at ${width}x${height} in ${language}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await mockRouting(page);
        await page.goto(language === 'pt' ? `${base}?lang=pt` : base);
        await page.locator('#location-0').fill('-22.93, -43.24');
        await page.locator('#location-0').press('Tab');
        await page.locator('#location-1').fill('-22.93, -43.22');
        await page.locator('#location-1').press('Tab');
        const navigate = page.locator('#navigate');
        await expect(navigate).toBeEnabled({ timeout: 15000 });
        const layout = () =>
          page.evaluate(() => {
            const box = (selector: string) =>
              document.querySelector(selector)!.getBoundingClientRect();
            const sheet = box('#sheet'),
              peek = box('#peek-main'),
              bar = box('#action-bar'),
              tools = box('.map-top-right'),
              go = document.querySelector('#navigate')!;
            return {
              left: sheet.left,
              top: Math.round(sheet.top),
              bottom: Math.round(sheet.bottom - innerHeight),
              narrow: sheet.right <= innerWidth * 0.55,
              toolsBeside: tools.left >= sheet.right,
              summaryShown: peek.height > 0 && peek.bottom <= bar.top,
              navigateOneLine: go.scrollWidth <= go.clientWidth,
              barInside: bar.right <= sheet.right + 0.5,
            };
          });
        // Open: a full-height panel on the left, the map tools beside it.
        await expect.poll(layout).toEqual({
          left: 0,
          top: 0,
          bottom: 0,
          narrow: true,
          toolsBeside: true,
          summaryShown: true,
          navigateOneLine: true,
          barInside: true,
        });
        expect(await overlapping(page, PLANNER_OVERLAYS)).toEqual([]);
        expect(await coveredControls(page, '#action-bar')).toEqual([]);
        // Closed: only the summary and the actions, at the bottom left.
        await page.locator('#panel-toggle').click();
        await expect(page.locator('#route-panel')).toBeHidden();
        const closed = await layout();
        expect(closed).toMatchObject({
          left: 0,
          bottom: 0,
          narrow: true,
          summaryShown: true,
          navigateOneLine: true,
        });
        expect(closed.top).toBeGreaterThan(height / 3);
        expect(await overlapping(page, PLANNER_OVERLAYS)).toEqual([]);
        expect(await coveredControls(page, '#action-bar')).toEqual([]);
      });
});

test.describe('phone summary', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    timezoneId: 'America/Sao_Paulo',
  });
  test('arrival on another day keeps the time on one line, with the date below', async ({
    page,
  }) => {
    // 23:20 local: the automatic departure is 23:30 and the arrival after midnight.
    await page.clock.setFixedTime(new Date('2026-11-11T02:20:00Z'));
    await mockRouting(page, {
      distance: 30900,
      duration: 2000,
      legs: [{ steps: [] }],
    });
    await page.addInitScript(() => localStorage.setItem('average-speed', '25'));
    await page.goto(base);
    await setLanguage(page, 'pt');
    await page.locator('#location-0').fill('-22.591897, -43.416001');
    await page.locator('#location-1').fill('-22.692000, -43.459000');
    await page.locator('#location-1').press('Tab');
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    const arrival = page.locator('#summary .stats > div').nth(2);
    await expect(arrival.locator('strong')).toHaveText('00:44');
    // The time of the trip, then the date (#302).
    await expect(arrival.locator('dd span')).toHaveText(
      '1h 14 min · 11 de nov.',
    );
    // Each value stays on one line, and the three point actions share a row.
    for (const value of await page.locator('#summary .stats strong').all())
      expect(
        await value.evaluate((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          return new Set([...range.getClientRects()].map((r) => r.top)).size;
        }),
      ).toBe(1);
    const tops = await page
      .locator('.inline-actions > button')
      .evaluateAll((buttons) =>
        buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
      );
    expect(new Set(tops).size).toBe(1);
  });
});

test.describe('narrow phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });
  test('point rows keep their controls on one line, and Departure sits below its label', async ({
    page,
  }) => {
    await page.goto(base);
    const row = page.locator('#points li').first();
    await expect(row.locator('.point-number')).toHaveAttribute(
      'title',
      'Set on map',
    );
    await expect(row.locator('.point-grip')).toHaveAccessibleName(
      'Move point 1',
    );
    await expect(row.locator('.point-grip .button-label')).toBeHidden();
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.height).toBe(48);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
    // Trip options show from the first point on (#306).
    await page.locator('#location-0').fill('-22.97, -43.18');
    await page.locator('#location-0').press('Tab');
    await openTripOptions(page);
    const label = (await page.locator('label[for=departure]').boundingBox())!;
    const field = (await page.locator('#departure').boundingBox())!;
    expect(field.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    expect(Math.round(field.height)).toBe(44);
    await expect(page.locator('.departure-automatic')).toHaveText(
      'Automatic departure',
    );
  });
});

for (const [width, language] of [
  [320, 'en'],
  [320, 'pt'],
  [390, 'pt'],
  [1280, 'en'],
  [1280, 'pt'],
] as const)
  test(`footer links sit on one line with icons at ${width}px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base);
    await setLanguage(page, language);
    // Help left the header for the footer; Settings is a gear.
    await expect(page.locator('header #help')).toHaveCount(0);
    await expect(
      page.locator('#open-settings .icon-settings circle'),
    ).toHaveCount(1);
    const footer = page.locator('#route-panel footer');
    await expect(footer.locator('a')).toHaveText(
      language === 'pt'
        ? ['Ajuda', 'Novidades', 'GitHub']
        : ['Help', "What's new", 'GitHub'],
    );
    await expect(footer).not.toContainText(/servers|servidores/i);
    for (const [id, name] of [
      ['help', 'help'],
      ['changelog', 'news'],
      ['github', 'github'],
    ])
      await expect(footer.locator(`#${id} .icon-${name}`)).toHaveCount(1);
    await expect(footer.locator('.icon-external')).toHaveCount(0);
    const box = (await footer.boundingBox())!;
    const links = await footer
      .locator('a')
      .evaluateAll((els) =>
        els.map((e) => [
          e.getBoundingClientRect().left,
          e.getBoundingClientRect().right,
          e.getBoundingClientRect().top,
          e.getBoundingClientRect().height,
        ]),
      );
    // One line, inside the footer, each link on a single line.
    for (const [left, right, top, height] of links) {
      expect(top).toBeCloseTo(links[0][2], 0);
      expect(height).toBeLessThanOrEqual(48);
      expect(left).toBeGreaterThanOrEqual(box.x);
      expect(right).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
    const before = links[0][0] - box.x,
      after = box.x + box.width - links.at(-1)![1];
    // Phones center the links; the desktop panel keeps them to the right.
    if (width < 760) expect(Math.abs(before - after)).toBeLessThan(2);
    else expect(after).toBeLessThan(2);
  });

for (const width of [320, 390, 1280])
  test(`the space reserved for the first two points matches them at ${width} px`, async ({
    page,
  }) => {
    // style.css reserves this height while the list is empty, so the panel
    // below does not shift on load; it must follow the rows' real height.
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base);
    for (const language of ['en', 'pt']) {
      await setLanguage(page, language);
      await expect(page.locator('#points > li')).toHaveCount(2);
      const [rendered, reserved] = await page.evaluate(() => {
        const list = document.getElementById('points')!;
        const rows = [...list.children];
        const height = () => list.getBoundingClientRect().height;
        const rendered = height();
        list.replaceChildren();
        const reserved = height();
        list.replaceChildren(...rows);
        return [rendered, reserved];
      });
      expect(Math.abs(rendered - reserved)).toBeLessThanOrEqual(1);
    }
  });

for (const mobile of [false, true])
  test(`disabled buttons keep their disabled look under hover (${mobile ? 'phone' : 'desktop'})`, async ({
    page,
  }) => {
    // A tap leaves :hover on touch screens; a disabled button (Download GPX
    // before a route exists) must not then look enabled.
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    );
    await page.goto(base);
    await expect(page.locator('#download')).toBeDisabled();
    const disabled = page.locator('button:disabled:visible');
    const count = await disabled.count();
    expect(count).toBeGreaterThan(0);
    const look = (i: number) =>
      disabled.nth(i).evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.color, style.borderColor];
      });
    for (let i = 0; i < count; i++) {
      await page.mouse.move(0, 0);
      const before = await look(i);
      await disabled.nth(i).hover({ force: true });
      expect(
        await look(i),
        await disabled.nth(i).evaluate((e) => e.id || e.textContent),
      ).toEqual(before);
    }
  });

test.describe('on an iPhone', () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  test('only the map zooms: the planner page blocks page zoom, Help keeps pinch', async ({
    page,
  }) => {
    await page.goto(base);
    const touch = (selector: string) =>
      page.locator(selector).evaluate((e) => getComputedStyle(e).touchAction);
    expect(await touch('html')).toBe('manipulation');
    expect(await touch('body')).toBe('pan-x pan-y');
    expect(await touch('#map')).toBe('none');
    // The viewport stays zoomable for accessibility settings.
    expect(
      await page.locator('meta[name="viewport"]').getAttribute('content'),
    ).not.toMatch(/user-scalable|maximum-scale/);
    await page.goto(`${base}help`);
    expect(await touch('html')).toBe('manipulation');
    expect(await touch('body')).toBe('auto');
  });
});

for (const path of ['', 'help'])
  test(`a home-screen web app keeps its controls below a white status strip (${path || 'app'})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    // An iOS home-screen web app with the black-translucent status bar runs
    // under it: the top safe area is 59 px and navigator.standalone is set.
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'standalone', { value: true }),
    );
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 59, bottom: 34 },
    });
    await page.goto(base + path);
    expect(
      await page
        .locator('meta[name="apple-mobile-web-app-status-bar-style"]')
        .getAttribute('content'),
    ).toBe('black-translucent');
    // White over the status bar and the 16 px band iOS fades below it.
    const strip = page.locator('.top-edge').first();
    expect((await strip.boundingBox())!.height).toBe(75);
    expect(
      await strip.evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe('rgb(255, 255, 255)');
    const header = (await page.locator('header').first().boundingBox())!;
    expect(header.y).toBeGreaterThanOrEqual(75);
    if (!path) {
      // Modal cards stay below it and above the home indicator.
      await page.locator('#open-settings').click();
      const card = (await page.locator('dialog.settings').boundingBox())!;
      expect(card.y).toBeGreaterThanOrEqual(75);
      expect(card.y + card.height).toBeLessThanOrEqual(852 - 34);
    }
  });

for (const width of [320, 390, 430])
  for (const standalone of [false, true])
    test(`the full sheet stops below the header under a 59 px top inset at ${width} px (${standalone ? 'home-screen app' : 'web view'})`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((standalone) => {
        if (standalone)
          Object.defineProperty(navigator, 'standalone', { value: true });
      }, standalone);
      // A web view drawn under the status bar of a Dynamic Island iPhone.
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 59, bottom: 34 },
      });
      await page.goto(base);
      const header = page.locator('header').first();
      const gap = async () => {
        const box = (await header.boundingBox())!;
        return (
          (await page.locator('#sheet').boundingBox())!.y - box.y - box.height
        );
      };
      await page.locator('#panel-toggle').focus();
      await page.keyboard.press('ArrowUp');
      await expect(page.locator('body')).toHaveClass(/sheet-full/);
      await expect.poll(gap).toBeCloseTo(8, 0);
      const full = await sheetHeight(page);
      // Dragging up past the top stops at the same height.
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('body')).not.toHaveClass(/sheet-full/);
      // Start on the handle once the sheet has settled at half height.
      await page
        .locator('#sheet')
        .evaluate((sheet) =>
          Promise.all(sheet.getAnimations().map((a) => a.finished)),
        );
      const touch = (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        y?: number,
      ) =>
        session.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: y === undefined ? [] : [{ x: width / 2, y }],
        });
      const from = (await page.locator('#panel-toggle').boundingBox())!.y + 10;
      await touch('touchStart', from);
      for (let step = 1; step <= 8; step++)
        await touch('touchMove', from - (from * step) / 8);
      expect(await sheetHeight(page)).toBe(full);
      await touch('touchEnd');
      await expect(page.locator('body')).toHaveClass(/sheet-full/);
      await expect.poll(() => sheetHeight(page)).toBe(full);
    });

test('in the browser the status strip takes no room', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  expect(
    (await page.locator('.top-edge').first().boundingBox())?.height ?? 0,
  ).toBe(0);
  const header = (await page.locator('header').first().boundingBox())!;
  expect(header.y).toBe(8);
});

for (const [width, language] of [
  [760, 'en'],
  [760, 'pt'],
  [1280, 'en'],
  [1280, 'pt'],
] as const)
  test(`sidebar actions keep their labels on one line at ${width}px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockRouting(page);
    await page.goto(language === 'pt' ? `${base}?lang=pt` : base);
    // The route's actions show once there is a route (#306).
    await page.locator('#location-0').fill('-22.97, -43.18');
    await page.locator('#location-0').press('Tab');
    await page.locator('#location-1').fill('-23.02, -43.48');
    await page.locator('#location-1').press('Tab');
    await expect(page.locator('#summary')).toBeVisible();
    await openTab(page, 'points');
    const layout = await page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect();
      const px = (value: number) => Math.round(value) || 0;
      const list = box(document.querySelector('#points')!);
      const tiles = [
        ...document.querySelectorAll('.inline-actions > button'),
      ].map(box);
      // Save route and Export (#301), on one row.
      const footer = ['#save-route', '#export'].map((selector) =>
        box(document.querySelector(selector)!),
      );
      const oneLine = ['#save-route', '#export'].every((selector) => {
        const button = document.querySelector(selector)!;
        return button.scrollWidth <= button.clientWidth;
      });
      return {
        tileRows: new Set(tiles.map((b) => px(b.top))).size,
        tileHeights: new Set(tiles.map((b) => px(b.height))).size,
        tileEdges: [
          px(tiles[0].left - list.left),
          px(tiles[2].right - list.right),
        ],
        oneLine,
        height: px(footer[0].height),
        footerRows: new Set(footer.map((b) => px(b.top))).size,
        footerInside: footer.every((b) => b.right <= list.right + 1),
      };
    });
    expect(layout).toEqual({
      tileRows: 1,
      tileHeights: 1,
      tileEdges: [0, 0],
      oneLine: true,
      height: 44,
      footerRows: 1,
      footerInside: true,
    });
    await page.locator('#export').click();
    await expect(page.locator('#share')).toHaveAccessibleName(
      language === 'pt' ? 'Copiar link' : 'Copy link',
    );
  });

/** Whether the bottom of a locator's box is above the phone's action bar. */
async function aboveActionBar(page: Page, selector: string) {
  // The empty planner has no action bar (#306): the screen's bottom then.
  const bar = (await page.locator('#action-bar').boundingBox()) ?? {
    y: page.viewportSize()!.height,
  };
  const box = (await page.locator(selector).boundingBox())!;
  return box.y + box.height <= bar.y;
}
for (const width of [320, 390])
  for (const language of ['en', 'pt'] as const)
    test(`on the sheet the route's numbers come first, on one row, at ${width}px in ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await mockRouting(page, { distance: 44000, duration: 9000 });
      if (language === 'en')
        await page.addInitScript(() =>
          localStorage.setItem('distance-units', 'imperial'),
        );
      await page.goto(`${base}?lang=${language}`);
      await page.locator('#location-0').fill('-22.97, -43.18');
      await page.locator('#location-1').fill('-23.02, -43.48');
      await page.locator('#location-1').press('Tab');
      await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
      await page.locator('#location-1').blur();
      // Before the points in the page, so the focus order follows the view.
      expect(
        await page.evaluate(
          () =>
            document
              .getElementById('summary')!
              .compareDocumentPosition(
                document.querySelector('.points-section')!,
              ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBeTruthy();
      const cards = page.locator('#summary .stats > div');
      await expect(cards).toHaveCount(3);
      const tops = await cards.evaluateAll((all) =>
        all.map((c) => Math.round(c.getBoundingClientRect().top)),
      );
      expect(new Set(tops).size).toBe(1);
      for (const card of await cards.all())
        expect(
          await card.evaluate(
            (c) =>
              c.querySelector('strong, button')!.getBoundingClientRect()
                .right <= c.getBoundingClientRect().right,
          ),
        ).toBe(true);
      // Visible at half height without scrolling.
      expect(await aboveActionBar(page, '#summary .stats')).toBe(true);
    });

for (const width of [390, 1280])
  test(`the summary, Trip options and the tabs come before the points at ${width}px (#305)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base);
    // In the page, so the focus order follows what is seen.
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('#route-panel > *')]
          .map((e) => e.id)
          .filter((id) =>
            [
              'summary',
              'trip-options',
              'route-tabs',
              'points-section',
            ].includes(id),
          ),
      ),
    ).toEqual(['summary', 'trip-options', 'route-tabs', 'points-section']);
  });

test.describe('point fields on the sheet', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const width of [320, 390])
    for (const language of ['en', 'pt'] as const)
      test(`a focused field raises the sheet with its menu in view at ${width}px in ${language}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 320 ? 568 : 844,
        });
        await page.goto(`${base}?lang=${language}`);
        await expect(page.locator('body')).not.toHaveClass(/sheet-full/);
        const field = page.locator('#location-1');
        await field.focus();
        await expect(page.locator('body')).toHaveClass(/sheet-full/);
        const list = page.locator(
          `#${await field.getAttribute('aria-controls')}`,
        );
        const options = list.locator('[role=option]');
        await expect(options.first()).toBeVisible();
        expect(await aboveActionBar(page, '#location-1')).toBe(true);
        for (const option of (await options.all()).slice(0, 4)) {
          const bar = (await page.locator('#action-bar').boundingBox()) ?? {
              y: page.viewportSize()!.height,
            },
            box = (await option.boundingBox())!;
          expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
        }
        // Leaving the fields puts the sheet back where it was.
        await field.blur();
        await expect(page.locator('body')).not.toHaveClass(/sheet-full/);
        await expect(page.locator('#route-panel')).toBeVisible();
      });

  test('a sheet the traveler moves keeps their height', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.locator('#location-1').focus();
    await expect(page.locator('body')).toHaveClass(/sheet-full/);
    // Closed from the handle while the field was raised: it stays closed.
    await page.locator('#panel-toggle').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('body')).toHaveClass(/panel-closed/);
    // Longer than the moment the sheet waits before going back.
    await page.waitForTimeout(500);
    await expect(page.locator('body')).toHaveClass(/panel-closed/);
  });
});

test('wide screens keep the panel as it is when a field gets focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base);
  await page.locator('#location-1').focus();
  await expect(page.locator('body')).not.toHaveClass(/sheet-full/);
});

test.describe('touch accessibility at 320 px', () => {
  test.use({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
  });
  test('editable text is 16 px on every page, so iOS does not zoom on focus', async ({
    page,
  }) => {
    for (const path of ['', 'help', 'changelog']) {
      await page.goto(base + path);
      await expect(page.locator('#language')).toHaveCSS('font-size', '16px');
    }
  });
  test('a disabled Calculate route keeps 4.5:1 contrast', async ({ page }) => {
    await page.goto(base);
    // It shows disabled after a failure while a point is being edited (#296).
    await page.evaluate(
      () => (document.getElementById('calculate')!.hidden = false),
    );
    await expect(page.locator('#calculate')).toBeDisabled();
    const ratio = await page.locator('#calculate').evaluate((button) => {
      const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
      const luminance = (color: string) => {
        const [r, g, b] = rgb(color).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      // The first ancestor (or itself) with an opaque background.
      let element: Element | null = button;
      let background = 'rgb(255, 255, 255)';
      while (element) {
        const color = getComputedStyle(element).backgroundColor;
        if (rgb(color)[3] !== 0) {
          background = color;
          break;
        }
        element = element.parentElement;
      }
      const [a, b] = [
        luminance(getComputedStyle(button).color),
        luminance(background),
      ];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  test('the point number and remove buttons answer across 44 px', async ({
    page,
  }) => {
    await page.goto(base);
    for (const selector of ['.point-number', '.point-remove']) {
      const button = page.locator(selector).first();
      const box = (await button.boundingBox())!;
      const middle = box.x + box.width / 2,
        y = box.y + box.height / 2;
      for (const x of [middle - 21, middle + 21])
        expect(
          await page.evaluate(
            ([px, py, s]) =>
              document.elementFromPoint(px, py)?.closest(s) ===
              document.querySelector(s),
            [x, y, selector] as const,
          ),
        ).toBe(true);
    }
  });
  test('Navigate is named by what it shows', async ({ page }) => {
    // In the summary of a route (#301).
    await mockRouting(page);
    await page.goto(base);
    await page.locator('#location-0').fill('-22.97, -43.18');
    await page.locator('#location-1').fill('-23.02, -43.48');
    await page.locator('#location-1').press('Tab');
    const navigate = page.getByRole('button', {
      name: 'Navigate',
      exact: true,
    });
    await expect(navigate).toBeVisible();
    await expect(navigate).toHaveAttribute('title', 'Start navigation');
  });
});

for (const language of ['en', 'pt'] as const)
  test(`with no point set, saved routes and favorites come right below the points (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${base}?lang=${language}`);
    const order = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '#route-panel > :is(.points-section, .saved-routes, .favorites, #trip-options, #route-details)',
          ),
        ].map((e) => e.id || e.className.split(' ')[0]),
      );
    // Trip options and the tabs come before the points (#305).
    expect(await order()).toEqual([
      'trip-options',
      'points-section',
      'saved-routes',
      'favorites',
      'route-details',
    ]);
    // Once a point is set they return below the route details (#213).
    await page.locator('#location-0').fill('-22.97, -43.18');
    await page.locator('#location-0').press('Tab');
    await expect
      .poll(order)
      .toEqual([
        'trip-options',
        'points-section',
        'route-details',
        'saved-routes',
        'favorites',
      ]);
  });

test('the Export menu stays on a phone held sideways, its choices whole (#301)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await mockRouting(page);
  await page.goto(`${base}?lang=pt`);
  // Export shows once there is a route (#306).
  await page.locator('#location-0').fill('-22.97, -43.18');
  await page.locator('#location-0').press('Tab');
  await page.locator('#location-1').fill('-23.02, -43.48');
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#export')).toBeVisible();
  await page.locator('#export').click();
  const menu = (await page.locator('#export-menu').boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(0);
  // Choices keep their size and the menu scrolls instead.
  expect(
    await page
      .locator('#export-menu > button:not([hidden])')
      .evaluateAll((all) =>
        all.every((b) => b.scrollHeight <= b.clientHeight + 1),
      ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#export-menu')).toBeHidden();
  await expect(page.locator('#export')).toBeFocused();
});

for (const width of [320, 390, 1280])
  for (const language of ['en', 'pt'] as const)
    test(`the empty planner's ways to start and the route's tabs fit at ${width}px in ${language} (#305, #306)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockRouting(page);
      await page.goto(`${base}?lang=${language}`);
      const start = page.locator('#start-options');
      await expect(start).toBeVisible();
      await expect(page.locator('#save-route')).toBeHidden();
      await expect(page.locator('#trip-options')).toBeHidden();
      // Each way to start keeps its name and note whole inside its button.
      const whole = (selector: string) =>
        page.locator(selector).evaluateAll((buttons) =>
          buttons
            .filter((b) => b.getClientRects().length)
            .filter(
              (b) =>
                b.scrollWidth > b.clientWidth + 1 ||
                [...b.children].some(
                  (c) =>
                    c.getBoundingClientRect().right >
                    b.getBoundingClientRect().right + 0.5,
                ),
            )
            .map((b) => b.id),
        );
      expect(await whole('.start-grid button')).toEqual([]);
      await page.locator('#location-0').fill('-22.97, -43.18');
      await page.locator('#location-0').press('Tab');
      await page.locator('#location-1').fill('-23.02, -43.48');
      await page.locator('#location-1').press('Tab');
      await expect(page.locator('#route-tabs')).toBeVisible();
      await expect(start).toBeHidden();
      // The tabs keep one line each; the row scrolls sideways where it is
      // wider than the panel.
      const tabs = await page
        .locator('#route-tabs button:visible')
        .evaluateAll((buttons) =>
          buttons.map((b) => Math.round(b.getBoundingClientRect().height)),
        );
      expect(new Set(tabs)).toEqual(new Set([44]));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      // A tab opens its section and closes the others; Points come back.
      await openTab(page, 'itinerary');
      await expect(page.locator('#itinerary details')).toHaveAttribute(
        'open',
        '',
      );
      await expect(page.locator('#points')).toBeHidden();
      await openTab(page, 'weather-section');
      await expect(page.locator('#itinerary details')).not.toHaveAttribute(
        'open',
        '',
      );
      await openTab(page, 'points');
      await expect(page.locator('#points')).toBeVisible();
      await expect(page.locator('#weather-section')).not.toHaveAttribute(
        'open',
        '',
      );
    });
