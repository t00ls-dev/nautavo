// Which build files the app-shell service worker keeps (AGENTS.md, Guided
// navigation): the pages, their hashed assets (icons included), manifest and
// notices.
// Route data stays in IndexedDB; nothing cross-origin is ever cached.

/** Build output paths (`index.html`, `assets/main-x.js`) to `/`-rooted URLs to precache. */
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
 * The precached page that answers a navigation, or undefined to use the
 * network only. Pages are published without their extension (`/help` serves
 * help.html); an old `.html` address still finds its page offline.
 */
export function pageKey(
  pathname: string,
  files: readonly string[],
): string | undefined {
  const key =
    pathname === '/'
      ? '/index.html'
      : pathname.endsWith('.html')
        ? pathname
        : `${pathname}.html`;
  return files.includes(key) ? key : undefined;
}

/** Cache names belong to one build, so an update never mixes files of two builds. */
export const CACHE_PREFIX = 'route-gpx-shell-';
