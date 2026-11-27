// Retired service worker (AGENTS.md, Guided navigation). Nautavo no longer
// keeps an offline copy of itself: browsers that installed the former
// app-shell worker fetch this one at the same URL on their next visit, and it
// deletes the origin's caches (the app shell was its only one) and removes
// itself. It has no fetch handler, so it never answers a request.

// A module, so `self` below is declared for this file only.
export {};

// The worker scope's events, declared locally because the project's types are
// the DOM ones.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
declare const self: {
  skipWaiting(): Promise<void>;
  readonly registration: { unregister(): Promise<boolean> };
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEvent) => void,
  ): void;
};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister()),
  );
});
