// Which build files the app-shell service worker keeps (AGENTS.md, Guided
// navigation): the pages, their hashed assets (icons included), manifest and
// notices.
// Route data stays in IndexedDB; nothing cross-origin is ever cached.

/** Build output paths (`index.html`, `assets/main-x.js`) to the `/`-rooted files to keep. */
export function precacheList(files: readonly string[]): string[] {
  return files
    .map((file) => file.replaceAll('\\', '/').replace(/^\/+/, ''))
    .filter(
      (file) =>
        /^[^/]+\.html$/.test(file) ||
        // Hashed assets, brand icons included; the social card is only for
        // link previews, never shown by the app.
        (file.startsWith('assets/') &&
          !file.startsWith('assets/social-card-')) ||
        file === 'manifest.webmanifest' ||
        file === 'THIRD_PARTY_NOTICES.txt',
    )
    .map((file) => `/${file}`)
    .sort();
}

/**
 * The URL a kept file is cached and requested under. Pages are published
 * without their extension (`/help` serves help.html, `/` the app) and their
 * `.html` addresses redirect there on Cloudflare, so a page is fetched and
 * cached by its public URL: a redirected response would be refused for a
 * navigation, and the app would not open offline.
 */
export function precacheUrl(file: string): string {
  // `/help/` also redirects to `/help` on Cloudflare.
  const slash = /^(\/[^/.]+)\/$/.exec(file);
  if (slash) return slash[1];
  if (!/^\/[^/]+\.html$/.test(file)) return file;
  return file === '/index.html' ? '/' : file.slice(0, -'.html'.length);
}

/** A page's public URL (`/`, `/help`): the browser loads it online; the cache answers it only offline. */
export function isPageUrl(url: string): boolean {
  return url === '/' || /^\/[^/.]+$/.test(url);
}

/**
 * The cached page that answers a navigation, or undefined to use the network
 * only; an old `.html` address still finds its page offline.
 */
export function pageKey(
  pathname: string,
  urls: readonly string[],
): string | undefined {
  const key = precacheUrl(pathname);
  return urls.includes(key) ? key : undefined;
}

/** Cache names belong to one build, so an update never mixes files of two builds. */
export const CACHE_PREFIX = 'nautavo-shell-';
