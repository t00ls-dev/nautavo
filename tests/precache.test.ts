import { describe, expect, it } from 'vitest';
import { isPageUrl, pageKey, precacheList, precacheUrl } from '../src/precache';

describe('app-shell precache', () => {
  const files = precacheList([
    'index.html',
    'help.html',
    'changelog.html',
    'assets/main-abc.js',
    'assets/main-abc.css',
    'assets/icon-abc.svg',
    'assets/social-card-abc.png',
    'manifest.webmanifest',
    'THIRD_PARTY_NOTICES.txt',
    '_headers',
    'sw.js',
    'sitemap.xml',
    'robots.txt',
  ]);

  it('keeps the pages, their assets, icons, manifest and notices only', () => {
    expect(files).toEqual([
      '/THIRD_PARTY_NOTICES.txt',
      '/assets/icon-abc.svg',
      '/assets/main-abc.css',
      '/assets/main-abc.js',
      '/changelog.html',
      '/help.html',
      '/index.html',
      '/manifest.webmanifest',
    ]);
  });

  it('accepts Windows separators from the build folder walk', () => {
    expect(precacheList(['assets\\main-abc.js'])).toEqual([
      '/assets/main-abc.js',
    ]);
  });

  // Cloudflare redirects /help.html to /help (html_handling), and a
  // redirected response is refused for a navigation: pages are cached and
  // requested only by their public URL, so the app opens offline.
  const urls = files.map(precacheUrl);

  it('caches pages by their public URL, never by their .html address', () => {
    expect(urls).toEqual([
      '/THIRD_PARTY_NOTICES.txt',
      '/assets/icon-abc.svg',
      '/assets/main-abc.css',
      '/assets/main-abc.js',
      '/changelog',
      '/help',
      '/',
      '/manifest.webmanifest',
    ]);
    expect(urls.some((url) => url.endsWith('.html'))).toBe(false);
  });

  it('answers navigations with their cached page, the root with the app', () => {
    expect(pageKey('/', urls)).toBe('/');
    expect(pageKey('/help', urls)).toBe('/help');
    expect(pageKey('/changelog', urls)).toBe('/changelog');
    // An old address with the extension still opens offline.
    expect(pageKey('/help.html', urls)).toBe('/help');
    expect(pageKey('/index.html', urls)).toBe('/');
    // So does the trailing-slash address Cloudflare redirects.
    expect(pageKey('/help/', urls)).toBe('/help');
    // Anything else goes to the network only.
    expect(pageKey('/sitemap.xml', urls)).toBeUndefined();
    expect(pageKey('/missing.html', urls)).toBeUndefined();
    expect(pageKey('/missing', urls)).toBeUndefined();
    expect(pageKey('/api/region', urls)).toBeUndefined();
  });

  it('tells pages, answered network-first, from cached files', () => {
    for (const url of ['/', '/help', '/changelog'])
      expect(isPageUrl(url)).toBe(true);
    for (const url of [
      '/assets/main-abc.js',
      '/manifest.webmanifest',
      '/THIRD_PARTY_NOTICES.txt',
    ])
      expect(isPageUrl(url), url).toBe(false);
  });
});
