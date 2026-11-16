import { test, expect, type Page } from '@playwright/test';
import { mapIdle, mapReady, mockBasemap } from './map-helpers';
import { defaults, encodeState, decodeState } from '../src/core';
import { base, mockOsrm } from './app-helpers';
const ipUrl = 'https://ipwho.is/**';
const position = { latitude: 48.1234567, longitude: 11.7654321, accuracy: 35 };
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.fulfill({ status: 204 }));

  await mockBasemap(page);
  await page.route(ipUrl, (r) =>
    r.fulfill({
      json: { success: true, city: 'Paris', latitude: 48.85, longitude: 2.35 },
    }),
  );
});
async function locate(page: Page) {
  await page.locator('#locate').click();
  await expect(page.locator('#confirm-location')).toHaveCount(0);
}
async function noExactStorage(page: Page) {
  const content = await page.evaluate(async () => {
    const records: unknown[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(info.name!);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const name of db.objectStoreNames) {
        const rows = await new Promise((resolve, reject) => {
          const req = db.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        records.push(rows);
      }
      db.close();
    }
    return JSON.stringify({
      hash: location.hash,
      local: { ...localStorage },
      session: { ...sessionStorage },
      records,
    });
  });
  expect(content).not.toContain(String(position.latitude));
  expect(content).not.toContain(String(position.longitude));
  if (new URL(page.url()).hash) {
    const controls = JSON.stringify(decodeState(new URL(page.url()).hash));
    expect(controls).not.toContain(String(position.latitude));
    expect(controls).not.toContain(String(position.longitude));
  }
}
test('granted GPS centers the marker and accuracy circle without storing or transmitting exact coordinates', async ({
  page,
  context,
}) => {
  await mockOsrm(page, { distance: 1000, duration: 100 });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(position);
  let ipRequests = 0;
  const sent: string[] = [];
  page.on('request', (r) => {
    sent.push(r.url() + (r.postData() ?? ''));
    if (r.url().includes('ipwho.is')) ipRequests++;
  });
  await page.goto(base);
  await locate(page);
  await expect(page.locator('.location-accuracy')).toHaveCount(1);
  await expect(page.locator('.location-dot')).toHaveCount(1);
  const box = await page.locator('#map').boundingBox();
  const dot = await page.locator('.location-dot').boundingBox();
  expect(
    Math.abs(dot!.x + dot!.width / 2 - box!.x - box!.width / 2),
  ).toBeLessThan(3);
  expect(
    Math.abs(dot!.y + dot!.height / 2 - box!.y - box!.height / 2),
  ).toBeLessThan(3);
  await expect(page.locator('#location-0')).toHaveValue('');
  await expect(page.locator('#locate')).toHaveClass(/following/);
  expect(ipRequests).toBe(0);
  await noExactStorage(page);
  // The dot follows the device and the map follows the dot.
  await context.setGeolocation({ ...position, latitude: 48.1244567 });
  await expect
    .poll(async () => {
      const moved = (await page.locator('.location-dot').boundingBox())!;
      return Math.abs(moved.y + moved.height / 2 - box!.y - box!.height / 2);
    })
    .toBeLessThan(3);
  await noExactStorage(page);
  await page.locator('#location-0').fill('48.123, 11.765');
  await page.locator('#location-0').press('Tab');
  await page.locator('#location-1').fill('48.2, 11.8');
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#route-name').fill('GPS approximate start');
  await page.locator('#save-route').click();
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  await noExactStorage(page);
  expect(sent.join('\n')).not.toContain(String(position.latitude));
  expect(sent.join('\n')).not.toContain(String(position.longitude));
});
test('denial is actionable and points remain editable without automatic re-prompts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, 'watchPosition', {
      value: (_ok: unknown, fail: PositionErrorCallback) => {
        fail({ code: 1 } as GeolocationPositionError);
        return 1;
      },
    });
  });
  await page.goto(base);
  await locate(page);
  await expect(page.locator('#location-notice')).toContainText(
    'browser site settings',
  );
  await expect(page.locator('#locate')).not.toHaveClass(/following/);
  await expect(page.locator('.location-dot')).toHaveCount(0);
  await page.locator('#location-0').fill('40, 10');
  await page.locator('#location-0').press('Tab');
  await expect(page.locator('.route-marker')).toHaveCount(1);
});
test('startup never calls geolocation while permission is prompt', async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const name of ['getCurrentPosition', 'watchPosition'])
      Object.defineProperty(navigator.geolocation, name, {
        value: () => {
          document.documentElement.dataset.gpsCalls = 'unexpected';
        },
      });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#location-notice')).toBeHidden();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  await expect(page.locator('html')).not.toHaveAttribute('data-gps-calls');
});
test('URL route is fitted and skips GPS permissions and IP', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(position);
  await page.addInitScript(() => {
    navigator.permissions.query = () => {
      throw new Error('Unexpected permission lookup');
    };
  });
  let ip = 0;
  page.on('request', (r) => {
    if (r.url().includes('ipwho.is')) ip++;
  });
  await page.route('**/route/v1/driving/**', (r) => r.abort());
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22, -43] },
    { name: 'End', coord: [-23, -44] },
  ];
  await page.goto(base + encodeState(state));
  await expect(page.locator('.route-marker')).toHaveCount(2);
  const mapBox = await page.locator('#map').boundingBox();
  for (const marker of await page.locator('.route-marker').all()) {
    const box = await marker.boundingBox();
    expect(box!.x).toBeGreaterThan(mapBox!.x);
    expect(box!.x).toBeLessThan(mapBox!.x + mapBox!.width);
  }
  expect(ip).toBe(0);
});
for (const mode of [
  'success',
  'failure',
  'invalid',
  'timeout',
  'disabled',
] as const) {
  test(`IP startup: ${mode}`, async ({ page }) => {
    let requests = 0;
    const tiles: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('tiles.openfreemap.org/planet/'))
        tiles.push(r.url());
    });
    if (mode === 'disabled')
      await page.addInitScript(() =>
        localStorage.setItem('detect-region', 'false'),
      );
    await page.route(ipUrl, async (r) => {
      requests++;
      if (mode === 'timeout') {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        await r.abort();
      } else if (mode === 'failure') await r.fulfill({ status: 429 });
      else
        await r.fulfill({
          json:
            mode === 'invalid'
              ? { success: true, city: 'X', latitude: 500, longitude: 2 }
              : {
                  success: true,
                  city: 'Paris',
                  latitude: 48.85,
                  longitude: 2.35,
                },
        });
    });
    await page.goto(base);
    await page.waitForTimeout(mode === 'timeout' ? 3800 : 350);
    expect(requests).toBe(mode === 'disabled' ? 0 : 1);
    // Zoom 10 in Leaflet is zoom 9 of the 512 px vector tiles.
    await expect
      .poll(() => tiles.some((url) => url.includes('/planet/9/')))
      .toBe(mode === 'success');
    await expect(page.locator('#location-notice')).toBeHidden();
    await expect(page.locator('#status')).not.toHaveClass('error');
    await page.reload();
    await page.waitForTimeout(100);
    expect(requests).toBe(mode === 'disabled' ? 0 : 1);
  });
}
for (const mobile of [false, true]) {
  test(`viewport map and panel, fullscreen fallback, translations: ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(base);
    const mapBox = await page.locator('#map').boundingBox();
    expect(mapBox!.height).toBe(page.viewportSize()!.height);
    expect(mapBox!.width).toBeGreaterThan(page.viewportSize()!.width * 0.65);
    await page.locator('#panel-toggle').click();
    await expect(page.locator('#route-panel')).toBeHidden();
    await page.reload();
    await expect(page.locator('#route-panel')).toBeHidden();
    await page.locator('#panel-toggle').click();
    await expect(page.locator('#route-panel')).toBeVisible();
    await page.setViewportSize(
      mobile ? { width: 844, height: 390 } : { width: 1400, height: 800 },
    );
    await expect
      .poll(async () => (await page.locator('#map').boundingBox())!.height)
      .toBe(page.viewportSize()!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // The vector map covers the resized map, including after hiding the panel.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const map = document.getElementById('map')!.getBoundingClientRect();
          const canvas = document
            .querySelector('#map canvas.maplibregl-canvas')
            ?.getBoundingClientRect();
          return (
            !!canvas &&
            canvas.left <= map.left + 1 &&
            canvas.right >= map.right - 1 &&
            canvas.top <= map.top + 1 &&
            canvas.bottom >= map.bottom - 1
          );
        }),
      )
      .toBe(true);
    await page.locator('#fullscreen').click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await page.locator('#fullscreen').click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    await page.evaluate(() => {
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
        value: undefined,
      });
    });
    await page.locator('#fullscreen').click();
    await expect(page.locator('body')).toHaveClass(/map-fullscreen/);
    expect((await page.locator('#map').boundingBox())!.width).toBe(
      page.viewportSize()!.width,
    );
    await page.locator('#fullscreen').click();
    await page.locator('#language').selectOption('pt');
    await expect(page.locator('#locate')).toHaveAccessibleName(
      'Usar minha localização',
    );
    await page.locator('#language').selectOption('en');
    await expect(page.locator('#locate')).toHaveAccessibleName(
      'Use my location',
    );
    const zoom = await page.locator('.map-zoom-in').boundingBox();
    expect(zoom!.width).toBeGreaterThanOrEqual(44);
    expect(zoom!.height).toBeGreaterThanOrEqual(44);
  });
}

for (const code of [2, 3]) {
  test(`GPS error ${code} offers a map alternative`, async ({ page }) => {
    await page.addInitScript((code) => {
      Object.defineProperty(navigator.geolocation, 'watchPosition', {
        value: (_ok: unknown, fail: PositionErrorCallback) => {
          fail({ code } as GeolocationPositionError);
          return 1;
        },
      });
    }, code);
    await page.goto(base);
    await locate(page);
    await expect(page.locator('#location-notice')).toContainText(
      code === 3 ? 'timed out' : 'unavailable',
    );
    await expect(page.locator('#location-notice')).toContainText(
      'point on the map',
    );
  });
}
test('unsupported browser explains map alternative', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'geolocation', { value: undefined }),
  );
  await page.goto(base);
  await locate(page);
  await expect(page.locator('#location-notice')).toContainText(
    'does not support location',
  );
});
test('late IP result cannot override a manually chosen map view', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(ipUrl, async (r) => {
    await pending;
    await r.fulfill({
      json: { success: true, city: 'Paris', latitude: 48.85, longitude: 2.35 },
    });
  });
  await page.goto(base);
  await mapReady(page);
  await page.locator('#map').click({ position: { x: 170, y: 200 } });
  const value = await page.locator('#location-0').inputValue();
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#location-0')).toHaveValue(value);
  await expect(page.locator('.route-marker')).toHaveCount(1);
});

test('insecure context explains HTTPS requirement', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'isSecureContext', { value: false }),
  );
  await page.goto(base);
  await locate(page);
  await expect(page.locator('#location-notice')).toContainText(
    'requires HTTPS',
  );
});
test('IP detection can be disabled in Settings and stays disabled after reload', async ({
  page,
}) => {
  await page.goto(base);
  await page.locator('#open-settings').click();
  await page.locator('#detect-region').uncheck();
  await page.evaluate(() => sessionStorage.removeItem('region-attempted'));
  let calls = 0;
  page.on('request', (r) => {
    if (r.url().includes('ipwho.is')) calls++;
  });
  await page.reload();
  await page.locator('#open-settings').click();
  await expect(page.locator('#detect-region')).not.toBeChecked();
  await page.waitForTimeout(200);
  expect(calls).toBe(0);
});

test('mobile route endpoints fit above the open sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/route/v1/driving/**', (r) => r.abort());
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22.93, -43.23] },
    { name: 'End', coord: [-23.05, -43.53] },
  ];
  await page.goto(base + encodeState(state));
  await expect(page.locator('.route-marker')).toHaveCount(2);
  const sheet = await page.locator('#route-panel').boundingBox();
  for (const marker of await page.locator('.route-marker').all()) {
    const box = await marker.boundingBox();
    expect(box!.y).toBeGreaterThan(100);
    expect(box!.y + box!.height).toBeLessThan(sheet!.y);
  }
});

test('the dot follows, and the button re-centers a panned map without ever turning location off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const w = window as unknown as {
      fix: (lat: number, lon: number, accuracy: number) => void;
      watches: number;
      cleared: number;
    };
    let callback: PositionCallback | null = null;
    w.watches = 0;
    w.cleared = 0;
    w.fix = (latitude, longitude, accuracy) =>
      callback?.({
        coords: { latitude, longitude, accuracy },
        timestamp: Date.now(),
      } as GeolocationPosition);
    Object.defineProperty(navigator.geolocation, 'watchPosition', {
      value: (ok: PositionCallback) => {
        callback = ok;
        return ++w.watches;
      },
    });
    Object.defineProperty(navigator.geolocation, 'clearWatch', {
      value: () => {
        callback = null;
        w.cleared++;
      },
    });
  });
  await page.goto(base);
  await locate(page);
  await expect(page.locator('#location-notice')).toContainText(
    'Finding your location',
  );
  await expect(page.locator('#locate')).toHaveClass(/locating/);
  const fix = (lat: number, lon: number, accuracy: number) =>
    page.evaluate(
      ([lat, lon, accuracy]) =>
        (
          window as unknown as {
            fix: (a: number, b: number, c: number) => void;
          }
        ).fix(lat, lon, accuracy),
      [lat, lon, accuracy],
    );
  await fix(48.1234, 11.7654, 20);
  await expect(page.locator('#location-notice')).toBeHidden();
  await expect(page.locator('#locate')).not.toHaveClass(/locating/);
  const map = (await page.locator('#map').boundingBox())!;
  const center = async () => {
    const dot = (await page.locator('.location-dot').boundingBox())!;
    return [
      dot.x + dot.width / 2 - map.x - map.width / 2,
      dot.y + dot.height / 2 - map.y - map.height / 2,
    ];
  };
  const radius = async () =>
    (await page.locator('.location-accuracy').boundingBox())!.width;
  const precise = await radius();
  // A less reliable fix widens the margin of error around the moved dot.
  await fix(48.1244, 11.7664, 400);
  await expect.poll(radius).toBeGreaterThan(precise * 5);
  await expect
    .poll(async () => Math.max(...(await center()).map(Math.abs)))
    .toBeLessThan(3);
  // A pan leaves the dot behind; the next fix does not pull the map back.
  // The pan starts once the map has finished following the last fix.
  await mapIdle(page);
  await page.mouse.move(map.x + 300, map.y + 300);
  await page.mouse.down();
  await page.mouse.move(map.x + 450, map.y + 380, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('#locate')).toHaveClass(/free/);
  // The button looks the same whether or not the map follows the dot.
  const look = () =>
    page.locator('#locate').evaluate((e) => {
      const style = getComputedStyle(e);
      return [style.backgroundColor, style.color, style.boxShadow].join();
    });
  const free = await look();
  await fix(48.1245, 11.7665, 20);
  await page.waitForTimeout(400);
  expect(Math.max(...(await center()).map(Math.abs))).toBeGreaterThan(50);
  await page.locator('#locate').click();
  await expect(page.locator('#locate')).not.toHaveClass(/free/);
  await page.mouse.move(0, 0);
  expect(await look()).toBe(free);
  await expect
    .poll(async () => Math.max(...(await center()).map(Math.abs)))
    .toBeLessThan(3);
  await expect(page.locator('#locate')).toHaveClass(/following/);
  // A press while following keeps location on.
  await page.locator('#locate').click();
  await expect(page.locator('#locate')).toHaveClass(/following/);
  await expect(page.locator('.location-dot')).toHaveCount(1);
  await expect(page.locator('.location-accuracy')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { cleared: number }).cleared,
    ),
  ).toBe(0);
  await expect(page.locator('#location-0')).toHaveValue('');
});

test('a dot without new fixes turns grey', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() =>
    Object.defineProperty(navigator.geolocation, 'watchPosition', {
      value: (ok: PositionCallback) => {
        ok({
          coords: { latitude: 48.123, longitude: 11.765, accuracy: 25 },
          timestamp: Date.now(),
        } as GeolocationPosition);
        return 1;
      },
    }),
  );
  await page.goto(base);
  await locate(page);
  await expect(page.locator('.location-dot')).not.toHaveClass(/stale/);
  await page.clock.runFor(31_000);
  await expect(page.locator('.location-dot')).toHaveClass(/stale/);
});

for (const width of [320, 390, 1280])
  test(`location notice stays clear of the map tools at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      Object.defineProperty(navigator.geolocation, 'watchPosition', {
        value: (_ok: unknown, fail: PositionErrorCallback) => {
          fail({ code: 1 } as GeolocationPositionError);
          return 1;
        },
      }),
    );
    await page.goto(base);
    for (const language of ['en', 'pt']) {
      await page.locator('#language').selectOption(language);
      await locate(page);
      const notice = page.locator('#location-notice');
      await expect(notice).toBeVisible();
      if (language === 'pt')
        await expect(notice).toContainText('Permissão de localização negada');
      const box = (await notice.boundingBox())!;
      const tools = (await page.locator('.map-action-control').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThan(tools.x);
      expect(
        await notice.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      ).toBe(true);
    }
  });

test('with location already allowed, the map opens on the device above the sheet, without IP', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(position);
  let ip = 0;
  page.on('request', (r) => {
    if (r.url().includes('ipwho.is')) ip++;
  });
  await page.goto(base);
  await mapReady(page);
  const sheet = (await page.locator('#sheet').boundingBox())!;
  await expect
    .poll(() =>
      page.evaluate(
        ([lat, lon]) =>
          (
            window as unknown as {
              plannerMap: {
                project(c: [number, number]): { x: number; y: number } | null;
              };
            }
          ).plannerMap.project([lat, lon]),
        [position.latitude, position.longitude],
      ),
    )
    .toEqual({
      x: expect.closeTo(195, 0),
      y: expect.closeTo(sheet.y / 2, 0),
    });
  expect(ip).toBe(0);
  // The dot shows without a press, and the position sets no route point.
  await expect(page.locator('.location-dot')).toHaveCount(1);
  await expect(page.locator('#locate')).not.toHaveClass(/following/);
  await expect(page.locator('#location-notice')).toBeHidden();
  await expect(page.locator('#location-0')).toHaveValue('');
});

/** A fake geolocation watch and permission whose state the test changes. */
async function fakeLocation(page: Page, state: PermissionState) {
  await page.addInitScript((state) => {
    const w = window as unknown as {
      fix: (lat: number, lon: number, accuracy?: number) => void;
      watching: () => boolean;
      watches: number;
      setPermission: (state: PermissionState) => void;
    };
    let callback: PositionCallback | null = null;
    w.watches = 0;
    w.watching = () => !!callback;
    w.fix = (latitude, longitude, accuracy = 20) =>
      callback?.({
        coords: { latitude, longitude, accuracy },
        timestamp: Date.now(),
      } as GeolocationPosition);
    Object.defineProperty(navigator.geolocation, 'watchPosition', {
      value: (ok: PositionCallback) => {
        callback = ok;
        return ++w.watches;
      },
    });
    Object.defineProperty(navigator.geolocation, 'clearWatch', {
      value: () => (callback = null),
    });
    // The startup view reads one position too; it never answers here.
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      value: () => {},
    });
    const status = new EventTarget() as PermissionStatus & {
      state: PermissionState;
    };
    status.state = state;
    navigator.permissions.query = async () => status;
    w.setPermission = (next) => {
      status.state = next;
      status.dispatchEvent(new Event('change'));
    };
  }, state);
}
const watching = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { watching: () => boolean }).watching(),
  );
const fixAt = (page: Page, lat: number, lon: number, accuracy = 20) =>
  page.evaluate(
    ([lat, lon, accuracy]) =>
      (
        window as unknown as {
          fix: (a: number, b: number, c: number) => void;
        }
      ).fix(lat, lon, accuracy),
    [lat, lon, accuracy],
  );
const mapView = (page: Page) =>
  page.evaluate(() => {
    const map = (
      window as unknown as {
        plannerMap: { getZoom(): number; getCenter(): [number, number] };
      }
    ).plannerMap;
    return { zoom: map.getZoom(), center: map.getCenter() };
  });

test('already allowed, the dot shows with the page and never moves the map until the button is pressed', async ({
  page,
}) => {
  await fakeLocation(page, 'granted');
  await page.route('**/route/v1/driving/**', (r) => r.abort());
  const state = defaults();
  state.points = [
    { name: 'Start', coord: [-22, -43] },
    { name: 'End', coord: [-23, -44] },
  ];
  await page.goto(base + encodeState(state));
  await mapReady(page);
  await expect.poll(() => watching(page)).toBe(true);
  await fixAt(page, 48.1234, 11.7654);
  await expect(page.locator('.location-dot')).toHaveCount(1);
  await expect(page.locator('#location-notice')).toBeHidden();
  await expect(page.locator('#locate')).not.toHaveClass(/locating|following/);
  // The route stays in view: the dot is far off screen.
  await mapIdle(page);
  const markers = page.locator('.route-marker');
  await expect(markers).toHaveCount(2);
  const map = (await page.locator('#map').boundingBox())!;
  const dot = await page.locator('.location-dot').boundingBox();
  expect(
    !dot ||
      dot.x > map.x + map.width ||
      dot.x + dot.width < map.x ||
      dot.y > map.y + map.height ||
      dot.y + dot.height < map.y,
  ).toBe(true);
  // The button centers on the dot and follows it.
  await page.locator('#locate').click();
  await expect(page.locator('#locate')).toHaveClass(/following/);
  await expect
    .poll(async () => {
      const box = (await page.locator('.location-dot').boundingBox())!;
      return Math.abs(box.x + box.width / 2 - map.x - map.width / 2);
    })
    .toBeLessThan(3);
});

test('the location watch pauses while hidden and during navigation, and stops when the permission is revoked', async ({
  page,
}) => {
  await fakeLocation(page, 'granted');
  await page.goto(base);
  await expect.poll(() => watching(page)).toBe(true);
  await fixAt(page, 48.1234, 11.7654);
  await expect(page.locator('.location-dot')).toHaveCount(1);
  const setHidden = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hidden,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await expect.poll(() => watching(page)).toBe(false);
  await setHidden(false);
  await expect.poll(() => watching(page)).toBe(true);
  // Guided navigation keeps its own watch.
  await page.evaluate(() => {
    document.documentElement.classList.add('navigating');
    document.dispatchEvent(new Event('navigationchange'));
  });
  await expect.poll(() => watching(page)).toBe(false);
  await page.evaluate(() => {
    document.documentElement.classList.remove('navigating');
    document.dispatchEvent(new Event('navigationchange'));
  });
  await expect.poll(() => watching(page)).toBe(true);
  await expect(page.locator('.location-dot')).toHaveCount(1);
  // Revoked in the browser's settings: the dot goes away, quietly.
  await page.evaluate(() =>
    (
      window as unknown as { setPermission: (s: PermissionState) => void }
    ).setPermission('denied'),
  );
  await expect(page.locator('.location-dot')).toHaveCount(0);
  await expect.poll(() => watching(page)).toBe(false);
  await expect(page.locator('#location-notice')).toBeHidden();
  // Allowed again: on with no press.
  await page.evaluate(() =>
    (
      window as unknown as { setPermission: (s: PermissionState) => void }
    ).setPermission('granted'),
  );
  await expect.poll(() => watching(page)).toBe(true);
});

test('started with the page, a slow first fix waits without a notice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, 'watchPosition', {
      value: (_ok: unknown, fail: PositionErrorCallback) => {
        fail({ code: 3 } as GeolocationPositionError);
        return 1;
      },
    });
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      value: () => {},
    });
    const status = new EventTarget() as PermissionStatus & {
      state: PermissionState;
    };
    status.state = 'granted';
    navigator.permissions.query = async () => status;
  });
  await page.goto(base);
  await mapReady(page);
  await page.waitForTimeout(300);
  await expect(page.locator('#location-notice')).toBeHidden();
});

test('already allowed, a slow GPS still opens the map on the device at street zoom, without IP', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeLocation(page, 'granted');
  let ip = 0;
  page.on('request', (r) => {
    if (r.url().includes('ipwho.is')) ip++;
  });
  await page.goto(base);
  await mapReady(page);
  await expect.poll(() => watching(page)).toBe(true);
  // No fix for a while: the map waits on the local default, never on IP.
  await page.waitForTimeout(1500);
  expect(ip).toBe(0);
  const before = await mapView(page);
  expect(before.zoom).toBeLessThan(10);
  // A rough first fix frames the area; a precise one zooms to the street.
  await fixAt(page, -22.6919, -43.4589, 800);
  await expect.poll(async () => (await mapView(page)).zoom).toBe(13);
  await fixAt(page, -22.692, -43.459, 15);
  await expect.poll(async () => (await mapView(page)).zoom).toBe(15);
  // The dot shows above the sheet.
  const sheet = (await page.locator('#sheet').boundingBox())!;
  const dot = (await page.locator('.location-dot').boundingBox())!;
  expect(dot.y + dot.height / 2).toBeCloseTo(sheet.y / 2, -1);
  // Once the traveler moves the map, fixes no longer frame it.
  await mapIdle(page);
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(260, 360, { steps: 8 });
  await page.mouse.up();
  await mapIdle(page);
  const moved = await mapView(page);
  await fixAt(page, -22.7, -43.47, 5);
  await page.waitForTimeout(400);
  expect(await mapView(page)).toEqual(moved);
  await expect(page.locator('#location-notice')).toBeHidden();
  expect(ip).toBe(0);
});

for (const state of ['prompt', 'denied'] as const)
  test(`location ${state}: ${state === 'prompt' ? 'the map opens where it was last left, without IP or asking' : 'the map opens on the IP region, not the last view'}`, async ({
    page,
  }) => {
    await page.addInitScript((state) => {
      localStorage.setItem(
        'last-view',
        JSON.stringify({ center: [-22.912, -43.23], zoom: 14 }),
      );
      for (const name of ['getCurrentPosition', 'watchPosition'])
        Object.defineProperty(navigator.geolocation, name, {
          value: () => {
            document.documentElement.dataset.gpsCalls = 'unexpected';
          },
        });
      navigator.permissions.query = async () => ({ state }) as PermissionStatus;
    }, state);
    let ip = 0;
    page.on('request', (r) => {
      if (r.url().includes('ipwho.is')) ip++;
    });
    await page.goto(base);
    await mapReady(page);
    if (state === 'prompt') {
      await expect
        .poll(() => mapView(page))
        .toEqual({ zoom: 14, center: [-22.912, -43.23] });
      expect(ip).toBe(0);
    } else {
      // The mocked IP answer is Paris.
      await expect
        .poll(async () => (await mapView(page)).center[0])
        .toBeCloseTo(48.85, 1);
      expect(ip).toBe(1);
    }
    await expect(page.locator('html')).not.toHaveAttribute('data-gps-calls');
  });

test('the map view is kept on the device when the page is left', async ({
  page,
}) => {
  await page.goto(base);
  await mapReady(page);
  await page.evaluate(() =>
    (
      window as unknown as {
        plannerMap: { setView(c: [number, number], z: number): void };
      }
    ).plannerMap.setView([-22.95, -43.2], 13),
  );
  await mapIdle(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const saved = await page.evaluate(() => localStorage.getItem('last-view'));
  const view = JSON.parse(saved!);
  expect(view.zoom).toBeCloseTo(13, 1);
  expect(view.center[0]).toBeCloseTo(-22.95, 3);
  expect(view.center[1]).toBeCloseTo(-43.2, 3);
});
