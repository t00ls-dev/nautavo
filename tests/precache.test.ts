import { describe, expect, it } from 'vitest';
import { pageKey, precacheList } from '../src/precache';

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

  it('answers navigations with their precached page, the root with the app', () => {
    expect(pageKey('/', files)).toBe('/index.html');
    expect(pageKey('/help', files)).toBe('/help.html');
    expect(pageKey('/changelog', files)).toBe('/changelog.html');
    // An old address with the extension still opens offline.
    expect(pageKey('/help.html', files)).toBe('/help.html');
    // Anything else goes to the network only.
    expect(pageKey('/sitemap.xml', files)).toBeUndefined();
    expect(pageKey('/missing.html', files)).toBeUndefined();
    expect(pageKey('/assets/main-abc.js', files)).toBeUndefined();
  });
});
