import type { PlannerMap } from './planner-map';
import {
  defaultView,
  initialView,
  parseView,
  serializeView,
} from './default-view';
import { locationPermission } from './location';
import type { View } from './default-view';
import { setupUserLocation } from './user-location';
import { compactLayout } from './panel';
import { approximateRegion } from './search';
import { byId as $ } from './dom';
import { PREFERENCE, readPreference, writePreference } from './preferences';

export function setupMapView(
  map: PlannerMap,
  route: {
    hasRoute: () => boolean;
  },
): void {
  let interacted = false;
  const interact = () => {
    interacted = true;
  };
  // Input and map gestures supersede startup work, including address edits without coordinates.
  document.addEventListener('input', interact, { once: true });
  for (const type of ['dragstart', 'zoomstart', 'click'])
    map.on(type, (event: { originalEvent?: Event }) => {
      if (event.originalEvent) interact();
    });
  let detectRegion = readPreference(PREFERENCE.detectRegion) !== 'false';
  $<HTMLInputElement>('detect-region').checked = detectRegion;
  $<HTMLInputElement>('detect-region').onchange = () => {
    detectRegion = $<HTMLInputElement>('detect-region').checked;
    interact();
    writePreference(PREFERENCE.detectRegion, String(detectRegion));
  };
  const layout = () => {
    $('fullscreen').setAttribute(
      'aria-pressed',
      String(document.body.classList.contains('map-fullscreen')),
    );
    requestAnimationFrame(() => map.resize());
  };
  layout();
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle(
      'map-fullscreen',
      !!document.fullscreenElement,
    );
    layout();
  });
  $('fullscreen').onclick = () => {
    const container = document.querySelector<HTMLElement>('.map-container')!;
    const fallback = () => {
      document.body.classList.toggle('map-fullscreen');
      layout();
    };
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(fallback);
    else if (document.body.classList.contains('map-fullscreen')) fallback();
    else if (container.requestFullscreen)
      void container.requestFullscreen().catch(fallback);
    else fallback();
  };
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.fullscreenElement) {
      document.body.classList.remove('map-fullscreen');
      layout();
    }
  });
  /** On phones, the height of the open sheet covering the bottom of the map. */
  const cover = () =>
    compactLayout() && !$('route-panel').hidden
      ? $('sheet').getBoundingClientRect().height
      : 0;
  /** Show a startup view; on phones, in the part of the map above the sheet. */
  const frame = (view: View) => map.setView(view.center, view.zoom, cover());
  // With location already allowed, the device's fixes open the map on it,
  // again as a fix gets more precise, until the traveler moves the map.
  let framedZoom = 0;
  setupUserLocation(map, interact, (view) => {
    if (interacted || route.hasRoute() || view.zoom <= framedZoom) return;
    framedZoom = view.zoom;
    frame(view);
  });
  // Where the map is left, for the next visit when the browser cannot tell
  // whether location is allowed. On this device only; never sent.
  // The map's own camera, restored exactly as it was (`restored` below): no
  // sheet arithmetic, which the browser's changing toolbars on phones can
  // throw off, moving the place a little on every visit.
  const saveView = () =>
    writePreference(
      PREFERENCE.lastView,
      serializeView({ center: map.getCenter(), zoom: map.getZoom() }),
    );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveView();
  });
  window.addEventListener('pagehide', saveView);
  let restored: View | null = null;
  void initialView({
    hasRoute: route.hasRoute(),
    permission: async () => (await locationPermission())?.state ?? null,
    lastView: () => (restored = parseView(readPreference(PREFERENCE.lastView))),
    approximateRegion: () =>
      !interacted && !route.hasRoute()
        ? approximateRegion(detectRegion)
        : Promise.resolve(null),
    local: () =>
      defaultView(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.languages,
      ),
  }).then((view) => {
    if (!view || interacted || route.hasRoute()) return;
    // The last view comes back as it was left; a place is framed above the sheet.
    if (view === restored) map.setView(view.center, view.zoom);
    else frame(view);
  });
}
