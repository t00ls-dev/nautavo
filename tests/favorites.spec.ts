import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { base, mockOsrm } from './app-helpers';
import { mockBasemap } from './map-helpers';

const start = '-22.930929, -43.238286',
  end = '-23.050160, -43.535240';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(page);
  await mockOsrm(page);
});

/** A routed pair of points, then the point menu of field `i` opened. */
async function routed(page: Page) {
  await page.goto(base);
  await page.locator('#language').selectOption('en');
  await page.locator('#location-0').fill(start);
  await page.locator('#location-1').fill(end);
  await page.locator('#location-1').press('Tab');
  await expect(page.locator('#download')).toBeEnabled({ timeout: 15000 });
}
const menu = (page: Page, i: number) =>
  page.locator(`#suggestions-${i}`).getByRole('option');
/** Saves the place of field `i` as a favorite from its menu. */
async function saveFavorite(
  page: Page,
  i: number,
  name: string,
  save = 'Save',
) {
  await page.locator(`#location-${i}`).focus();
  await menu(page, i).nth(2).click();
  const sheet = page.locator('#favorite-dialog');
  await expect(sheet).toBeVisible();
  await sheet.locator('#favorite-name').fill(name);
  await sheet.getByRole('button', { name: save, exact: true }).click();
  await expect(sheet).toBeHidden();
}

test('a point saved as a favorite is reused, renamed and deleted, never in the link', async ({
  page,
}) => {
  await routed(page);
  const link = page.url();
  // The app's own sheet: a point typed as coordinates suggests no name,
  // and Home fills it.
  await page.locator('#location-0').focus();
  await menu(page, 0).filter({ hasText: 'Save as favorite' }).click();
  const sheet = page.getByRole('dialog', { name: 'Save favorite' });
  await expect(sheet.locator('#favorite-name')).toHaveValue('');
  await expect(sheet.locator('#favorite-where')).toHaveValue(
    '-22.93093, -43.23829',
  );
  await sheet.getByText('Home', { exact: true }).click();
  await expect(sheet.getByRole('radio', { name: 'Home' })).toBeChecked();
  await expect(sheet.locator('#favorite-name')).toHaveValue('Home');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toHaveText(
    'Favorite saved on this device.',
  );
  // The point now goes by the favorite's name.
  await expect(page.locator('#location-0')).toHaveValue('Home');
  // Already a favorite: the menu no longer offers to save it again.
  await page.locator('#location-1').focus();
  await page.locator('#location-0').focus();
  await expect(
    menu(page, 0).filter({ hasText: 'Save as favorite' }),
  ).toHaveCount(0);
  await expect(menu(page, 0).filter({ hasText: 'Home' })).toContainText(
    'This point',
  );
  await expect(page.locator('#favorite-count')).toHaveText('(1)');
  // Used for the destination: its place and name, with no search.
  let searches = 0;
  page.on('request', (r) => {
    if (/photon|nominatim/.test(r.url())) searches++;
  });
  await page.locator('#location-1').focus();
  await menu(page, 1).filter({ hasText: 'Home' }).click();
  await expect(page.locator('#location-1')).toHaveValue('Home');
  expect(searches).toBe(0);
  // The link carries points, never the favorites list.
  expect(page.url()).not.toBe(link);
  expect(decodeURIComponent(page.url())).not.toContain('favorite');
  // Rename and delete in the library.
  await page.locator('.saved-routes > summary').click();
  await page.locator('.favorites > summary').click();
  await page.getByRole('button', { name: 'Edit favorite: Home' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit favorite' });
  await edit.locator('#favorite-name').fill('My home');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.favorite-name')).toHaveText('My home');
  await page.getByRole('button', { name: 'Delete favorite: My home' }).click();
  await expect(page.locator('#favorite-count')).toHaveText('(0)');
  await expect(page.locator('#library-status')).toHaveText('Favorite deleted.');
});

test('editing a favorite moves it by search or coordinates, and typing filters the menu', async ({
  page,
}) => {
  await page.route('https://photon.komoot.io/**', (r) =>
    r.fulfill({
      json: {
        features: [
          {
            properties: { name: 'Padaria Real', city: 'Rio de Janeiro' },
            geometry: { type: 'Point', coordinates: [-43.2, -22.95] },
          },
        ],
      },
    }),
  );
  await routed(page);
  await saveFavorite(page, 0, 'Home');
  await saveFavorite(page, 1, 'Work');
  // Typing filters the favorites in a point's menu.
  await page.locator('#location-1').fill('wor');
  await expect(menu(page, 1).filter({ hasText: 'Work' })).toHaveCount(1);
  await expect(menu(page, 1).filter({ hasText: 'Home' })).toHaveCount(0);
  await page.locator('#location-1').press('Escape');
  // Favorite places sit right below Saved routes, not inside it.
  await expect(page.locator('.saved-routes .favorites')).toHaveCount(0);
  await page.locator('.favorites > summary').click();
  await page.getByRole('button', { name: 'Edit favorite: Home' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit favorite' });
  const where = sheet.locator('#favorite-where');
  await expect(where).toHaveValue(/^-22\.93093, -43\.23829$/);
  // A suggestion moves it and keeps the address.
  await where.fill('Padaria');
  await sheet.getByRole('option', { name: /Padaria Real/ }).click();
  await expect(where).toHaveValue(/Padaria Real/);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();
  const home = page.locator('.favorite-row').filter({ hasText: 'Home' });
  await expect(home.locator('small')).toContainText('Padaria Real');
  // Text typed but not chosen is refused; pasted coordinates are taken.
  await page.getByRole('button', { name: 'Edit favorite: Home' }).click();
  await where.fill('somewhere else');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.locator('#favorite-error')).toHaveText(
    'Choose the place from the search, or paste coordinates.',
  );
  await where.fill('-22.9, -43.1');
  await where.press('Enter');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(home.locator('small')).toHaveText('-22.90000, -43.10000');
});

test('favorites travel in the backup and import on another device', async ({
  page,
  browser,
}) => {
  await routed(page);
  await saveFavorite(page, 0, 'Home');
  await expect(page.locator('#favorite-count')).toHaveText('(1)');
  // The backup lives in Settings.
  await page.locator('#open-settings').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backup-routes').click(),
  ]);
  const backup = await readFile((await download.path())!);
  const json = JSON.parse(backup.toString());
  expect(json.version).toBe(2);
  expect(json.favorites.map((f: { name: string }) => f.name)).toEqual(['Home']);
  // A fresh browser profile, as another device.
  const other = await browser.newPage();
  await other.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await mockBasemap(other);
  await other.goto(base);
  await other.locator('#language').selectOption('en');
  await other.locator('#open-settings').click();
  await other.locator('#restore-routes').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: backup,
  });
  await expect(other.locator('#backup-status')).toHaveText(
    'Imported 0 routes and 1 favorite. Existing names were kept.',
  );
  await expect(other.locator('#favorite-count')).toHaveText('(1)');
  await other.close();
});

test('saved routes stay when the library upgrades to hold favorites', async ({
  page,
}) => {
  // The library as an earlier version left it: version 1, routes only.
  await page.goto(base + 'help.html');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('route-gpx', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('routes', { keyPath: 'id' });
        request.onsuccess = () => {
          const tx = request.result.transaction('routes', 'readwrite');
          tx.objectStore('routes').put({
            id: 'old',
            name: 'Old',
            state: {
              version: 1,
              points: [
                { name: 'A', coord: [-22.9, -43.2] },
                { name: 'B', coord: [-22.95, -43.25] },
              ],
              prefer: false,
              name: 'Old',
              osrm: 'https://router.project-osrm.org',
              valhalla: 'https://valhalla1.openstreetmap.de',
              nominatim: 'https://nominatim.openstreetmap.org',
            },
            route: {
              segments: [
                [
                  [-22.9, -43.2],
                  [-22.95, -43.25],
                ],
              ],
              steps: [],
              distance: 7000,
              duration: 600,
              provider: 'OSRM',
            },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          });
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.goto(base);
  await expect(page.locator('#saved-count')).toHaveText('(1)');
  await expect(page.locator('#favorite-count')).toHaveText('(0)');
});

for (const [width, language] of [
  [320, 'pt'],
  [1280, 'en'],
] as const)
  test(`a long favorite name fits the menu and the library at ${width}px in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await routed(page);
    if (language === 'pt') await page.locator('#language').selectOption('pt');
    const long = 'Casa da avó na Estrada das Paineiras, depois do mirante';
    await saveFavorite(page, 0, long, language === 'pt' ? 'Salvar' : 'Save');
    await expect(page.locator('#favorite-count')).toHaveText('(1)');
    await page.locator('#location-1').focus();
    const option = menu(page, 1).filter({ hasText: 'Casa da avó' });
    await expect(option).toBeVisible();
    const fits = (selector: string) =>
      page.locator(selector).evaluateAll((items) =>
        items.flatMap((e) => {
          const box = e.getBoundingClientRect();
          return box.width && box.right > innerWidth + 0.5
            ? [e.textContent]
            : [];
        }),
      );
    expect(await fits('#suggestions-1 [role=option]')).toEqual([]);
    await page.locator('.saved-routes > summary').click();
    await page.locator('.favorites > summary').click();
    expect(await fits('.favorite-row, .favorite-row button')).toEqual([]);
    // The sheet fits too, with its three icon choices on one row.
    await page.locator('.favorite-row button').first().click();
    expect(
      await fits('#favorite-dialog, #favorite-dialog .favorite-kind'),
    ).toEqual([]);
    const tops = await page
      .locator('.favorite-kind')
      .evaluateAll((e) =>
        e.map((k) => Math.round(k.getBoundingClientRect().top)),
      );
    expect(new Set(tops).size).toBe(1);
    // The name stays on one line (shortened), beside its buttons.
    const lines = await page
      .locator('.favorite-name')
      .evaluate(
        (e) =>
          e.getBoundingClientRect().height /
          parseFloat(getComputedStyle(e).lineHeight),
      );
    expect(lines).toBeLessThan(1.5);
  });
