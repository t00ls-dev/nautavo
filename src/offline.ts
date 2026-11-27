// Connection handling: the offline notice, one attempt when the connection
// returns, and the removal of the retired service worker. The app needs a
// connection to open; one already open keeps working with what it has.

/**
 * Marks an iOS home-screen web app (`navigator.standalone`): with the
 * black-translucent status bar it runs under the status bar, so the page
 * keeps its controls below a white strip (`.top-edge` in style.css).
 */
export function markHomeScreenApp(): void {
  if ((navigator as Navigator & { standalone?: boolean }).standalone)
    document.documentElement.classList.add('ios-web-app');
}

/**
 * Removes the retired app-shell service worker and the origin's caches (the
 * app shell was the only one): Nautavo has no offline mode, so a browser
 * that installed the former worker stops using it. `src/sw.ts` does the same
 * from the worker side.
 */
export function removeServiceWorker(): void {
  if (!window.isSecureContext) return;
  void navigator.serviceWorker
    ?.getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations.map((registration) => registration.unregister()),
      ),
    )
    .catch(() => undefined);
  void window.caches
    ?.keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => undefined);
}

/**
 * Work that failed because the device is offline is attempted once more when
 * the connection returns (AGENTS.md: a single attempt on the browser's
 * `online` event, never a retry loop). Each user makes one of these: a new
 * attempt replaces the one still waiting, so one `online` event runs at most
 * one attempt per user. `wait` schedules `attempt` and returns true only
 * while the browser reports no connection; online, it schedules nothing.
 */
export function onlineAttempt(): (attempt: () => void) => boolean {
  let waiting: (() => void) | null = null;
  window.addEventListener('online', () => {
    const attempt = waiting;
    waiting = null;
    attempt?.();
  });
  return (attempt) => {
    if (navigator.onLine) return false;
    waiting = attempt;
    return true;
  };
}

/** Shows `notice` while the browser reports no connection. */
export function watchConnection(notice: HTMLElement): void {
  const update = () => {
    notice.hidden = navigator.onLine;
  };
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}
