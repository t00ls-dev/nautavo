import { test, expect } from '@playwright/test';
import { mockBasemap } from './map-helpers';
import { defaults, encodeState } from '../src/core';
import { base, previewBase, mockRegion } from './app-helpers';
test('SEO metadata stays localized and excludes private route state', async ({
  page,
}) => {
  await mockBasemap(page);
  await page.goto(base);
  const canonical = 'https://nautavo.com/';
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    canonical,
  );
  await page.locator('#language').selectOption('pt');
  await expect(page).toHaveTitle(/Planejador de rotas/);
  await expect(page.locator('meta[name=description]')).toHaveAttribute(
    'content',
    /Crie rotas pelas ruas/,
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    'content',
    'pt_BR',
  );
  await page.locator('#location-0').fill('-22.930929, -43.238286');
  await page.locator('#location-0').press('Tab');
  // Portuguese has its own URL and canonical, never with the route hash.
  await expect(page).toHaveURL(/\/\?lang=pt#v2=/);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    canonical + '?lang=pt',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    canonical + '?lang=pt',
  );
  await page.locator('#language').selectOption('en');
  await expect(page).toHaveTitle(/Route Planner/);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toMatch(/^#v2=/);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    canonical,
  );
  const schema = JSON.parse(
    await page.locator('script[type="application/ld+json"]').innerText(),
  );
  expect(schema.name).toBe('nautavo');
  expect(schema.url).toBe(canonical);
});
test('?lang=pt opens the app in Portuguese over the saved preference and keeps the route', async ({
  page,
}) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.addInitScript(() => localStorage.setItem('language', 'en'));
  const hash = encodeState({ ...defaults(), language: 'en' });
  await page.goto(base + '?lang=pt' + hash);
  await expect(page.locator('#language')).toHaveValue('pt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    'https://nautavo.com/?lang=pt',
  );
  expect(new URL(page.url()).search).toBe('?lang=pt');
  expect(new URL(page.url()).hash).toMatch(/^#v2=/);
});
test('manifest and icon files resolve at the custom-domain root', async ({
  page,
  request,
}) => {
  await mockBasemap(page);
  await page.goto(base);
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifestUrl = new URL(href!, base);
  const response = await request.get(manifestUrl.href);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.id).toBe('/');
  expect(manifest.display).toBe('browser');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, manifestUrl).href);
    expect(response.ok()).toBeTruthy();
    const dimensions = await page.evaluate(async (url: string) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    }, new URL(icon.src, manifestUrl).href);
    expect(dimensions).toBe(icon.sizes);
  }
  const apple = await page
    .locator('link[rel=apple-touch-icon]')
    .getAttribute('href');
  expect((await request.get(new URL(apple!, base).href)).ok()).toBeTruthy();
  expect(
    (await request.get(new URL('sitemap.xml', base).href)).ok(),
  ).toBeTruthy();
});

test('the production build names brand files by their contents', async ({
  request,
}) => {
  // Icons, wordmark and social card get a new URL whenever they change, so
  // no browser or home-screen icon cache keeps an old one.
  const hashed =
    /^\/assets\/(icon|icon-\d+|maskable-512|wordmark|social-card)-[\w-]{8}\.(png|svg)$/;
  const urls = new Set<string>();
  for (const path of ['', 'help', 'changelog']) {
    const html = await (await request.get(previewBase + path)).text();
    expect(html, path).not.toContain('/src/brand/');
    for (const [, url] of html.matchAll(
      /(?:href|src|content)="(?:https:\/\/nautavo\.com)?(\/assets\/(?:icon|maskable|wordmark|social-card)[^"]*)"/g,
    ))
      urls.add(url);
  }
  const manifest = (await (
    await request.get(`${previewBase}manifest.webmanifest`)
  ).json()) as { icons: { src: string }[] };
  for (const icon of manifest.icons) urls.add(icon.src);
  expect(
    [...urls].map((url) => url.replace(/-[\w-]{8}\./, '.')).sort(),
  ).toEqual([
    '/assets/icon-180.png',
    '/assets/icon-192.png',
    '/assets/icon-32.png',
    '/assets/icon-512.png',
    '/assets/icon.svg',
    '/assets/maskable-512.png',
    '/assets/social-card.png',
    '/assets/wordmark.svg',
  ]);
  for (const url of urls) {
    expect(url).toMatch(hashed);
    expect((await request.get(previewBase + url.slice(1))).ok(), url).toBe(
      true,
    );
  }
});

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.fulfill({ status: 204 }));

  await mockRegion(page);
});

test('help switches language and metadata while preserving the route in its return link', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-08T10:00:00Z'));
  const hash = encodeState({
    ...defaults(),
    departure: '2026-11-09T10:00:00.000Z',
  });
  await page.goto(base + 'help?lang=pt' + hash);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.locator('#help-pt')).toBeVisible();
  await expect(page.locator('#help-en')).toBeHidden();
  await expect(page).toHaveTitle(/Ajuda/);
  await expect(page.locator('#back')).toHaveAttribute('href', './' + hash);
  await page.locator('#language').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#help-en')).toBeVisible();
  await expect(page.locator('#help-pt')).toBeHidden();
  await expect(page).toHaveTitle(/Route Planning/);
  await expect(page.locator('#back')).toHaveAttribute('href', './' + hash);
  expect(new URL(page.url()).hash).toBe(hash);
  expect(new URL(page.url()).searchParams.get('lang')).toBe('en');
  await page.locator('#language').selectOption('pt');
  await expect(page.locator('#help-pt')).toBeVisible();
  await expect(page.locator('#back')).toHaveText('Voltar ao mapa');
});

test('help opens at a linked section and keeps the route hash for Back to map', async ({
  page,
}) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.goto(`${base}help?lang=pt&section=elevation#v2=abc`);
  await expect(page.locator('#elevation-pt')).toBeInViewport();
  await expect(page.locator('#back')).toHaveAttribute('href', './#v2=abc');
});

test("What's new switches language and metadata and keeps the route for Back to map", async ({
  page,
}) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.goto(base + 'changelog?lang=pt#v2=abc');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.locator('#changelog-pt')).toBeVisible();
  await expect(page.locator('#changelog-en')).toBeHidden();
  await expect(page).toHaveTitle('nautavo — Novidades');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    'https://nautavo.com/changelog?lang=pt',
  );
  await expect(page.locator('#back')).toHaveAttribute('href', './#v2=abc');
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#changelog-en')).toBeVisible();
  await expect(page).toHaveTitle("nautavo — What's New");
  await expect(page.locator('meta[name=description]')).toHaveAttribute(
    'content',
    /See what changed/,
  );
  // Each language has its own canonical URL, never with the route hash.
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    'https://nautavo.com/changelog',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://nautavo.com/changelog',
  );
  // The help link keeps the language and the route.
  await expect(page.locator('#changelog-en a[data-page-link]')).toHaveAttribute(
    'href',
    './help?lang=en#v2=abc',
  );
});

test("the panel footer and the help page link to What's new in the chosen language", async ({
  page,
}) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  await page.goto(base);
  await page.locator('#language').selectOption('pt');
  const link = page.locator('#changelog');
  await expect(link).toHaveText('Novidades');
  await expect(link).toHaveAttribute('href', /^\.\/changelog\?lang=pt#/);
  await page.goto(base + 'help?lang=pt#v2=abc');
  await expect(page.locator('#help-pt a[data-page-link]')).toHaveAttribute(
    'href',
    './changelog?lang=pt#v2=abc',
  );
});

test('the Help and What’s new headers fit on one line from 320 px', async ({
  page,
}) => {
  await page.route('https://**/*', (r) => r.fulfill({ status: 204 }));
  const problems: string[] = [];
  for (const path of ['help', 'changelog'])
    for (const lang of ['en', 'pt'])
      // 380 px is where the wordmark shows again, beside Voltar ao mapa.
      for (const width of [320, 360, 380, 390, 430]) {
        await page.setViewportSize({ width, height: 700 });
        await page.goto(`${base}${path}?lang=${lang}`);
        await expect(page.locator('#back')).toBeVisible();
        const found = await page.evaluate(() => {
          const out: string[] = [];
          const header = document.querySelector('header')!;
          if (document.documentElement.scrollWidth > innerWidth)
            out.push('page scrolls sideways');
          for (const e of header.querySelectorAll<HTMLElement>(
            '.brand, .language-control, #back',
          )) {
            const box = e.getBoundingClientRect();
            if (box.right > innerWidth + 0.5)
              out.push(`${e.className || e.id} leaves the screen`);
            if (e.scrollWidth > e.clientWidth + 1)
              out.push(`${e.className || e.id} is clipped`);
          }
          const back = document.getElementById('back')!;
          if (back.getBoundingClientRect().height > 48) out.push('#back wraps');
          return out;
        });
        problems.push(...found.map((p) => `${path} ${lang} ${width}: ${p}`));
      }
  expect(problems).toEqual([]);
});
