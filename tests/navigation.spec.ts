import { test, expect, type Page } from '@playwright/test';
import { chooseUnits } from './unit-settings';
import { sunTimes } from '../src/daylight';
import { decimalYear, magneticDeclination } from '../src/declination';
import {
  base,
  boxSettled,
  coveredControls,
  osrmFirst,
  overlapping,
} from './app-helpers';
import { BASEMAP_STYLE, scriptedTouches } from './map-helpers';
import { defaults, encodeState } from '../src/core';
// A route about 2.2 km east along a parallel, with a right turn at 1 km.
const lat = -22.93;
const lon = (i: number) => -43.24 + i * 0.001;
const coords = Array.from({ length: 21 }, (_, i) => [lon(i), lat]);
const start = `${lat}, ${lon(0)}`,
  end = `${lat}, ${lon(20)}`;
const longName = 'Avenida Prefeito Dulcídio Cardoso';

/**
 * The planner with an OSRM route 2.2 km east, ready to navigate: by default
 * a right turn onto `road` at 1 km and a left one at 1.5 km, or `steps`.
 */
async function setup(
  page: Page,
  road = 'Estrada das Furnas',
  steps?: Record<string, unknown>[],
) {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.route('**/route/v1/driving/**', (r) =>
    r.fulfill({
      json: {
        code: 'Ok',
        waypoints: [coords[0], coords[20]].map((location) => ({
          location,
          distance: 0,
        })),
        routes: [
          {
            distance: 2100,
            duration: 150,
            geometry: { coordinates: coords },
            legs: [
              {
                steps: steps ?? [
                  {
                    name: 'Rua Uruguai',
                    distance: 1000,
                    duration: 70,
                    maneuver: { type: 'depart', location: coords[0] },
                  },
                  {
                    name: road,
                    distance: 500,
                    duration: 40,
                    maneuver: {
                      type: 'turn',
                      modifier: 'right',
                      location: coords[10],
                    },
                  },
                  {
                    name: 'Estrada do Joá',
                    distance: 600,
                    duration: 40,
                    maneuver: {
                      type: 'turn',
                      modifier: 'left',
                      location: coords[15],
                    },
                  },
                  {
                    name: '',
                    distance: 0,
                    duration: 0,
                    maneuver: { type: 'arrive', location: coords[20] },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  // The maneuvers come from the OSRM mock, so OSRM routes first.
  await page.goto(osrmFirst());
  await page.locator('#language').selectOption('en');
  await page.locator('#location-0').fill(start);
  await page.locator('#location-0').press('Tab');
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#navigate')).toBeEnabled({ timeout: 15000 });
}
/** Every navigation text stays on its line inside the screen. */
/** The navigation route's color on screen. */
const ROUTE_COLOR = [0x12, 0x79, 0x6e];
/** The color of one screen pixel, as drawn. */
async function pixel(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, png.toString('base64'));
}
async function fits(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>(
      '.nav-distance, .nav-then, .nav-time, .nav-rest, .nav-stop, .nav-status, .nav-chip:not([hidden]), #navigate, #download, .nav-notice li, .nav-notice .check',
    )) {
      const box = e.getBoundingClientRect();
      if (!box.width) continue;
      if (box.right > innerWidth + 0.5 || box.left < -0.5)
        problems.push(`${e.className || e.id} leaves the screen`);
      if (e.scrollWidth > e.clientWidth + 1)
        problems.push(`${e.className || e.id} overflows`);
    }
    const eta = document.querySelector('.nav-eta')!.getBoundingClientRect(),
      stop = document.querySelector('.nav-stop')!.getBoundingClientRect();
    if (
      eta.width &&
      eta.right > stop.left &&
      eta.top < stop.bottom &&
      stop.top < eta.bottom
    )
      problems.push('time under Stop');
    // A stop's name may give way in the upcoming list; its arrival never.
    for (const clock of document.querySelectorAll<HTMLElement>(
      '.nav-list-stop .nav-list-detail',
    )) {
      const box = clock.getBoundingClientRect(),
        row = clock.closest('li')!.getBoundingClientRect();
      if (clock.scrollWidth > clock.clientWidth + 1 || box.right > row.right)
        problems.push(`arrival ${clock.textContent} cut off`);
    }
    return problems;
  });
}
/** Buttons and notices drawn over the navigation map. */
const MAP_OVERLAYS =
  '.nav-chip, .nav-map-button, #nav-speed, #nav-reroute, #nav-resume, .nav-credits-toggle';
/** Phone screens in landscape the layout is checked at (#252). */
const LANDSCAPE = [
  [568, 320],
  [667, 375],
  [852, 393],
  [932, 430],
] as const;
/**
 * The landscape layout (#252): the map fills the screen, the guidance is two
 * cards on its left with the map in view between them, the traveler in the
 * map beside the cards, the map's buttons and notices clear of the cards and
 * of one another, and every control answering at its center, uncovered.
 */
async function landscapeProblems(page: Page) {
  const layout = await page.evaluate((overlays) => {
    const problems: string[] = [];
    const box = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    const screen = box('#nav-screen'),
      stage = box('#nav-stage');
    if (screen.width < innerWidth - 1 || screen.height < innerHeight - 1)
      problems.push('the screen does not fill the window');
    if (stage.height < innerHeight - 1 || stage.width < innerWidth - 1)
      problems.push('the map does not fill the screen');
    // The map's drawing follows its area after turning the screen.
    const canvas = document
      .querySelector('#nav-map canvas')
      ?.getBoundingClientRect();
    if (
      canvas &&
      (Math.abs(canvas.width - stage.width) > 1 ||
        Math.abs(canvas.height - stage.height) > 1)
    )
      problems.push('the map is not drawn over its whole area');
    const banner = box('.nav-banner'),
      card = box('.nav-bar');
    for (const [name, e] of [
      ['banner', banner],
      ['bottom card', card],
    ] as const) {
      if (e.right > innerWidth / 2) problems.push(`the ${name} is too wide`);
      if (e.bottom > innerHeight + 0.5 || e.top < -0.5)
        problems.push(`the ${name} is cut off`);
    }
    if (card.top < banner.bottom) problems.push('the cards overlap');
    const bar = document.querySelector<HTMLElement>('.nav-bar')!;
    if (bar.scrollHeight > bar.clientHeight + 1)
      problems.push('the bottom card overflows');
    const hits = (p: DOMRect, q: DOMRect) =>
      p.left < q.right &&
      q.left < p.right &&
      p.top < q.bottom &&
      q.top < p.bottom;
    for (const e of document.querySelectorAll(overlays)) {
      const p = e.getBoundingClientRect();
      if (!e.checkVisibility()) continue;
      if (
        p.left < stage.left - 0.5 ||
        p.right > stage.right + 0.5 ||
        p.top < stage.top - 0.5 ||
        p.bottom > stage.bottom + 0.5
      )
        problems.push(`${e.id || e.className} leaves the map`);
      if (hits(p, banner) || hits(p, card))
        problems.push(`${e.id || e.className} under a card`);
    }
    // The traveler stays in the map beside the cards.
    const position = document.querySelector('.nav-position');
    if (position?.checkVisibility()) {
      const p = position.getBoundingClientRect();
      if (p.left < Math.max(banner.right, card.right))
        problems.push('the traveler is under the cards');
    }
    return problems;
  }, MAP_OVERLAYS);
  return [
    ...layout,
    ...(await overlapping(page, [MAP_OVERLAYS])),
    ...(await coveredControls(page, '#nav-screen')).map(
      (control) => `${control} is covered`,
    ),
  ];
}
/** The fixed clock of the tests that send their own fixes. */
const t0 = Date.parse('2026-11-14T12:00:00Z');
/**
 * Replaces the device's location with fixes the test sends itself
 * (`sendFix`), on a fixed clock, so time passes only as the fixes say.
 */
async function ownFixes(page: Page) {
  await page.clock.setFixedTime(new Date(t0));
  await page.addInitScript(() => {
    const w = window as unknown as {
      sendFix: (fix: {
        lon: number;
        lat: number;
        speed: number | null;
        accuracy: number;
        time: number;
      }) => void;
    };
    let deliver: PositionCallback | null = null;
    navigator.geolocation.watchPosition = (success) => {
      deliver = success;
      return 1;
    };
    navigator.geolocation.clearWatch = () => {};
    w.sendFix = ({ lon, lat, speed, accuracy, time }) =>
      deliver?.({
        coords: {
          latitude: lat,
          longitude: lon,
          accuracy,
          speed,
          heading: null,
          altitude: null,
          altitudeAccuracy: null,
        },
        timestamp: time,
      } as GeolocationPosition);
  });
}
/** One fix at `[lat, lon]` and `time`, with the page clock moved there. */
async function sendFix(
  page: Page,
  [latitude, longitude]: [number, number],
  time: number,
  speed: number | null = null,
  accuracy = 5,
) {
  await page.clock.setFixedTime(new Date(time));
  await page.evaluate(
    (f) => (window as unknown as { sendFix: (f: unknown) => void }).sendFix(f),
    { lat: latitude, lon: longitude, speed, accuracy, time },
  );
}

test.describe('phone navigation', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    // Motion sensors are allowed by default on phones; geolocation asks.
    permissions: ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'],
    geolocation: { latitude: lat + 0.00003, longitude: lon(6), accuracy: 6 },
  });

  test('follows the route with the next maneuver and arrival', async ({
    page,
    context,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    const notice = page.getByRole('dialog', { name: 'Before you go' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Avoid handling the phone');
    await notice.getByRole('button', { name: 'Start navigation' }).click();
    const screen = page.getByRole('dialog', { name: 'Navigation' });
    await expect(screen).toBeVisible();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    // About 410 m to the turn (0.001° is 102 m here), read in 50 m steps.
    await expect(page.locator('#nav-distance')).toHaveText('400 m');
    await expect(page.locator('#nav-turn svg.mirror')).toHaveCount(1);
    await expect(page.locator('#nav-then')).toContainText('Then');
    await expect(page.locator('#nav-then-distance')).toHaveText('500 m');
    // Our own estimate from the default 20 km/h (1.4 km), until the trip's
    // own average takes over.
    await expect(page.locator('#nav-time')).toHaveText('4 min');
    await expect(page.locator('#nav-rest')).toContainText('1.4 km ·');
    await expect(page.locator('#nav-waiting')).toBeHidden();
    await expect(page.locator('#nav-gps')).toBeHidden();
    await expect(page.locator('#nav-announce')).toHaveText(
      'Turn right · Estrada das Furnas',
    );

    // Past the turn, the next maneuver follows; a weak fix is flagged.
    await context.setGeolocation({
      latitude: lat,
      longitude: lon(12),
      accuracy: 60,
    });
    await expect(page.locator('#nav-road')).toHaveText('Estrada do Joá');
    await expect(page.locator('#nav-gps')).toBeVisible();

    await context.setGeolocation({
      latitude: lat,
      longitude: lon(20),
      accuracy: 5,
    });
    await expect(page.locator('#nav-road')).toHaveText('You have arrived');
    await expect(page.locator('#nav-then')).toBeHidden();

    await page.getByRole('button', { name: 'End navigation' }).click();
    await expect(screen).toBeHidden();
    await expect(page.locator('#navigate')).toBeFocused();
  });

  test('the notice can be turned off and back on in Settings', async ({
    page,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    await page.getByLabel("Don't show this notice again").check();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-screen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-screen')).toBeHidden();
    // Started again: straight to the navigation screen.
    await page.locator('#navigate').click();
    await expect(page.locator('#nav-screen')).toBeVisible();
    await expect(page.locator('#nav-notice')).toBeHidden();
    await page.locator('#nav-stop').click();
    await page.locator('#open-settings').click();
    const setting = page.getByLabel('Show the notice when navigation starts');
    await expect(setting).not.toBeChecked();
    await setting.check();
    await page.keyboard.press('Escape');
    await page.locator('#navigate').click();
    await expect(page.locator('#nav-notice')).toBeVisible();
  });

  test('location is watched only while navigating and the page is visible', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const geo = navigator.geolocation;
      const watch = geo.watchPosition.bind(geo),
        clear = geo.clearWatch.bind(geo);
      const w = window as unknown as { watching: number; hidden: boolean };
      w.watching = 0;
      w.hidden = false;
      geo.watchPosition = (...args) => {
        w.watching++;
        return watch(...args);
      };
      geo.clearWatch = (id) => {
        w.watching--;
        clear(id);
      };
      Object.defineProperty(document, 'visibilityState', {
        get: () => (w.hidden ? 'hidden' : 'visible'),
      });
    });
    await setup(page);
    const watching = () =>
      page.evaluate(() => (window as unknown as { watching: number }).watching);
    // Location is allowed: the planner's dot watches until navigation
    // starts, which replaces it with its own watch.
    await expect.poll(watching).toBe(1);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-waiting')).toBeHidden();
    expect(await watching()).toBe(1);
    const visibility = (hidden: boolean) =>
      page.evaluate((value) => {
        (window as unknown as { hidden: boolean }).hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await visibility(true);
    await expect.poll(watching).toBe(0);
    await visibility(false);
    await expect.poll(watching).toBe(1);
    await page.locator('#nav-stop').click();
    // Only the planner's dot again.
    await expect.poll(watching).toBe(1);
    // No position ever reaches the address or storage.
    expect(page.url()).not.toContain(String(lon(6)).slice(0, 7));
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain('-43.234');
  });

  test('the whole-route view has a clear way back to following', async ({
    page,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-waiting')).toBeHidden();
    // The screen, not its first button, takes focus: none looks selected.
    await expect(page.locator('#nav-screen')).toBeFocused();
    // From the keyboard, focus moves to the button that replaces it.
    await page.getByRole('button', { name: 'Route overview' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#nav-rotor')).toHaveAttribute('data-turn', '0');
    const resume = page.getByRole('button', { name: 'Re-center' });
    await expect(resume).toBeVisible();
    await expect(resume).toBeFocused();
    // On top of the map, where a finger reaches it, not under its layers.
    const onTop = () =>
      page.evaluate(() =>
        ['nav-resume', 'nav-overview', 'nav-stop'].filter((id) => {
          const e = document.getElementById(id)!;
          if (e.hidden) return false;
          const b = e.getBoundingClientRect();
          const hit = document.elementFromPoint(
            b.x + b.width / 2,
            b.y + b.height / 2,
          );
          return !e.contains(hit);
        }),
      );
    expect(await onTop()).toEqual([]);
    await expect(page.locator('#nav-overview')).toBeHidden();
    await resume.click();
    await expect(resume).toBeHidden();
    await expect(page.locator('#nav-overview')).toBeVisible();
    expect(await onTop()).toEqual([]);
    await expect(page.locator('#nav-rotor')).toHaveAttribute(
      'data-turn',
      '-90',
    );
  });

  test('the map zooms and pans by touch, with Resume back to following', async ({
    page,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-waiting')).toBeHidden();
    const rotor = page.locator('#nav-rotor'),
      resume = page.locator('#nav-resume'),
      marker = page.locator('.nav-mark');
    await expect(rotor).toHaveAttribute('data-turn', '-90');
    await expect(resume).toBeHidden();
    const stage = (await page.locator('#nav-stage').boundingBox())!;
    const x = stage.x + 120,
      y = stage.y + 200;
    // A double tap zooms in as on the planner map, around the tapped point,
    // then following slides the traveler back to its place.
    const before = (await marker.boundingBox())!;
    const zoomBefore = Number(await rotor.getAttribute('data-zoom'));
    await (await scriptedTouches(page)).doubleTap(x, y);
    await expect(resume).toBeVisible();
    await expect(rotor).toHaveAttribute('data-turn', '-90');
    await expect
      .poll(async () => Number(await rotor.getAttribute('data-zoom')))
      .toBeCloseTo(zoomBefore + 1, 1);
    await expect
      .poll(async () => {
        const zoomed = (await marker.boundingBox())!;
        return Math.hypot(zoomed.x - before.x, zoomed.y - before.y);
      })
      .toBeLessThan(2);
    await resume.click();
    await expect(resume).toBeHidden();
    // The browser's long-press menu never opens on the map: selection is
    // off on the whole page while navigating (iOS ignores it on the map).
    expect(
      await page.evaluate(() => getComputedStyle(document.body).userSelect),
    ).toBe('none');
    // The browser's long-press menu never opens on the map.
    expect(
      await page.evaluate(() =>
        document
          .getElementById('nav-map')!
          .dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
          ),
      ),
    ).toBe(false);
    // Touches on the map are cancelled, so iOS starts no loupe or callout.
    expect(
      await page.evaluate(() => {
        const canvas = document.querySelector('#nav-map canvas')!;
        const touch = new Touch({
          identifier: 9,
          target: canvas,
          clientX: 100,
          clientY: 300,
        });
        const init = { touches: [touch], changedTouches: [touch] };
        const cancelled = !canvas.dispatchEvent(
          new TouchEvent('touchstart', {
            ...init,
            bubbles: true,
            cancelable: true,
          }),
        );
        canvas.dispatchEvent(
          new TouchEvent('touchend', {
            changedTouches: [touch],
            bubbles: true,
          }),
        );
        return cancelled;
      }),
    ).toBe(true);
    // A pan on the turned map follows the finger and stops following.
    const drag = async (dx: number, dy: number) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up();
    };
    await boxSettled(page, '.nav-mark');
    const start = (await marker.boundingBox())!;
    await drag(-60, 80);
    // MapLibre moves the camera on its next frame, later under load.
    const shift = async () => {
      const moved = (await marker.boundingBox())!;
      return { x: moved.x - start.x, y: moved.y - start.y };
    };
    await expect.poll(async () => (await shift()).x).toBeLessThan(-40);
    expect((await shift()).y).toBeGreaterThan(60);
    await expect(resume).toBeVisible();
    // Panned, the map stays as the finger left it: the compass no longer
    // turns it.
    await page.evaluate(() =>
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientationabsolute', {
          alpha: 0,
          absolute: true,
        }),
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector<HTMLElement>('.nav-mark')!.style.transform,
        ),
      )
      .not.toBe('rotate(0deg)');
    await expect(rotor).toHaveAttribute('data-turn', '-90');
    await resume.click();
    await expect(resume).toBeHidden();
    // The whole route stays north-up when panned.
    await page.locator('#nav-overview').click();
    await drag(40, 0);
    await expect(page.locator('#nav-overview')).toBeVisible();
    await expect(rotor).toHaveAttribute('data-turn', '0');
  });

  test('one finger zooms in and a two-finger tap zooms out, then following comes back', async ({
    page,
  }) => {
    await setup(page);
    const zoom = async () =>
      Number(await page.locator('#nav-rotor').getAttribute('data-zoom'));
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-waiting')).toBeHidden();
    await expect.poll(zoom).toBeGreaterThan(0);
    const before = await zoom();
    const marker = (await page.locator('.nav-mark').boundingBox())!;
    const stage = (await page.locator('#nav-stage').boundingBox())!;
    const x = stage.x + 120,
      y = stage.y + stage.height / 3;
    const touches = await scriptedTouches(page);
    const { session, pause } = touches;
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty = y) =>
      touches.touch(type, x, ty);
    touches.gesture();
    await touch('touchStart');
    await touch('touchEnd');
    await pause(80);
    await touch('touchStart');
    for (let step = 1; step <= 10; step++) {
      await touch('touchMove', y + 22 * step);
      await pause(30);
    }
    await touch('touchEnd');
    await expect.poll(zoom).toBeGreaterThanOrEqual(before + 1);
    // A zoom, not a pan: still following, the traveler where it was.
    await expect(page.locator('#nav-resume')).toBeVisible();
    await expect(page.locator('#nav-rotor')).toHaveAttribute(
      'data-turn',
      '-90',
    );
    const back = async () => {
      const after = (await page.locator('.nav-mark').boundingBox())!;
      return Math.hypot(after.x - marker.x, after.y - marker.y);
    };
    await expect.poll(back).toBeLessThan(2);
    // A tap with two fingers zooms out, as on the planner map, and keeps
    // following.
    const zoomedIn = await zoom();
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x, y, id: 0 },
        { x: x + 80, y, id: 1 },
      ],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect.poll(zoom).toBeLessThanOrEqual(zoomedIn - 0.9);
    await expect.poll(back).toBeLessThan(2);
    // A pinch whose fingers drift is a zoom, not a pan: following comes back.
    const zoomedOut = await zoom();
    const pinch = (spread: number, drift: number) => [
      { x: x - spread + drift, y: y + drift, id: 0 },
      { x: x + spread + drift, y: y + drift, id: 1 },
    ];
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: pinch(40, 0),
    });
    for (let step = 1; step <= 10; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pinch(40 + 8 * step, 6 * step),
      });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect.poll(zoom).toBeGreaterThan(zoomedOut + 0.5);
    await expect.poll(back).toBeLessThan(2);
    await expect(page.locator('#nav-rotor')).toHaveAttribute(
      'data-turn',
      '-90',
    );
  });

  test('two fingers turning turn the map; Re-center turns it back', async ({
    page,
    context,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-waiting')).toBeHidden();
    const rotor = page.locator('#nav-rotor'),
      resume = page.getByRole('button', { name: 'Re-center' });
    await expect(rotor).toHaveAttribute('data-turn', '-90');
    const stage = (await page.locator('#nav-stage').boundingBox())!;
    const cx = stage.x + stage.width / 2,
      cy = stage.y + stage.height / 2,
      r = 80;
    const session = await context.newCDPSession(page);
    // Two fingers on a circle, turning together by `degrees` clockwise.
    const fingers = (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      return [
        { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 0 },
        { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 1 },
      ];
    };
    const turn = async (degrees: number) => {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: fingers(0),
      });
      for (let step = 1; step <= 10; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: fingers((degrees * step) / 10),
        });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    };
    const angle = async () => Number(await rotor.getAttribute('data-turn'));
    // A small twist during a pinch does not turn the map.
    await turn(8);
    expect(await angle()).toBeCloseTo(-90, 0);
    await expect(resume).toBeHidden();
    // Past MapLibre's threshold the map turns clockwise with the fingers.
    await turn(45);
    expect(await angle()).toBeGreaterThan(-65);
    expect(await angle()).toBeLessThan(-40);
    await expect(resume).toBeVisible();
    // At the bottom left, where a thumb reaches it.
    const box = (await resume.boundingBox())!;
    expect(box.x).toBeLessThan(20);
    expect(box.y + box.height).toBeGreaterThan(stage.y + stage.height - 60);
    await resume.click();
    await expect(resume).toBeHidden();
    expect(await angle()).toBeCloseTo(-90, 0);
    // The compass shows on a turned map; it turns the map north-up and
    // keeps following, and Re-center goes back to heading-up.
    const compass = page.getByRole('button', { name: 'North up' });
    await expect(compass).toBeVisible();
    await compass.click();
    await expect(rotor).toHaveAttribute('data-turn', '0');
    await expect(compass).toBeHidden();
    await expect(resume).toBeVisible();
    await resume.click();
    expect(await angle()).toBeCloseTo(-90, 0);
  });

  test('stopped, the map turns with the compass; moving, with the route', async ({
    page,
    context,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    const rotor = page.locator('#nav-rotor');
    // The route runs east: without a compass the map turns to it.
    await expect(rotor).toHaveAttribute('data-turn', '-90');
    const turned = async () => Number(await rotor.getAttribute('data-turn'));
    const arrow = () =>
      page
        .locator('.nav-mark')
        .evaluate((e) => (e as HTMLElement).style.transform);
    // Here magnetic north is about 23° west of true north (WMM2025).
    const declination = magneticDeclination(
      lat,
      lon(6),
      decimalYear(new Date()),
    );
    // Standing still, the phone's top pointing to magnetic north.
    await page.evaluate(() =>
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientationabsolute', {
          alpha: 0,
          absolute: true,
        }),
      ),
    );
    // The map turns to true north, the declination away from magnetic
    // north, and the arrow points up the screen.
    await expect
      .poll(() => turned())
      .toBeCloseTo(-((declination + 360) % 360), 0);
    expect(await arrow()).toBe('rotate(0deg)');
    await expect(page.locator('#nav-compass')).toBeHidden();
    // iOS gives its own heading and accuracy; a poor one asks to calibrate.
    await page.evaluate(() => {
      const event = new DeviceOrientationEvent('deviceorientation', {
        alpha: 10,
        absolute: false,
      });
      Object.defineProperty(event, 'webkitCompassHeading', { value: 90 });
      Object.defineProperty(event, 'webkitCompassAccuracy', { value: -1 });
      for (let i = 0; i < 40; i++) window.dispatchEvent(event);
    });
    await expect(page.locator('#nav-compass')).toBeVisible();
    await expect.poll(() => turned()).toBeCloseTo(-(90 + declination), 0);
    // Moving about 300 m in a moment: the direction of travel wins.
    await context.setGeolocation({
      latitude: lat,
      longitude: lon(9),
      accuracy: 5,
    });
    await expect(rotor).toHaveAttribute('data-turn', '-90');
    await expect(page.locator('#nav-compass')).toBeHidden();
  });

  for (const [language, width] of [
    ['en', 390],
    ['pt', 320],
  ] as const)
    test(`off the route, a straight-line hint points back to it (${language}, ${width} px)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await setup(page);
      await page.locator('#language').selectOption(language);
      await page.locator('#navigate').click();
      await page.locator('#nav-notice-start').click();
      const road = page.locator('#nav-road'),
        hint = page.locator('#nav-hint');
      await expect(road).toHaveText('Estrada das Furnas');
      await expect(hint).toBeHidden();
      const zoom = async () =>
        Number(await page.locator('#nav-rotor').getAttribute('data-zoom'));
      await expect.poll(zoom).toBeGreaterThan(0);
      const following = await zoom();
      // About 1.3 km north of the route, so the map must step out to show
      // the rejoin point: off it only once it lasts 5 s.
      const off = (shift: number) =>
        context.setGeolocation({
          latitude: lat + 0.012 + shift,
          longitude: lon(7),
          accuracy: 8,
        });
      await off(0);
      await page.waitForTimeout(1000);
      await expect(hint).toBeHidden();
      await page.waitForTimeout(4500);
      await off(0.00001);
      const back = language === 'pt' ? 'Volte à rota' : 'Back to route';
      await expect(road).toHaveText(back);
      await expect(hint).toHaveText(
        language === 'pt'
          ? 'Em linha reta, não pelas ruas'
          : 'Straight line, not by road',
      );
      await expect(page.locator('#nav-screen')).toHaveClass(/off-route/);
      await expect(page.locator('#nav-then')).toBeHidden();
      await expect(page.locator('#nav-announce')).toHaveText(
        language === 'pt'
          ? 'Fora da rota · Volte à rota'
          : 'Off the route · Back to route',
      );
      // Straight-line distance to a point ahead, rounded like maneuvers.
      await expect(page.locator('#nav-distance')).toHaveText(/^\d+[.,]\d\skm$/);
      // On the map turned east-up, the route (south) is to the right and
      // ahead (east) is up: the arrow points up and to the right.
      const angle = Number(
        /rotate\((-?[\d.]+)deg\)/.exec(
          (await page.locator('#nav-turn svg.rejoin').getAttribute('style')) ??
            '',
        )?.[1],
      );
      expect(angle).toBeGreaterThan(0);
      expect(angle).toBeLessThan(90);
      // The map steps out so the rejoin point shows.
      await expect.poll(zoom).toBeLessThan(following);
      expect(await fits(page)).toEqual([]);
      // Back on the route, the maneuver returns at the chosen zoom.
      await context.setGeolocation({
        latitude: lat,
        longitude: lon(8),
        accuracy: 5,
      });
      await expect(road).toHaveText('Estrada das Furnas');
      await expect(hint).toBeHidden();
      await expect(page.locator('#nav-screen')).not.toHaveClass(/off-route/);
      await expect.poll(zoom).toBeCloseTo(following, 1);
    });

  /**
   * Recalculation requests (any routing request not from the planned
   * start), answered with a path east then south back to the route, or
   * refused. Registered after `setup`, so it is matched first.
   */
  async function mockReroute(page: Page, ok = true) {
    const asked: string[] = [];
    const reroute = (url: string) => !url.includes(`/${lon(0)},${lat};`);
    await page.route('**/route/v1/driving/**', (r) => {
      if (!reroute(r.request().url())) return r.fallback();
      asked.push(r.request().url());
      if (!ok) return r.fulfill({ status: 503, body: '' });
      const [from, to] = decodeURIComponent(
        r.request().url().split('/driving/')[1].split('?')[0],
      )
        .split(';')
        .map((p) => p.split(',').map(Number));
      const corner = [to[0], from[1]];
      return r.fulfill({
        json: {
          code: 'Ok',
          waypoints: [from, to].map((location) => ({ location, distance: 0 })),
          routes: [
            {
              distance: 700,
              duration: 60,
              geometry: { coordinates: [from, corner, to] },
              legs: [
                {
                  steps: [
                    {
                      name: 'Rua Lateral',
                      distance: 400,
                      duration: 30,
                      maneuver: { type: 'depart', location: from },
                    },
                    {
                      name: 'Rua de Volta',
                      distance: 300,
                      duration: 30,
                      maneuver: {
                        type: 'turn',
                        modifier: 'right',
                        location: corner,
                      },
                    },
                    {
                      name: '',
                      distance: 0,
                      duration: 0,
                      maneuver: { type: 'arrive', location: to },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    });
    await page.route('**/valhalla1.openstreetmap.de/**', (r) => {
      asked.push(r.request().url());
      return r.fulfill({ status: 503, body: '' });
    });
    return asked;
  }
  /** About 330 m north of the route at the 0.7 km mark; `shift` makes a new fix. */
  /** Where the rerouting tests start, on the route before its turn. */
  const onRoute: [number, number] = [lat + 0.00003, lon(6)];
  /** About 330 m north of the route, nudged by `shift` for a new fix. */
  const offRoute = (shift = 0): [number, number] => [
    lat + 0.003 + shift,
    lon(7) + shift,
  ];
  /**
   * Navigation on fixes the test sends, from `onRoute` at `t0 + 1 s`, with
   * rerouting answered (`ok`) or refused; `before` runs ahead of Navigate and
   * `start` closes the start notice.
   */
  async function rerouting(
    page: Page,
    {
      ok = true,
      before = async () => {},
      start = () => page.locator('#nav-notice-start').click(),
    }: {
      ok?: boolean;
      before?: () => Promise<void>;
      start?: () => Promise<void>;
    } = {},
  ) {
    await ownFixes(page);
    await setup(page);
    await before();
    const asked = await mockReroute(page, ok);
    await page.locator('#navigate').click();
    await start();
    await sendFix(page, onRoute, t0 + 1000);
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    return asked;
  }
  /** Off the route, a new fix every 3 s for 21 s, as a traveler would. */
  async function offRouteFor21s(page: Page) {
    for (let i = 0; i < 7; i++)
      await sendFix(page, offRoute(i * 0.00001), t0 + 4000 + i * 3000, null, 8);
  }

  test('off the route for 15 s, the route is recalculated once', async ({
    page,
  }) => {
    const asked = await rerouting(page);
    // New fixes every few seconds while off the route.
    await offRouteFor21s(page);
    await expect(page.locator('#nav-road')).toHaveText('Rua de Volta');
    await expect(page.locator('#nav-rerouted')).toBeVisible();
    await expect(page.locator('#nav-screen')).not.toHaveClass(/off-route/);
    expect(asked).toHaveLength(1);
    // The position is sent at full precision.
    const [from] = asked[0].split('/driving/')[1].split(';');
    const [x, y] = from.split(',');
    const fixes = [...Array(7).keys()].map((i) =>
      Number((lat + 0.003 + i * 0.00001).toFixed(6)),
    );
    expect(fixes).toContain(Number(y));
    expect(x).toMatch(/^-43\.\d+$/);
    // The planned route goes on after the recalculated path.
    await expect(page.locator('#nav-then')).toBeVisible();
    // Nothing more within the minute, and the planner's route is unchanged.
    await page.waitForTimeout(2000);
    expect(asked).toHaveLength(1);
    await page.locator('#nav-stop').click();
    expect(page.url()).not.toContain('43.233');
  });

  test('Recalculate route asks once; a failure keeps the hint', async ({
    page,
    context,
  }) => {
    const asked = await rerouting(page, { ok: false });
    const button = page.getByRole('button', { name: 'Recalculate route' });
    // Off the route for 5.5 s.
    await sendFix(page, offRoute(), t0 + 2000, null, 8);
    await sendFix(page, offRoute(0.00001), t0 + 7500, null, 8);
    await expect(page.locator('#nav-road')).toHaveText('Back to route');
    await expect(button).toBeEnabled();
    await button.click();
    // OSRM, then the Valhalla fallback once; no retry.
    await expect(page.locator('#nav-reroute-failed')).toBeVisible({
      timeout: 10000,
    });
    expect(asked).toHaveLength(2);
    await expect(page.locator('#nav-road')).toHaveText('Back to route');
    await expect(page.locator('#nav-hint')).toBeVisible();
    // The button waits out the minute, saying how long.
    const waiting = page.locator('#nav-reroute');
    await expect(waiting).toBeDisabled();
    await expect(waiting).toHaveText(/^Recalculate in \d+ s$/);
    expect(await fits(page)).toEqual([]);
    // Offline, there is no button and nothing is sent.
    await context.setOffline(true);
    await sendFix(page, offRoute(0.00002), t0 + 9000, null, 8);
    await expect(waiting).toBeHidden();
    expect(asked).toHaveLength(2);
    await context.setOffline(false);
  });

  test('with automatic recalculation off, only the button asks', async ({
    page,
  }) => {
    const asked = await rerouting(page, {
      start: async () => {
        const auto = page.getByLabel('Recalculate the route automatically', {
          exact: true,
        });
        await expect(auto).toBeChecked();
        await auto.uncheck();
        await page.locator('#nav-notice-start').click();
      },
    });
    await expect(page.locator('#nav-auto-reroute')).toBeHidden();
    await offRouteFor21s(page);
    await expect(page.locator('#nav-road')).toHaveText('Back to route');
    expect(asked).toHaveLength(0);
    await page.getByRole('button', { name: 'Recalculate route' }).click();
    await expect(page.locator('#nav-road')).toHaveText('Rua de Volta');
    expect(asked).toHaveLength(1);
    // Remembered on the device, and shown in Settings.
    await page.locator('#nav-stop').click();
    expect(
      await page.evaluate(() => localStorage.getItem('auto-reroute')),
    ).toBe('off');
    await page.locator('#open-settings').click();
    const setting = page.getByLabel(
      'Recalculate the route automatically while navigating',
    );
    await expect(setting).not.toBeChecked();
    await setting.check();
    expect(
      await page.evaluate(() => localStorage.getItem('auto-reroute')),
    ).toBeNull();
  });

  test('without the notice, a chip says recalculation is automatic', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(() =>
      localStorage.setItem('navigation-notice', 'off'),
    );
    await ownFixes(page);
    await setup(page);
    const asked = await mockReroute(page);
    await page.locator('#navigate').click();
    const chip = page.locator('#nav-auto-reroute');
    await expect(chip.locator('span')).toHaveText('Automatic recalculation on');
    expect(await fits(page)).toEqual([]);
    // Each start says it again while it stays on.
    await page.locator('#nav-stop').click();
    await page.locator('#language').selectOption('pt');
    await page.locator('#navigate').click();
    await expect(chip.locator('span')).toHaveText('Recálculo automático ativo');
    expect(await fits(page)).toEqual([]);
    await chip.getByRole('button', { name: 'Desativar' }).click();
    await expect(chip).toBeHidden();
    expect(
      await page.evaluate(() => localStorage.getItem('auto-reroute')),
    ).toBe('off');
    await sendFix(page, onRoute, t0 + 1000);
    await offRouteFor21s(page);
    await expect(page.locator('#nav-road')).toHaveText('Volte à rota');
    expect(asked).toHaveLength(0);
    // Off, the next navigation shows no chip.
    await page.locator('#nav-stop').click();
    await page.locator('#navigate').click();
    await expect(page.locator('#nav-screen')).toBeVisible();
    await expect(chip).toBeHidden();
  });

  test('the recalculation texts fit at 320 px in Portuguese', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await rerouting(page, {
      ok: false,
      before: () => page.locator('#language').selectOption('pt').then(),
    });
    // Off the route for 5.5 s.
    await sendFix(page, offRoute(), t0 + 2000, null, 8);
    await sendFix(page, offRoute(0.00001), t0 + 7500, null, 8);
    const button = page.getByRole('button', { name: 'Recalcular rota' });
    await expect(button).toBeVisible();
    expect(await fits(page)).toEqual([]);
    await button.click();
    await expect(page.locator('#nav-reroute-failed')).toHaveText(
      'Não foi possível recalcular a rota',
      { timeout: 10000 },
    );
    await expect(page.locator('#nav-reroute')).toHaveText(
      /^Recalcular em \d+ s$/,
    );
    expect(await fits(page)).toEqual([]);
  });

  for (const width of [320, 360, 390, 430])
    for (const language of ['en', 'pt'] as const)
      test(`off the route and with the list open, nothing covers anything at ${width}px in ${language}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 320 ? 568 : 844,
        });
        await rerouting(page, {
          ok: false,
          before: () => page.locator('#language').selectOption(language).then(),
        });
        // Moving off the route for 5.5 s: the badge and Recalculate show.
        await sendFix(page, offRoute(), t0 + 2000, 5, 8);
        await sendFix(page, offRoute(0.00001), t0 + 7500, 5, 8);
        await expect(page.locator('#nav-reroute')).toBeVisible();
        await expect(page.locator('#nav-speed')).toBeVisible();
        expect(
          await overlapping(page, [
            '#nav-speed',
            '#nav-reroute',
            '#nav-resume',
            '.nav-credits-toggle',
            '#nav-list-toggle',
          ]),
        ).toEqual([]);
        // A sheet like the route panel: rounded top, its handle across the
        // top and End well apart from it.
        await expect(page.locator('.nav-bar')).toHaveCSS(
          'border-top-left-radius',
          '16px',
        );
        const handle = (await page.locator('#nav-list-toggle').boundingBox())!,
          end = (await page.locator('#nav-stop').boundingBox())!;
        expect(end.y).toBeGreaterThanOrEqual(handle.y + handle.height);
        // The time and End share one row.
        const eta = (await page.locator('.nav-eta').boundingBox())!;
        expect(
          Math.abs(eta.y + eta.height / 2 - (end.y + end.height / 2)),
        ).toBeLessThanOrEqual(4);
        // The whole bar is the list's touch target (#207).
        await page.locator('#nav-time').click();
        const rows = page.locator('#nav-list li');
        await expect(rows.first()).toBeVisible();
        await expect(
          page.locator('.nav-list-stop .nav-list-detail'),
        ).not.toHaveCount(0);
        expect(await fits(page)).toEqual([]);
        // Every row answers at its text and at its distance, uncovered.
        for (const row of await rows.all()) {
          const box = (await row.boundingBox())!;
          for (const x of [box.x + 8, box.x + box.width - 8])
            expect(
              await row.evaluate(
                (li, [px, py]) =>
                  li.contains(document.elementFromPoint(px, py)),
                [x, box.y + box.height / 2],
              ),
            ).toBe(true);
        }
      });

  for (const [width, height] of LANDSCAPE)
    for (const language of ['en', 'pt'] as const)
      test(`in landscape the guidance is two cards over the map at ${width}x${height} in ${language}`, async ({
        page,
      }) => {
        // A slow average speed (a device preference) for a time over an hour.
        await page.addInitScript(() =>
          localStorage.setItem('average-speed', '1'),
        );
        await ownFixes(page);
        await setup(page, longName);
        await chooseUnits(page, { distance: 'imperial' });
        await page.locator('#language').selectOption(language);
        await mockReroute(page, false);
        await page.locator('#navigate').click();
        await page.locator('#nav-notice-start').click();
        await sendFix(page, onRoute, t0 + 1000);
        await expect(page.locator('#nav-road')).toHaveText(longName);
        // Off the route for 5.5 s, moving: the hint, the speed badge and
        // Recalculate show; the whole route adds Re-center.
        await sendFix(page, offRoute(), t0 + 2000, 5, 8);
        await sendFix(page, offRoute(0.00001), t0 + 7500, 5, 8);
        await expect(page.locator('#nav-reroute')).toBeVisible();
        await page.locator('#nav-overview').click();
        await expect(page.locator('#nav-resume')).toBeVisible();
        // Turned sideways while navigating.
        await page.setViewportSize({ width, height });
        await expect(page.locator('#nav-speed')).toBeVisible();
        await expect(page.locator('#nav-hint')).toBeVisible();
        await expect.poll(() => landscapeProblems(page)).toEqual([]);
        expect(await fits(page)).toEqual([]);
        // The upcoming list is closed; its handle opens it in the bottom
        // card, between the banner and the time, the current stretch first.
        await expect(page.locator('#nav-list')).toBeHidden();
        await page.locator('#nav-list-toggle').click();
        await expect(page.locator('#nav-list li').first()).toHaveAttribute(
          'aria-current',
          'step',
        );
        const banner = (await page.locator('.nav-banner').boundingBox())!,
          list = (await page.locator('#nav-list').boundingBox())!,
          time = (await page.locator('#nav-time').boundingBox())!,
          card = (await page.locator('.nav-bar').boundingBox())!;
        expect(list.y).toBeGreaterThanOrEqual(banner.y + banner.height - 0.5);
        expect(list.y + list.height).toBeLessThanOrEqual(time.y + 0.5);
        expect(list.x).toBeGreaterThanOrEqual(card.x - 0.5);
        expect(list.x + list.width).toBeLessThanOrEqual(
          card.x + card.width + 0.5,
        );
        expect(await landscapeProblems(page)).toEqual([]);
        await expect(
          page.locator('.nav-list-stop .nav-list-detail'),
        ).not.toHaveCount(0);
        expect(await fits(page)).toEqual([]);
        // The handle closes it again.
        await page.locator('#nav-list-toggle').click();
        await expect(page.locator('#nav-list')).toBeHidden();
        // Back upright, the portrait layout returns.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect
          .poll(
            async () =>
              (await page.locator('.nav-banner').boundingBox())!.width,
          )
          .toBeGreaterThan(360);
      });

  for (const [width, height] of [
    [320, 568],
    [390, 844],
  ])
    for (const language of ['en', 'pt'] as const)
      test(`Start navigation shows without scrolling at ${width}x${height} in ${language}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await setup(page);
        await page.locator('#language').selectOption(language);
        await page.locator('#navigate').click();
        const start = page.locator('#nav-notice-start');
        await expect(start).toBeVisible();
        const box = (await start.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(height);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(await fits(page)).toEqual([]);
      });

  /** Sunset and sunrise on the route's start, on the day of `t0`. */
  const sun = sunTimes(t0, [lat, lon(0)]);
  /** Navigation at 1 km/h, so the 2.1 km route takes about two hours. */
  async function slowNavigation(page: Page, language: 'en' | 'pt' = 'en') {
    await page.addInitScript(() => localStorage.setItem('average-speed', '1'));
    await ownFixes(page);
    await setup(page);
    await page.locator('#language').selectOption(language);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
  }
  /** The minutes a sun chip announces, from its text in either language. */
  const chipMinutes = async (page: Page) =>
    Number(/(\d+) min$/.exec(await page.locator('#nav-sun').innerText())![1]);

  test('a sunset before the arrival shows within the hour, never at midday', async ({
    page,
  }) => {
    await slowNavigation(page);
    const chip = page.locator('#nav-sun');
    await sendFix(page, [lat, lon(0)], t0 + 1000);
    await expect(chip).toBeHidden();
    await sendFix(page, [lat, lon(0)], sun.sunset! - 70 * 60_000);
    await expect(chip).toBeHidden();
    await sendFix(page, [lat, lon(0)], sun.sunset! - 40 * 60_000);
    await expect(chip).toHaveText(/^Sunset in \d+ min$/);
    expect(Math.abs((await chipMinutes(page)) - 40)).toBeLessThanOrEqual(2);
    await page.keyboard.press('Escape');
    await page.locator('#language').selectOption('pt');
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await sendFix(page, [lat, lon(0)], sun.sunset! - 39 * 60_000);
    await expect(chip).toHaveText(/^Sol se põe em \d+ min$/);
  });

  for (const width of [320, 390])
    test(`a sunrise ahead stays on one line beside the map tools at ${width}px in pt`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 640 });
      await slowNavigation(page, 'pt');
      // The longest text: "Sol nasce em 60 min".
      await sendFix(page, [lat, lon(0)], sun.sunrise! - 59.6 * 60_000);
      const chip = page.locator('#nav-sun');
      await expect(chip).toHaveText(/^Sol nasce em \d+ min$/);
      expect(await fits(page)).toEqual([]);
      const box = (await chip.boundingBox())!,
        tools = (await page.locator('.nav-map-tools').boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(tools.x);
      // One line: no taller than the chip's own single-line height.
      expect(box.height).toBeLessThanOrEqual(44);
    });

  test('voice on, the sunset is said once, half an hour ahead', async ({
    page,
  }) => {
    const said = await recordSpeech(page);
    await page.addInitScript(() =>
      localStorage.setItem('navigation-voice', 'on'),
    );
    await slowNavigation(page);
    const sunsets = async () =>
      (await said())
        .map(([text]) => text)
        .filter((s) => s.startsWith('Sunset'));
    await sendFix(page, [lat, lon(0)], sun.sunset! - 45 * 60_000);
    await expect(page.locator('#nav-sun')).toBeVisible();
    expect(await sunsets()).toEqual([]);
    await sendFix(page, [lat, lon(0)], sun.sunset! - 29 * 60_000);
    await expect
      .poll(sunsets)
      .toEqual([expect.stringMatching(/^Sunset in \d+ minutes\.$/)]);
    await sendFix(page, [lat, lon(0)], sun.sunset! - 20 * 60_000);
    await page.waitForTimeout(300);
    expect(await sunsets()).toHaveLength(1);
  });

  test('without map tiles the route still shows with a notice', async ({
    page,
  }) => {
    await setup(page);
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort());
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-no-map')).toBeVisible();
    await expect(page.locator('#nav-no-gl')).toBeHidden();
    await expect(page.locator('#nav-rotor')).toHaveAttribute(
      'data-turn',
      '-90',
    );
    // The route ahead draws up the screen from the traveler, in its color,
    // over the neutral background.
    const arrow = (await page.locator('.nav-mark').boundingBox())!;
    const cx = arrow.x + arrow.width / 2;
    await expect.poll(() => pixel(page, cx, arrow.y - 60)).toEqual(ROUTE_COLOR);
    expect(await pixel(page, cx + 60, arrow.y - 60)).toEqual([
      0xe9, 0xec, 0xe9,
    ]);
  });

  test('a map style that failed without a connection loads when it returns, under the route', async ({
    page,
  }) => {
    await setup(page);
    // Only the browser's connection state and the style's server go offline:
    // the development server has no service worker, so a real offline
    // context would also fail MapLibre's own worker, which the published
    // site keeps in its app-shell cache.
    const onLine = (value: boolean) =>
      page.evaluate((now) => {
        Object.defineProperty(navigator, 'onLine', {
          configurable: true,
          get: () => now,
        });
        window.dispatchEvent(new Event(now ? 'online' : 'offline'));
      }, value);
    let offline = true;
    await page.route('https://tiles.openfreemap.org/**', (r) =>
      offline
        ? r.abort('internetdisconnected')
        : r.request().url().includes('/styles/')
          ? r.fulfill({ json: BASEMAP_STYLE })
          : r.fulfill({ status: 204 }),
    );
    await onLine(false);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-no-map')).toBeVisible();
    offline = false;
    await onLine(true);
    await expect(page.locator('#nav-no-map')).toBeHidden();
    // The route is drawn again over the new style, ahead of the traveler.
    const arrow = (await page.locator('.nav-mark').boundingBox())!;
    await expect
      .poll(() => pixel(page, arrow.x + arrow.width / 2, arrow.y - 60))
      .toEqual(ROUTE_COLOR);
  });

  test('without WebGL the directions still guide, with a notice', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- called with this
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        return /webgl/.test(type)
          ? null
          : (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof get;
    });
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-no-gl')).toBeVisible();
    await expect(page.locator('#nav-no-map')).toBeHidden();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
  });

  for (const [language, width] of [
    ['en', 320],
    ['pt', 320],
    ['pt', 360],
    ['en', 430],
  ] as const)
    test(`navigation text fits at ${width} px in ${language} with long values`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 640 });
      // A slow average speed (a device preference) for a time over an hour.
      await page.addInitScript(() =>
        localStorage.setItem('average-speed', '1'),
      );
      await setup(page, longName);
      await chooseUnits(page, { distance: 'imperial' });
      await page.locator('#language').selectOption(language);
      expect(await fits(page)).toEqual([]);
      await page.locator('#navigate').click();
      expect(await fits(page)).toEqual([]);
      await page.locator('#nav-notice-start').click();
      await context.setGeolocation({
        latitude: lat + 0.0003,
        longitude: lon(3),
        accuracy: 400,
      });
      await expect(page.locator('#nav-gps')).toBeVisible();
      await expect(page.locator('#nav-road')).toHaveText(longName);
      await expect(page.locator('#nav-time')).toContainText('h');
      expect(await fits(page)).toEqual([]);
      // The long name wraps to two lines at most, below the distance.
      const lines = await page
        .locator('#nav-road')
        .evaluate(
          (e) =>
            e.getBoundingClientRect().height /
            parseFloat(getComputedStyle(e).lineHeight),
        );
      expect(lines).toBeLessThanOrEqual(2.05);
    });

  /**
   * An out-and-back route (#191): east to coords[20] through the named
   * turnaround, then back west on the same road to the start.
   */
  async function outAndBack(
    page: Page,
    names = ['Home', 'Vista Chinesa', 'Home'],
  ) {
    const back = coords.slice(0, -1).reverse();
    const leg = (road: string, from: number[], to: number[]) => ({
      steps: [
        {
          name: road,
          distance: 2050,
          duration: 150,
          maneuver: { type: 'depart', location: from },
        },
        {
          name: '',
          distance: 0,
          duration: 0,
          maneuver: { type: 'arrive', location: to },
        },
      ],
    });
    await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
    await page.route('**/route/v1/driving/**', (r) =>
      r.fulfill({
        json: {
          code: 'Ok',
          waypoints: [coords[0], coords[20], coords[0]].map((location) => ({
            location,
            distance: 0,
          })),
          routes: [
            {
              distance: 4100,
              duration: 300,
              geometry: { coordinates: [...coords, ...back] },
              legs: [
                leg('Rua Uruguai', coords[0], coords[20]),
                leg('Estrada do Joá', coords[20], coords[0]),
              ],
            },
          ],
        },
      }),
    );
    const state = defaults();
    state.prefer = false;
    state.points = names.map((name, i) => ({
      name,
      coord: [lat, lon(i === 1 ? 20 : 0)],
    }));
    await page.goto(base + encodeState(state));
    await page.locator('#language').selectOption('en');
    await expect(page.locator('#navigate')).toBeEnabled({ timeout: 15000 });
  }

  test('on a road used both ways, the start asks which way and follows the choice', async ({
    page,
  }) => {
    // The fix is about 610 m from the start, on both passes.
    await outAndBack(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    const question = page.getByRole('group', {
      name: 'Which way are you going?',
    });
    await expect(question).toBeVisible();
    const options = question.getByRole('button');
    await expect(options).toHaveText([
      /^Vista Chinesa 3\.\d\skm$/,
      /^Home 0\.6\skm$/,
    ]);
    // Nothing ahead is shown or said until the traveler chooses.
    await expect(page.locator('.nav-banner-main')).toBeHidden();
    await expect(page.locator('#nav-time')).toHaveText('-');
    await expect(page.locator('#nav-rest')).toHaveText('-');
    await expect(page.locator('#nav-announce')).toHaveText(
      'Which way are you going?',
    );
    await options.filter({ hasText: 'Home' }).click();
    await expect(question).toBeHidden();
    await expect(page.locator('.nav-banner-main')).toBeVisible();
    await expect(page.locator('#nav-rest')).toContainText('0.6 km ·');
    await expect(page.locator('#nav-road')).not.toHaveText('Vista Chinesa');
    await expect(page.locator('#nav-screen')).toBeFocused();
    // Stopped, without a compass, the map stays north up: the way back
    // ahead (west, to the left) draws in the route's color right of its
    // direction (north, above the road), beside the way out travelled (gray,
    // south of it), never under it.
    const arrow = (await page.locator('.nav-mark').boundingBox())!;
    const x = arrow.x + arrow.width / 2 - 60,
      y = arrow.y + arrow.height / 2;
    // The traveler's mark (#280): a sea-green dot on the position.
    expect(await pixel(page, x + 60, y)).toEqual([0x0f, 0x7a, 0x6b]);
    await expect.poll(() => pixel(page, x, y - 6)).toEqual(ROUTE_COLOR);
    expect(await pixel(page, x, y + 6)).toEqual([0x87, 0x95, 0xa1]);
  });

  test('at the start of an out-and-back route, nothing is asked', async ({
    page,
    context,
  }) => {
    await context.setGeolocation({
      latitude: lat,
      longitude: lon(1),
      accuracy: 6,
    });
    await outAndBack(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-road')).toHaveText('Vista Chinesa');
    await expect(page.locator('#nav-pass')).toBeHidden();
  });

  for (const [width, height, language] of [
    [320, 568, 'pt'],
    [320, 568, 'en'],
    [430, 932, 'pt'],
    [568, 320, 'pt'],
    [568, 320, 'en'],
  ] as const)
    test(`the question of which way fits at ${width}x${height} in ${language} with long names`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await outAndBack(page, [
        longName,
        'Mirante Dona Marta, Estrada das Paineiras',
        longName,
      ]);
      await chooseUnits(page, { distance: 'imperial' });
      await page.locator('#language').selectOption(language);
      await page.locator('#navigate').click();
      await page.locator('#nav-notice-start').click();
      const options = page.locator('#nav-pass-options button');
      await expect(options).toHaveCount(2);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const banner = document
          .querySelector('.nav-banner')!
          .getBoundingClientRect();
        if (banner.bottom > innerHeight / 2 + 40) out.push('banner too tall');
        // One line on a phone held upright; the narrower card in landscape
        // may take two.
        const title = document.querySelector<HTMLElement>('.nav-pass-title')!;
        const lines =
          title.getBoundingClientRect().height /
          parseFloat(getComputedStyle(title).lineHeight);
        if (lines > (innerWidth > innerHeight ? 2.05 : 1.05))
          out.push('question wraps');
        for (const button of document.querySelectorAll<HTMLElement>(
          '#nav-pass-options button',
        )) {
          const box = button.getBoundingClientRect();
          if (box.right > banner.right + 0.5)
            out.push('option leaves the banner');
          if (box.height > 50) out.push(`option wraps: ${button.textContent}`);
          const left = button.querySelector<HTMLElement>('.nav-pass-left')!;
          if (
            left.scrollWidth > left.clientWidth + 1 ||
            left.getBoundingClientRect().right > box.right
          )
            out.push(`distance cut: ${left.textContent}`);
        }
        return out;
      });
      expect(problems).toEqual([]);
      expect(await coveredControls(page, '#nav-screen')).toEqual([]);
      expect(await overlapping(page, ['.nav-banner', MAP_OVERLAYS])).toEqual(
        [],
      );
    });

  for (const [width, language] of [
    [320, 'pt'],
    [390, 'en'],
  ] as const)
    test(`the banner and the itinerary name the sign at a maneuver at ${width} px in ${language} (#135)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      // A nameless fork with the sign's route number and destinations, then
      // a named road whose sign gives destinations only.
      await setup(page, undefined, [
        {
          name: 'Rua Uruguai',
          distance: 1000,
          duration: 70,
          maneuver: { type: 'depart', location: coords[0] },
        },
        {
          name: '',
          destinations:
            'RJ-071: Ilha do Governador, Aeroporto Internacional, Petrópolis, São Paulo',
          distance: 500,
          duration: 40,
          maneuver: {
            type: 'fork',
            modifier: 'slight right',
            location: coords[10],
          },
        },
        {
          name: longName,
          destinations: 'Aeroporto Internacional Tom Jobim, Ilha do Governador',
          distance: 600,
          duration: 40,
          maneuver: {
            type: 'continue',
            modifier: 'slight left',
            location: coords[15],
          },
        },
        {
          name: '',
          distance: 0,
          duration: 0,
          maneuver: { type: 'arrive', location: coords[20] },
        },
      ]);
      if (language === 'pt') await page.locator('#language').selectOption('pt');
      const toward = language === 'pt' ? 'em direção a' : 'toward';
      // The itinerary: the route number and first destination stand in for
      // the nameless road, and go on a third line under a named one.
      if (!(await page.locator('#itinerary').isVisible()))
        await page.locator('#panel-toggle').click();
      await page.locator('#itinerary summary').click();
      const rows = page.locator('#itinerary li');
      await expect(rows.nth(1).locator('.step-road')).toHaveText(
        `RJ-071 ${toward} Ilha do Governador`,
      );
      await expect(rows.nth(2).locator('.step-toward')).toHaveText(
        `${toward} Aeroporto Internacional Tom Jobim`,
      );
      await page.locator('#navigate').click();
      await page.locator('#nav-notice-start').click();
      const road = page.locator('#nav-road'),
        below = page.locator('#nav-toward');
      await expect(road.locator('.sign-route')).toHaveText('RJ-071');
      await expect(below).toHaveText(`${toward} Ilha do Governador`);
      expect(await fits(page)).toEqual([]);
      // Past the fork: the named road, its first destination below it, each
      // within two lines.
      await context.setGeolocation({ latitude: lat, longitude: lon(12) });
      await expect(road).toHaveText(longName);
      await expect(below).toHaveText(
        `${toward} Aeroporto Internacional Tom Jobim`,
      );
      for (const line of [road, below])
        expect(
          await line.evaluate(
            (e) =>
              e.getBoundingClientRect().height /
              parseFloat(getComputedStyle(e).lineHeight),
          ),
        ).toBeLessThanOrEqual(2.05);
      expect(await fits(page)).toEqual([]);
    });

  test('the bar opens a list of the turns and stops ahead', async ({
    page,
    context,
  }) => {
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    const handle = page.getByRole('button', { name: 'Upcoming turns' });
    const list = page.getByRole('list', { name: 'Upcoming turns' });
    await expect(list).toBeHidden();
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    // The stretch the traveler is on comes first, highlighted, with its
    // number among the route's stretches (#252).
    const current = list.locator('li[aria-current="step"]');
    await expect(current).toHaveText(/^Now · R\. UruguaiStep 1 of 3$/);
    await expect(current).toHaveCSS('border-left-width', '4px');
    const rows = list.locator('li:not([aria-current])');
    await expect(rows).toHaveCount(3);
    // Road names shortened as in the Itinerary; the full text in the title.
    await expect(rows.nth(0)).toContainText('Estr. das Furnas');
    await expect(rows.nth(0)).toHaveAttribute('title', /Estrada das Furnas/);
    await expect(rows.nth(1)).toHaveAttribute('title', /Estrada do Joá/);
    await expect(rows.nth(2)).toHaveClass(/nav-list-stop/);
    // Past the first turn, it leaves the list.
    await context.setGeolocation({ latitude: lat, longitude: lon(12) });
    await expect(rows).toHaveCount(2);
    await expect(current).toHaveText(/^Now · Estr\. das FurnasStep 2 of 3$/);
    await expect(rows.nth(0)).toHaveAttribute('title', /Estrada do Joá/);
    // Escape closes the list, not navigation; a second one ends it.
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(page.locator('#nav-screen')).toBeVisible();
    // The whole bar opens and closes it, not only its chevron.
    await page.locator('#nav-time').click();
    await expect(list).toBeVisible();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#nav-rest').click();
    await expect(list).toBeHidden();
    // A drag up on the bar opens it, a drag down closes it.
    const box = (await page.locator('#nav-time').boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 80);
    await page.mouse.up();
    await expect(list).toBeVisible();
    await page.mouse.move(x, y - 10);
    await page.mouse.down();
    await page.mouse.move(x, y + 60);
    await page.mouse.up();
    await expect(list).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-screen')).toBeHidden();
  });

  test('the banner and voice name an intermediate stop instead of Arrive', async ({
    page,
    context,
  }) => {
    const said = await recordSpeech(page);
    await setup(page);
    // Two legs: the first arrives at a stop on coords[10].
    await page.route('**/route/v1/driving/**', (r) =>
      r.fulfill({
        json: {
          code: 'Ok',
          waypoints: [coords[0], coords[10], coords[20]].map((location) => ({
            location,
            distance: 0,
          })),
          routes: [
            {
              distance: 2100,
              duration: 150,
              geometry: { coordinates: coords },
              legs: [
                {
                  steps: [
                    {
                      name: 'Rua Uruguai',
                      distance: 1050,
                      duration: 70,
                      maneuver: { type: 'depart', location: coords[0] },
                    },
                    {
                      name: '',
                      distance: 0,
                      duration: 0,
                      maneuver: { type: 'arrive', location: coords[10] },
                    },
                  ],
                },
                {
                  steps: [
                    {
                      name: 'Estrada do Joá',
                      distance: 1050,
                      duration: 80,
                      maneuver: { type: 'depart', location: coords[10] },
                    },
                    {
                      name: '',
                      distance: 0,
                      duration: 0,
                      maneuver: { type: 'arrive', location: coords[20] },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    await page.locator('#add').click();
    await page.locator('#location-1').fill(`${lat}, ${lon(10)}`);
    await page.locator('#location-1').press('Tab');
    await expect(page.locator('#navigate')).toBeEnabled({ timeout: 15000 });
    await page.locator('#navigate').click();
    await page.getByRole('checkbox', { name: 'Speak the directions' }).check();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-road')).toHaveText('Stop 1');
    // Near the stop, about 82 m before it (0.001° is 102 m here, read in
    // 10 m steps), the voice names it too.
    await context.setGeolocation({ latitude: lat, longitude: lon(9.2) });
    await expect(page.locator('#nav-distance')).toHaveText('80 m');
    await expect
      .poll(async () => (await said()).map(([text]) => text))
      .toContainEqual(expect.stringMatching(/, you reach Stop 1\.$/));
  });

  for (const [width, language] of [
    [320, 'pt'],
    [430, 'en'],
  ] as const)
    test(`the upcoming list fits at ${width}px in ${language} with long names`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await setup(page, longName);
      if (language === 'pt') await page.locator('#language').selectOption('pt');
      await page.locator('#navigate').click();
      await page.locator('#nav-notice-start').click();
      await page.locator('#nav-list-toggle').click();
      const list = page.locator('#nav-list');
      await expect(list.locator('li')).toHaveCount(4);
      const problems = await list.evaluate((ol) => {
        const out: string[] = [];
        const banner = document
          .querySelector('.nav-banner')
          ?.getBoundingClientRect();
        const box = ol.getBoundingClientRect();
        if (banner && box.top < banner.bottom) out.push('covers the banner');
        for (const li of ol.querySelectorAll('li')) {
          const r = li.getBoundingClientRect();
          if (r.right > innerWidth + 0.5) out.push('row leaves the screen');
          // The current stretch has two lines: the road and its number.
          const lines = li.matches('[aria-current]') ? 2 : 1;
          for (const line of li.querySelectorAll('.nav-list-text > span'))
            if (line.getBoundingClientRect().height > 30)
              out.push(`line wraps: ${line.textContent}`);
          if (r.height > 30 * lines + 30)
            out.push(`row wraps: ${li.textContent}`);
          const distance = li.querySelector('.nav-list-distance');
          if (distance && distance.scrollWidth > distance.clientWidth + 1)
            out.push('distance clipped');
        }
        return out;
      });
      expect(problems).toEqual([]);
    });

  /** Records what the page would speak instead of speaking it. */
  async function recordSpeech(page: Page) {
    // Speech follows the clock: on a fixed morning a real sunset is never
    // among what is said. The sunset test sets its own clock afterwards.
    await page.clock.setFixedTime(new Date(t0));
    await page.addInitScript(() => {
      const said: string[][] = [];
      (window as unknown as { said: string[][] }).said = said;
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          speak: (u: SpeechSynthesisUtterance) => said.push([u.text, u.lang]),
          cancel: () => undefined,
        },
      });
    });
    return () =>
      page.evaluate(() => (window as unknown as { said: string[][] }).said);
  }

  /**
   * The first fix (the context's position, about 410 m before the turn) has
   * reached navigation: the browser delivers it some time after the watch
   * starts, later under load, and a position set meanwhile would be the
   * first one seen instead. Only then may a test move on, since the far
   * announcement is said only for a turn first seen beyond 400 m.
   */
  const firstFix = (page: Page) =>
    // The marker needs the navigation map, slower to create under load.
    expect(page.locator('.nav-position')).toBeVisible({ timeout: 15000 });

  test('voice is off by default and, turned on, speaks the turns', async ({
    page,
    context,
  }) => {
    const said = await recordSpeech(page);
    await setup(page);
    await page.locator('#navigate').click();
    const voiceBox = page.getByRole('checkbox', {
      name: 'Speak the directions',
    });
    await expect(voiceBox).not.toBeChecked();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    expect(await said()).toEqual([]);
    await page.locator('#nav-stop').click();
    // On from the start notice: the start, then the turn as it comes near.
    await page.locator('#navigate').click();
    await voiceBox.check();
    await page.locator('#nav-notice-start').click();
    await expect.poll(said).toEqual([['Navigation started.', 'en']]);
    await firstFix(page);
    await context.setGeolocation({ latitude: lat, longitude: lon(9) });
    await expect
      .poll(async () => (await said()).at(-1)?.[0])
      .toBe('In 100 meters, turn right onto Estrada das Furnas.');
    // About 20 m before the turn.
    await context.setGeolocation({ latitude: lat, longitude: lon(9.8) });
    await expect
      .poll(async () => (await said()).at(-1)?.[0])
      .toBe('Turn right onto Estrada das Furnas now.');
    // The screen button turns it off; Settings shows the same choice.
    const button = page.locator('#nav-voice');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#nav-stop').click();
    await page.locator('#open-settings').click();
    await expect(page.locator('#voice-setting')).not.toBeChecked();
  });

  test('voice speaks Portuguese in Portuguese', async ({ page, context }) => {
    const said = await recordSpeech(page);
    await setup(page);
    await page.locator('#language').selectOption('pt');
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-voice').check();
    await page.locator('#nav-notice-start').click();
    await expect.poll(said).toEqual([['Navegação iniciada.', 'pt-BR']]);
    await firstFix(page);
    await context.setGeolocation({ latitude: lat, longitude: lon(9) });
    await expect
      .poll(async () => (await said()).at(-1))
      .toEqual([
        'Em 100 metros, vire à direita na Estrada das Furnas.',
        'pt-BR',
      ]);
  });

  test('the voice switch fits on the navigation screen at 320px in pt', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setup(page);
    await page.locator('#language').selectOption('pt');
    await page.locator('#navigate').click();
    const box = page.locator('#nav-notice-voice').locator('..');
    await expect(box).toContainText('Falar as instruções');
    const notice = await box.evaluate((e) => ({
      right: e.getBoundingClientRect().right,
      overflow: e.scrollWidth > e.clientWidth + 1,
    }));
    expect(notice.right).toBeLessThanOrEqual(320.5);
    expect(notice.overflow).toBe(false);
    await page.locator('#nav-notice-start').click();
    const button = page.locator('#nav-voice');
    await expect(button).toHaveAttribute('aria-label', 'Voz desligada');
    const b = await button.boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(320.5);
  });

  /** Starts navigation, then counts the routing requests after a reload. */
  async function navigateAndReload(page: Page) {
    await setup(page);
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    const requests = { routing: 0 };
    page.on('request', (r) => {
      if (r.url().includes('/route/v1/')) requests.routing++;
    });
    await page.reload();
    return requests;
  }

  test('a reload during navigation offers to continue on the same route', async ({
    page,
  }) => {
    const requests = await navigateAndReload(page);
    const prompt = page.getByRole('dialog', { name: 'Continue navigation?' });
    await expect(prompt).toBeVisible();
    // Location waits for the tap; the route is the one kept, not recalculated.
    await expect(page.locator('#nav-screen')).toBeHidden();
    await prompt.getByRole('button', { name: 'Continue navigation' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Navigation' }),
    ).toBeVisible();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    expect(requests.routing).toBe(0);
  });

  test('after End or Not now, a reload offers nothing', async ({ page }) => {
    await navigateAndReload(page);
    const prompt = page.getByRole('dialog', { name: 'Continue navigation?' });
    await prompt.getByRole('button', { name: 'Not now' }).click();
    await expect(prompt).toBeHidden();
    await page.reload();
    await expect(page.locator('#navigate')).toBeEnabled({ timeout: 15000 });
    await expect(prompt).toBeHidden();
    // End clears it too.
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    await page.locator('#nav-stop').click();
    await page.reload();
    await expect(page.locator('#navigate')).toBeEnabled({ timeout: 15000 });
    await expect(prompt).toBeHidden();
  });

  for (const [width, language] of [
    [320, 'pt'],
    [430, 'en'],
  ] as const)
    test(`the continue prompt fits at ${width}px in ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await navigateAndReload(page);
      if (language === 'pt') await page.locator('#language').selectOption('pt');
      const prompt = page.locator('#nav-resume-notice');
      await expect(prompt).toBeVisible();
      await expect(prompt.locator('h2')).toHaveText(
        language === 'pt' ? 'Continuar a navegação?' : 'Continue navigation?',
      );
      const problems = await prompt.evaluate((dialog) =>
        [...dialog.querySelectorAll<HTMLElement>('h2, p, button')].flatMap(
          (e) => {
            const box = e.getBoundingClientRect();
            return box.right > innerWidth + 0.5 ||
              box.left < -0.5 ||
              e.scrollWidth > e.clientWidth + 1
              ? [e.textContent]
              : [];
          },
        ),
      );
      expect(problems).toEqual([]);
      // Each button stays on one line.
      for (const button of await prompt.locator('button').all()) {
        const lines = await button.evaluate(
          (e) =>
            e.getBoundingClientRect().height /
            parseFloat(getComputedStyle(e).lineHeight || '24'),
        );
        expect(lines).toBeLessThan(2.5);
      }
    });
});

test('a denied location permission ends navigation with a message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('#navigate').click();
  await page.locator('#nav-notice-start').click();
  await expect(page.locator('#nav-screen')).toBeHidden();
  await expect(page.locator('#status')).toContainText(
    'Location permission denied',
  );
});

test('wide screens keep Download GPX as the main action', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await expect(page.locator('#navigate')).toBeHidden();
  await expect(page.locator('#download')).toHaveClass(/primary/);
  await expect(page.locator('#download')).toContainText('Download GPX');
});

test.describe('replay on the navigation screen', () => {
  // No location permission: replay never asks for it.
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('replays the route with its maneuvers and no location or routing', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { watched: number };
      w.watched = 0;
      navigator.geolocation.watchPosition = () => {
        w.watched++;
        return 0;
      };
    });
    await setup(page);
    let routing = 0;
    page.on('request', (r) => {
      if (/\/route\/v1\/|valhalla/.test(r.url())) routing++;
    });
    // Travel the route opens like the other summary rows, with a note and
    // a button to simulate navigation.
    await page.locator('#travel-details > summary').click();
    const travel = page.locator('#travel-route');
    await expect(travel).toHaveText('Simulate navigation');
    await travel.click();
    const screen = page.getByRole('dialog', { name: 'Navigation' });
    await expect(screen).toBeVisible();
    // It opens paused at the start.
    await expect(page.locator('#nav-replay-position')).toHaveValue('0');
    await expect(screen.getByRole('button', { name: 'Play' })).toBeVisible();
    await page.locator('#nav-replay-position').fill('300');
    await expect(page.locator('#nav-notice')).toBeHidden();
    // No label over the map (#252): the slider says the trip's clock and
    // the distance to screen readers.
    await expect(page.locator('#nav-replay-chip')).toHaveCount(0);
    await expect(page.locator('#nav-replay-position')).toHaveAttribute(
      'aria-valuetext',
      /^\d\d:\d\d( [AP]M)? · \S+\s(km|m) of \S+\s(km|m)$/,
    );
    // It opens further out than live navigation, following without Re-center.
    await expect(page.locator('#nav-resume')).toBeHidden();
    // No waiting for GPS in a replay; the list's handle shows (#207).
    await expect(page.locator('#nav-waiting')).toBeHidden();
    await expect(page.locator('#nav-list-toggle')).toBeVisible();
    // About 610 m along (30 % of 2 km): the right turn at 1 km comes next.
    await expect(page.locator('#nav-road')).toHaveText('Estrada das Furnas');
    await expect(page.locator('#nav-distance')).toHaveText('400 m');
    const position = page.locator('#nav-replay-position');
    await position.fill('600');
    await expect(page.locator('#nav-road')).toHaveText('Estrada do Joá');
    // Played to the end at 10×, the destination is reached.
    await expect(page.locator('#nav-replay-rate')).toHaveValue('1');
    await page.locator('#nav-replay-rate').selectOption('10');
    const play = screen.getByRole('button', { name: 'Play' });
    await play.click();
    await expect(page.locator('#nav-road')).toHaveText('You have arrived', {
      timeout: 10000,
    });
    await expect(play).toBeVisible();
    expect(await fits(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { watched: number }).watched,
      ),
    ).toBe(0);
    expect(routing).toBe(0);
    // Replayed to the end, it begins again at the start.
    await page.getByRole('button', { name: 'End navigation' }).click();
    await expect(screen).toBeHidden();
    await expect(travel).toBeFocused();
    await travel.click();
    await expect(page.locator('#nav-replay-position')).toHaveValue('0');
    // Left halfway, it begins at the start again too.
    await page.locator('#nav-replay-position').fill('450');
    await page.getByRole('button', { name: 'End navigation' }).click();
    await expect(travel).toHaveText('Simulate navigation');
    await travel.click();
    await expect(page.locator('#nav-replay-position')).toHaveValue('0');
  });

  for (const [width, language] of [
    [320, 'pt'],
    [320, 'en'],
    [1280, 'pt'],
  ] as const)
    test(`the replay controls fit at ${width} px in ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width > 1000 ? 800 : 640 });
      await setup(page);
      await page.locator('#language').selectOption(language);
      await page.locator('#travel-details > summary').click();
      // The button's label stays on one line inside it.
      const label = page.locator('#travel-route');
      await expect(label).toHaveText(
        language === 'pt' ? 'Simular navegação' : 'Simulate navigation',
      );
      expect(
        await label.evaluate(
          (e) =>
            e.scrollWidth <= e.clientWidth &&
            e.getBoundingClientRect().height < 60,
        ),
      ).toBe(true);
      await label.click();
      await expect(page.locator('#nav-replay')).toBeVisible();
      await page.locator('#nav-replay-position').fill('400');
      expect(await fits(page)).toEqual([]);
    });
});

for (const [width, height] of LANDSCAPE)
  test(`a replay in landscape has the same cards as navigation at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, longName);
    // A drawn map, to see it follow the screen as it turns.
    await page.route('**/styles/**', (r) => r.fulfill({ json: BASEMAP_STYLE }));
    await page.locator('#language').selectOption('pt');
    await page.locator('#travel-details > summary').click();
    await page.locator('#travel-route').click();
    await expect(page.locator('#nav-map canvas')).toBeVisible();
    await page.setViewportSize({ width, height });
    await page.locator('#nav-replay-position').fill('300');
    await expect(page.locator('#nav-road')).toHaveText(longName);
    // No phone frame: the replay fills the window like navigation.
    await expect.poll(() => landscapeProblems(page)).toEqual([]);
    expect(await fits(page)).toEqual([]);
    // The replay's controls are in the bottom card, below the time.
    const time = (await page.locator('#nav-time').boundingBox())!,
      controls = (await page.locator('#nav-replay').boundingBox())!,
      card = (await page.locator('.nav-bar').boundingBox())!;
    expect(controls.y).toBeGreaterThanOrEqual(time.y + time.height - 0.5);
    expect(controls.x).toBeGreaterThanOrEqual(card.x - 0.5);
    expect(controls.x + controls.width).toBeLessThanOrEqual(
      card.x + card.width + 0.5,
    );
  });

test('a playing replay turns the map smoothly on a road with small bends', async ({
  page,
}) => {
  // A point every 15 m, alternating 3 m to either side, like a real road.
  const bends = Array.from({ length: 300 }, (_, i) => [
    lon(0) + i * 0.000146,
    lat + (i % 2 ? 0.000027 : -0.000027),
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.route('**/route/v1/driving/**', (r) =>
    r.fulfill({
      json: {
        code: 'Ok',
        waypoints: [bends[0], bends[299]].map((location) => ({
          location,
          distance: 0,
        })),
        routes: [
          {
            distance: 4500,
            duration: 300,
            geometry: { coordinates: bends },
            legs: [
              {
                steps: [
                  {
                    name: 'Rua Sinuosa',
                    distance: 4500,
                    duration: 300,
                    maneuver: { type: 'depart', location: bends[0] },
                  },
                  {
                    name: '',
                    distance: 0,
                    duration: 0,
                    maneuver: { type: 'arrive', location: bends[299] },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto(base);
  await page.locator('#language').selectOption('en');
  await page.locator('#location-0').fill(`${bends[0][1]}, ${bends[0][0]}`);
  await page.locator('#location-0').press('Tab');
  await page.locator('#location-1').fill(`${bends[299][1]}, ${bends[299][0]}`);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await page.locator('#travel-details > summary').click();
  await page.locator('#travel-route').click();
  await page
    .getByRole('dialog', { name: 'Navigation' })
    .getByRole('button', { name: 'Play' })
    .click();
  // The map's turn, read from the compass needle on every frame for 2 s.
  const turns = await page.evaluate(
    () =>
      new Promise<number[]>((done) => {
        const angles: number[] = [];
        const begin = performance.now();
        const read = (time: number) => {
          const needle = document.querySelector<HTMLElement>(
            '#nav-compass-button svg',
          )!;
          const turn = /rotate\((-?[\d.]+)deg\)/.exec(needle.style.transform);
          angles.push(turn ? Number(turn[1]) : 0);
          if (time - begin < 2000) requestAnimationFrame(read);
          else done(angles.slice(1).map((a, i) => Math.abs(a - angles[i])));
        };
        requestAnimationFrame(read);
      }),
  );
  // Without smoothing it swung up to 9° a frame (4° on average).
  expect(Math.max(...turns)).toBeLessThan(2);
});

/**
 * Replays `path` (GeoJSON order) from 30 % at 1× and returns, for each frame,
 * the position (of 1000), the arrow's turn and the map's turn on screen.
 */
async function replayTurns(page: Page, path: number[][]) {
  const last = path.length - 1;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.route('**/route/v1/driving/**', (r) =>
    r.fulfill({
      json: {
        code: 'Ok',
        waypoints: [path[0], path[last]].map((location) => ({
          location,
          distance: 0,
        })),
        routes: [
          {
            distance: 2000,
            duration: 120,
            geometry: { coordinates: path },
            legs: [
              {
                steps: [
                  {
                    name: 'Rua Curva',
                    distance: 2000,
                    duration: 120,
                    maneuver: { type: 'depart', location: path[0] },
                  },
                  {
                    name: '',
                    distance: 0,
                    duration: 0,
                    maneuver: { type: 'arrive', location: path[last] },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto(base);
  await page.locator('#language').selectOption('en');
  await page.locator('#location-0').fill(`${path[0][1]}, ${path[0][0]}`);
  await page.locator('#location-0').press('Tab');
  await page.locator('#location-1').fill(`${path[last][1]}, ${path[last][0]}`);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
  await page.locator('#travel-details > summary').click();
  await page.locator('#travel-route').click();
  await page.locator('#nav-replay-position').fill('300');
  await page
    .getByRole('dialog', { name: 'Navigation' })
    .getByRole('button', { name: 'Play' })
    .click();
  return page.evaluate(
    () =>
      new Promise<number[][]>((done) => {
        const out: number[][] = [];
        const turn = (selector: string) =>
          Number(
            /rotate\((-?[\d.]+)deg\)/.exec(
              document.querySelector<HTMLElement>(selector)?.style.transform ??
                '',
            )?.[1] ?? 0,
          );
        const begin = performance.now();
        const read = (time: number) => {
          const at = Number(
            document.querySelector<HTMLInputElement>('#nav-replay-position')!
              .value,
          );
          out.push([at, turn('.nav-mark'), turn('#nav-compass-button svg')]);
          if (time - begin < 3500 && at < 950) requestAnimationFrame(read);
          else done(out);
        };
        requestAnimationFrame(read);
      }),
  );
}
/** Degrees between two directions, 0–180. */
const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test('a playing replay keeps the arrow along the road through a turn', async ({
  page,
}) => {
  // 1 km east, then 1 km south, a point every 15 m.
  const east = Array.from({ length: 68 }, (_, i) => [
    lon(0) + i * 0.000146,
    lat,
  ]);
  const corner = east[67];
  const south = Array.from({ length: 67 }, (_, i) => [
    corner[0],
    lat - (i + 1) * 0.000135,
  ]);
  const samples = await replayTurns(page, [...east, ...south]);
  // The road on screen points its bearing turned with the map; the arrow
  // points the same way, away from the corner (at 500 of 1000).
  const errors = samples
    .filter(([at]) => Math.abs(at - 500) > 40)
    .map(([at, arrow, map]) => apart(arrow, (at < 500 ? 90 : 180) + map));
  expect(errors.length).toBeGreaterThan(10);
  // It was 49° off after the turn while the map caught up.
  expect(Math.max(...errors)).toBeLessThan(10);
});

test('a playing replay keeps the arrow along the road on a curve', async ({
  page,
}) => {
  // Three quarters of a circle of 150 m, clockwise from heading east, a
  // point every 5°: the road's direction changes all along it.
  const radius = 150,
    perLat = 111_320,
    perLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const arc = Array.from({ length: 55 }, (_, i) => {
    const angle = (i * 5 * Math.PI) / 180;
    return [
      lon(0) + (radius * Math.sin(angle)) / perLon,
      lat + (radius * Math.cos(angle)) / perLat,
    ];
  });
  const total = radius * ((270 * Math.PI) / 180);
  const samples = await replayTurns(page, arc);
  const errors = samples.map(([at, arrow, map]) => {
    const tangent = 90 + ((at / 1000) * total * 180) / (radius * Math.PI);
    return apart(arrow, tangent + map);
  });
  expect(errors.length).toBeGreaterThan(10);
  // A 5° segment is at most 2.5° from the circle's tangent.
  expect(Math.max(...errors)).toBeLessThan(5);
});

test('a playing replay greys the road right behind the arrow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('#travel-details > summary').click();
  await page.locator('#travel-route').click();
  await page.locator('#nav-replay-position').fill('100');
  await page
    .getByRole('dialog', { name: 'Navigation' })
    .getByRole('button', { name: 'Play' })
    .click();
  /** The color on screen at a point, as [red, green, blue]. */
  const colorAt = async (x: number, y: number) => {
    const shot = await page.screenshot({
      clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
    });
    return page.evaluate(async (png) => {
      // Built from the bytes: the page's policy refuses fetching data: URLs.
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const canvas = new OffscreenCanvas(1, 1);
      const context = canvas.getContext('2d')!;
      context.drawImage(await createImageBitmap(blob), 0, 0);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    }, shot.toString('base64'));
  };
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(250);
    const arrow = (await page.locator('.nav-mark').boundingBox())!;
    const x = arrow.x + arrow.width / 2;
    // Just below the arrow's circle: grey (travelled), never the route's
    // green still waiting to be redrawn.
    const [red, green] = await colorAt(x, arrow.y + arrow.height + 6);
    expect(green - red).toBeLessThan(30);
    // Just above it, short of the destination: still green, the grey
    // never runs ahead of the arrow.
    const at = Number(await page.locator('#nav-replay-position').inputValue());
    if (at > 900) break;
    const [redAhead, greenAhead] = await colorAt(x, arrow.y - 6);
    expect(greenAhead - redAhead).toBeGreaterThan(30);
  }
});

test.describe('replay going back', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('dragging back or playing again follows the replay, not the furthest point', async ({
    page,
  }) => {
    await setup(page);
    await page.locator('#travel-details > summary').click();
    await page.locator('#travel-route').click();
    const road = page.locator('#nav-road'),
      position = page.locator('#nav-replay-position');
    await position.fill('600');
    await expect(road).toHaveText('Estrada do Joá');
    // Dragged back before the right turn at 1 km, it comes next again.
    await position.fill('200');
    await expect(road).toHaveText('Estrada das Furnas');
    await expect(page.locator('#nav-distance')).toHaveText('600 m');
    // At the end (as after the replay ran on in the background), play
    // begins again from the start.
    await position.fill('1000');
    await expect(road).toHaveText('You have arrived');
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('button', { name: 'Play' })
      .click();
    await expect(road).toHaveText('Estrada das Furnas');
  });

  test('on a road used both ways, going back keeps the outbound pass', async ({
    page,
  }) => {
    // 1 km east and back west on the same road, a point every 100 m.
    const east = Array.from({ length: 11 }, (_, i) => [lon(i), lat]);
    const path = [...east, ...east.slice(0, -1).reverse()];
    const last = path.length - 1;
    await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
    await page.route('**/route/v1/driving/**', (r) =>
      r.fulfill({
        json: {
          code: 'Ok',
          waypoints: [path[0], path[last]].map((location) => ({
            location,
            distance: 0,
          })),
          routes: [
            {
              distance: 2050,
              duration: 150,
              geometry: { coordinates: path },
              legs: [
                {
                  steps: [
                    {
                      name: 'Rua de Ida',
                      distance: 1025,
                      duration: 75,
                      maneuver: { type: 'depart', location: path[0] },
                    },
                    {
                      name: 'Rua de Volta',
                      distance: 1025,
                      duration: 75,
                      maneuver: {
                        type: 'turn',
                        modifier: 'uturn',
                        location: path[10],
                      },
                    },
                    {
                      name: '',
                      distance: 0,
                      duration: 0,
                      maneuver: { type: 'arrive', location: path[last] },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    await page.goto(base);
    await page.locator('#language').selectOption('en');
    await page.locator('#location-0').fill(`${lat}, ${lon(0)}`);
    await page.locator('#location-0').press('Tab');
    await page.locator('#location-1').fill(`${lat}, ${lon(0) + 0.0001}`);
    await page.locator('#location-1').press('Tab');
    await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
    await page.locator('#travel-details > summary').click();
    await page.locator('#travel-route').click();
    const road = page.locator('#nav-road'),
      position = page.locator('#nav-replay-position');
    const rest = page.locator('#nav-rest');
    // On the way back, 300 m from the start: 0.3 km left.
    await position.fill('850');
    await expect(rest).toContainText(/^0\.3\skm/);
    // Dragged back to the way out at the same place: 1.7 km left, with the
    // U-turn ahead.
    await position.fill('150');
    await expect(rest).toContainText(/^1\.7\skm/);
    await expect(road).toHaveText('Rua de Volta');
  });
});

test.describe('speed while navigating', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ['geolocation'],
  });
  /** Navigation with fixes the test sends itself, on a fixed clock. */
  async function navigateWithFixes(
    page: Page,
    before: () => Promise<void> = async () => {},
  ) {
    await ownFixes(page);
    await setup(page);
    await before();
    await page.locator('#navigate').click();
    await page.locator('#nav-notice-start').click();
    await expect(page.locator('#nav-screen')).toBeVisible();
  }
  /** One fix `meters` along the route (0.001° is about 102 m), at `time`. */
  const fix = (
    page: Page,
    meters: number,
    speed: number | null,
    time: number,
    accuracy = 5,
  ) => sendFix(page, [lat, lon(meters / 102.4)], time, speed, accuracy);

  test('shows the current speed, 0 when stopped and none with a weak signal', async ({
    page,
  }) => {
    await navigateWithFixes(page);
    // Before the first fix, a chip says the GPS is awaited; the bar does not.
    await expect(page.locator('#nav-waiting')).toBeVisible();
    await expect(page.locator('.nav-bar')).not.toContainText('GPS');
    const badge = page.locator('#nav-speed');
    await fix(page, 100, 5, t0 + 1000);
    await expect(page.locator('#nav-waiting')).toBeHidden();
    await expect(badge).toBeVisible();
    // 5 m/s is 18 km/h.
    await expect(page.locator('#nav-speed-value')).toHaveText('18');
    await expect(page.locator('#nav-speed-unit')).toHaveText('km/h');
    await fix(page, 101, 0, t0 + 2000);
    await expect(page.locator('#nav-speed-value')).toHaveText('0');
    await fix(page, 101, 0, t0 + 3000, 80);
    await expect(badge).toBeHidden();
  });

  test('the arrival follows the trip average, stops included', async ({
    page,
  }) => {
    await navigateWithFixes(page);
    // At first, the configured 20 km/h: 1.95 km left takes 6 min.
    await fix(page, 100, 3, t0 + 1000);
    await expect(page.locator('#nav-time')).toHaveText('6 min');
    // Ten minutes covering 600 m with stops: 1 m/s (3.6 km/h) on average,
    // though moving at 3 m/s; the remaining 1.35 km takes about 22 min.
    for (let s = 30; s <= 600; s += 30)
      await fix(page, 100 + s, 3, t0 + 1000 + s * 1000);
    await expect(page.locator('#nav-time')).toHaveText(/^2[0-4]\smin$/);
  });

  for (const [width, language] of [
    [320, 'pt'],
    [320, 'en'],
  ] as const)
    for (const units of ['metric', 'imperial'] as const)
      test(`the badge fits three digits at ${width} px in ${language}, ${units}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 640 });
        await navigateWithFixes(page, async () => {
          await chooseUnits(page, { distance: units });
          await page.locator('#language').selectOption(language);
        });
        await fix(page, 100, 50, t0 + 1000);
        // 50 m/s is 180 km/h or 112 mph.
        await expect(page.locator('#nav-speed-value')).toHaveText(
          units === 'metric' ? '180' : '112',
        );
        await expect(page.locator('#nav-speed-unit')).toHaveText(
          units === 'metric' ? 'km/h' : 'mph',
        );
        expect(
          await page.locator('#nav-speed').evaluate((e) => {
            const box = e.getBoundingClientRect();
            const value = e.querySelector('.nav-speed-value')!;
            return (
              value.getBoundingClientRect().width <= box.width - 8 &&
              box.left >= 0 &&
              box.right <= innerWidth
            );
          }),
        ).toBe(true);
        expect(await fits(page)).toEqual([]);
      });

  test('a replay shows its own speed and the trip clock', async ({ page }) => {
    await setup(page);
    await page.locator('#travel-details > summary').click();
    await page.locator('#travel-route').click();
    // Paused: standing still.
    await expect(page.locator('#nav-speed-value')).toHaveText('0');
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('button', { name: 'Play' })
      .click();
    await expect(page.locator('#nav-speed-value')).toHaveText('20');
    // The trip's clock moves with the replay, read out with the position.
    const clock = () =>
      page
        .locator('#nav-replay-position')
        .getAttribute('aria-valuetext')
        .then((text) => text?.slice(0, 5));
    const first = await clock();
    expect(first).toMatch(/^\d\d:\d\d$/);
    await page.locator('#nav-replay-position').fill('900');
    await expect.poll(clock).not.toBe(first);
  });
});
