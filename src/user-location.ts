import { metersPerPixel, type MapMarker, type PlannerMap } from './planner-map';
import type { Coord } from './core';
import type { View } from './default-view';
import { locationError, locationPermission, positionView } from './location';
import { byId as element } from './dom';
import { compactLayout } from './panel';

/** A fix older than this greys the dot: the position may have moved on. */
const STALE_AFTER = 30_000;
const NOTICE_TIME = 8_000;

/**
 * Use my location on the planner map: while the site may use location, a blue
 * dot follows the device with its accuracy circle, like a maps app. With the
 * permission already granted it starts with the page, without moving the map;
 * otherwise the first tap asks for it. The button centers the map on the dot
 * and follows it until the traveler pans the map; it never turns location
 * off. The watch pauses while the page is hidden and during guided navigation
 * (which keeps its own), and stops when the permission is revoked. Positions
 * stay in page memory only: never in links, storage or requests.
 */
export function setupUserLocation(
  map: PlannerMap,
  interact: () => void,
  /** Every fix while the map does not follow the dot (startup framing). */
  onFix: (view: View) => void,
): void {
  const button = element<HTMLButtonElement>('locate');
  const notice = element('location-notice');
  let accuracy: MapMarker | null = null;
  let dot: MapMarker | null = null;
  let radius = 0;
  let watch: number | null = null;
  let active = false;
  let following = false;
  // Started with the page: errors before the first fix stay silent.
  let quiet = false;
  let last: { center: Coord; zoom: number; time: number } | null = null;
  let staleTimer = 0;
  let noticeTimer = 0;

  const show = (message: string | null) => {
    clearTimeout(noticeTimer);
    notice.textContent = message ?? '';
    notice.hidden = !message;
    if (message)
      noticeTimer = window.setTimeout(
        () => (notice.hidden = true),
        NOTICE_TIME,
      );
  };
  const render = () => {
    button.classList.toggle('locating', active && !last && !quiet);
    button.classList.toggle('following', active && following);
    button.classList.toggle('free', active && !!last && !following);
  };
  const markStale = () => {
    clearTimeout(staleTimer);
    dot?.element.classList.remove('stale');
    staleTimer = window.setTimeout(
      () => dot?.element.classList.add('stale'),
      STALE_AFTER,
    );
  };
  const paused = () =>
    document.hidden ||
    document.documentElement.classList.contains('navigating');
  const stopWatch = () => {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
  };
  /** Watch while location is on and the page is shown, outside navigation. */
  const sync = () => {
    if (!active || paused()) {
      stopWatch();
      return;
    }
    if (watch !== null) return;
    const id = navigator.geolocation.watchPosition(update, failed, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000,
    });
    // An error delivered at once may have stopped location already.
    if (active && !paused()) watch = id;
    else navigator.geolocation.clearWatch(id);
  };
  const stop = () => {
    stopWatch();
    clearTimeout(staleTimer);
    active = following = quiet = false;
    last = null;
    accuracy?.remove();
    dot?.remove();
    accuracy = dot = null;
    render();
  };
  const start = (follow: boolean, silent: boolean) => {
    active = true;
    following = follow;
    quiet = silent;
    if (!silent) show('Finding your location…');
    render();
    sync();
  };
  function update(position: GeolocationPosition) {
    let view;
    try {
      view = positionView(position);
    } catch {
      return;
    }
    const first = !last;
    last = { ...view, time: Date.now() };
    radius = position.coords.accuracy;
    if (!dot || !accuracy) {
      // The margin of error: a circle of the reported accuracy, in meters.
      accuracy = map.marker(view.center, {
        className: 'location-accuracy-marker',
        html: '<span class="location-accuracy"></span>',
        size: [0, 0],
        anchor: [0, 0],
        z: 1,
      });
      dot = map.marker(view.center, {
        className: 'location-dot',
        size: [22, 22],
        anchor: [11, 11],
        z: 2,
      });
    } else {
      accuracy.setCoord(view.center);
      dot.setCoord(view.center);
    }
    sizeAccuracy();
    markStale();
    if (first && !quiet) show(null);
    // Only a tap on the button makes the map follow the dot.
    if (first && following) map.setView(view.center, view.zoom);
    else if (following) map.panTo(view.center);
    else onFix(view);
    render();
  }
  function failed(error: GeolocationPositionError) {
    if (error.code === 1) {
      const silent = quiet;
      stop();
      if (!silent) show(locationError(1));
      return;
    }
    // Once there is a dot, a slow fix only greys it; started with the page,
    // the watch keeps waiting without a notice.
    if (last || quiet) return;
    stop();
    show(locationError(error.code));
  }

  button.onclick = () => {
    interact();
    if (!element('route-panel').hidden && compactLayout())
      element('panel-toggle').click();
    if (active) {
      following = true;
      if (last) map.setView(last.center, Math.max(map.getZoom(), last.zoom));
      else if (quiet) {
        quiet = false;
        show('Finding your location…');
      }
      render();
      return;
    }
    if (!window.isSecureContext) {
      show(
        'Location requires HTTPS. Open the secure site or choose a point on the map.',
      );
      return;
    }
    if (!navigator.geolocation) {
      show(
        'This browser does not support location. Choose a point on the map.',
      );
      return;
    }
    start(true, false);
  };
  /** The circle's diameter in pixels at the current zoom (capped). */
  function sizeAccuracy() {
    if (!accuracy || !last) return;
    const pixels = Math.min(
      8000,
      (2 * radius) / metersPerPixel(last.center[0], map.getZoom()),
    );
    const circle = accuracy.element.firstElementChild as HTMLElement;
    circle.style.width = circle.style.height = `${pixels}px`;
  }
  map.on('zoom', sizeAccuracy);
  // A pan by the traveler leaves the dot where it is; the button re-centers.
  map.on('dragstart', (event: { originalEvent?: Event }) => {
    if (!event.originalEvent) return;
    if (!following) return;
    following = false;
    render();
  });
  document.addEventListener('visibilitychange', sync);
  // Guided navigation (`html.navigating`) keeps its own watch: two watches
  // overlapping as one starts and the other stops can leave the new one
  // without fixes, so navigation signals before it starts and after it stops.
  document.addEventListener('navigationchange', sync);
  // Already allowed: on with the page, and on or off as the permission changes.
  let permission: PermissionStatus | null = null;
  const follow = () => {
    if (permission?.state === 'granted') {
      if (!active) start(false, true);
    } else if (permission?.state === 'denied' && active) stop();
  };
  void locationPermission().then((status) => {
    permission = status;
    follow();
    status?.addEventListener('change', follow);
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) follow();
  });
  render();
}
