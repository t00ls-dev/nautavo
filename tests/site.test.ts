import { describe, expect, it } from 'vitest';
import { canonicalUrl } from '../src/seo';
import { DEFAULT_SITE_URL, siteUrl, withSite } from '../src/site';
import { readRepoFile, sourceFiles } from './repo-files';

describe('site address', () => {
  it('defaults to the published site and normalizes another host root', () => {
    expect(siteUrl()).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('')).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('https://routes.example.org')).toBe(
      'https://routes.example.org/',
    );
    expect(siteUrl('http://localhost:8080/')).toBe('http://localhost:8080/');
  });

  it('rejects addresses the / base cannot serve', () => {
    for (const value of [
      'routes.example.org',
      'ftp://example.org/',
      'https://example.org/nautavo/',
      'https://example.org/?lang=pt',
      'https://example.org/#top',
    ])
      expect(() => siteUrl(value), value).toThrow(/SITE_URL/);
  });

  it('replaces every site URL in pages, sitemap and robots.txt, not prose', () => {
    const site = 'https://routes.example.org/';
    const text = [
      '<link rel="alternate" hreflang="pt-BR" href="https://nautavo.com/help?lang=pt" />',
      '"image": "https://nautavo.com/src/brand/social-card.png",',
      '<loc>https://nautavo.com/changelog</loc>',
      'Sitemap: https://nautavo.com/sitemap.xml',
      '<li>route-gpx is now nautavo, at nautavo.com.</li>',
    ].join('\n');
    expect(withSite(text, site)).toBe(
      [
        '<link rel="alternate" hreflang="pt-BR" href="https://routes.example.org/help?lang=pt" />',
        '"image": "https://routes.example.org/src/brand/social-card.png",',
        '<loc>https://routes.example.org/changelog</loc>',
        'Sitemap: https://routes.example.org/sitemap.xml',
        '<li>route-gpx is now nautavo, at nautavo.com.</li>',
      ].join('\n'),
    );
    expect(withSite(text, DEFAULT_SITE_URL)).toBe(text);
  });

  it('gives the runtime canonical URLs the build address', () => {
    expect(canonicalUrl('pt', 'help')).toBe(`${DEFAULT_SITE_URL}help?lang=pt`);
  });

  it('names the site URL in code only in src/site.ts', () => {
    const named = sourceFiles()
      .filter((file) => file !== 'src/site.ts')
      .filter((file) => readRepoFile(file).includes(DEFAULT_SITE_URL));
    expect(named).toEqual([]);
  });
});
