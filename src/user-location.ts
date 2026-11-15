import { metersPerPixel, type MapMarker, type PlannerMap } from './planner-map';
import type { Coord } from './core';
import { locationError, positionView } from './location';
import { byId as element } from './dom';
import { compactLayout } from './panel';

/** A fix older than this greys the dot: the position may have moved on. */
const STALE_AFTER = 30_000;
const NOTICE_TIME = 8_000;

/**
 * Use my location on the planner map: after the explicit tap, a blue
 * dot follows the device with its accuracy circle, like a maps app. The map
 * follows the dot until the traveler pans it; the button then re-centers, and
 * a tap while following turns location off. Positions stay in page memory
 * only: never in links, storage or requests, and the watch stops while the
 * page is hidden.
 */
export function setupUserLocation(map: PlannerMap, interact: () => void): void {
  const button = element<HTMLButtonElement>('locate');
  const notice = element('location-notice');
  let accuracy: MapMarker | null = null;
  let dot: MapMarker | null = null;
  let radius = 0;
  let watch: number | null = null;
  let active = false;
  let following = false;
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
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('locating', active && !last);
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
  const stopWatch = () => {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
  };
  const stop = () => {
    stopWatch();
    clearTimeout(staleTimer);
    active = following = false;
    last = null;
    accuracy?.remove();
    dot?.remove();
    accuracy = dot = null;
    render();
  };
  const update = (position: GeolocationPosition) => {
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
    if (first) {
      show(null);
      map.setView(view.center, view.zoom);
    } else if (following) map.panTo(view.center);
    render();
  };
  const failed = (error: GeolocationPositionError) => {
    // Once there is a dot, a slow fix only greys it; denial always stops.
    if (last && error.code !== 1) return;
    stop();
    show(locationError(error.code));
  };
  const startWatch = () => {
    stopWatch();
    watch = navigator.geolocation.watchPosition(update, failed, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000,
    });
  };

  button.onclick = () => {
    interact();
    if (active && following) {
      stop();
      return;
    }
    if (!element('route-panel').hidden && compactLayout())
      element('panel-toggle').click();
    if (active) {
      following = true;
      if (last) map.setView(last.center, Math.max(map.getZoom(), last.zoom));
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
    active = following = true;
    show('Finding your location…');
    render();
    startWatch();
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
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) stopWatch();
    else startWatch();
  });
  window.addEventListener('pagehide', stop);
  render();
}
