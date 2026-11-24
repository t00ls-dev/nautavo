// App-shell service worker (AGENTS.md, Guided navigation; #126). It keeps the
// same-origin files of one build so the app, help and What's new open without
// network, and saved routes (IndexedDB) can be followed offline. It never
// answers cross-origin requests (tiles, routing, search, weather, elevation,
// road attributes), and same-origin requests outside its list, such as the
// approximate region (/api/region, never to be cached), go to the network.
import { CACHE_PREFIX, isPageUrl, pageKey } from './precache';

// The worker scope's events, declared locally because the project's types are
// the DOM ones.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
declare const self: {
  readonly location: Location;
  readonly navigator: { readonly onLine: boolean };
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEvent) => void,
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
};

// Replaced at build time (vite.config.ts) by this build's version and URLs.
const BUILD = '__NAUTAVO_BUILD__';
const { version, urls } = JSON.parse(BUILD) as {
  version: string;
  urls: string[];
};
const cacheName = CACHE_PREFIX + version;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      // `reload` skips the HTTP cache, so the copy matches this build.
      .then((cache) =>
        cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== cacheName)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * A page from the cache, without a connection only. Online, pages are not
 * answered here: the browser loads them itself, so an online visit always
 * gets the latest deploy, and Chrome and Brave on iOS, which call a page
 * answered by a service worker not secure, show the connection as it is.
 * Fresh pages are never stored here: a page and its assets always come from
 * the same build.
 */
function cachedPage(key: string): Promise<Response> {
  return caches
    .open(cacheName)
    .then((cache) => cache.match(key))
    .then((response) => response ?? Response.error());
}

/** Hashed assets never change, so the cached copy is used when present. */
function cacheFirst(request: Request, key: string): Promise<Response> {
  return caches
    .open(cacheName)
    .then((cache) => cache.match(key))
    .then((response) => response ?? fetch(request));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Cross-origin requests are never touched: no respondWith, no cache.
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    const key = pageKey(url.pathname, urls);
    if (key && !self.navigator.onLine) event.respondWith(cachedPage(key));
    return;
  }
  // A page fetched by script (not a navigation) goes to the network: its
  // cached copy may belong to an older deploy.
  if (urls.includes(url.pathname) && !isPageUrl(url.pathname))
    event.respondWith(cacheFirst(request, url.pathname));
});
