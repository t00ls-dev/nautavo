import type { PlannerMap } from './planner-map';
import { t } from './i18n';
import { defaultView, initialView } from './default-view';
import { authorizedView } from './location';
import { setupUserLocation } from './user-location';
import { compactLayout } from './panel';
import { approximateRegion, defaultRegionUrl, regionUrl } from './services';
import { byId as element } from './dom';

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
  let detectRegion = true;
  let ipRegionUrl = defaultRegionUrl;
  try {
    detectRegion = localStorage.getItem('detect-region') !== 'false';
    ipRegionUrl = regionUrl(
      localStorage.getItem('region-url') ?? defaultRegionUrl,
    );
  } catch {
    /* Defaults work without persistent storage. */
  }
  element<HTMLInputElement>('detect-region').checked = detectRegion;
  element<HTMLInputElement>('region-url').value = ipRegionUrl;
  element<HTMLInputElement>('detect-region').onchange = () => {
    detectRegion = element<HTMLInputElement>('detect-region').checked;
    interact();
    try {
      localStorage.setItem('detect-region', String(detectRegion));
    } catch {
      /* Optional preference. */
    }
  };
  element<HTMLInputElement>('region-url').onchange = () => {
    try {
      ipRegionUrl = regionUrl(
        element<HTMLInputElement>('region-url').value.trim(),
      );
      element<HTMLInputElement>('region-url').setCustomValidity('');
      try {
        localStorage.setItem('region-url', ipRegionUrl);
      } catch {
        /* Optional preference. */
      }
    } catch {
      element<HTMLInputElement>('region-url').setCustomValidity(
        t('Use an HTTPS service URL.'),
      );
      element<HTMLInputElement>('region-url').reportValidity();
    }
  };
  const layout = () => {
    element('fullscreen').setAttribute(
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
  element('fullscreen').onclick = () => {
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
  setupUserLocation(map, interact);
  void initialView({
    hasRoute: route.hasRoute(),
    authorizedPosition: authorizedView,
    approximateRegion: () =>
      !interacted && !route.hasRoute()
        ? approximateRegion(detectRegion, ipRegionUrl)
        : Promise.resolve(null),
    local: () =>
      defaultView(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.languages,
      ),
  }).then((view) => {
    if (!view || interacted || route.hasRoute()) return;
    // On phones the open sheet covers the lower map: the place shows in the
    // part above it.
    const cover =
      compactLayout() && !element('route-panel').hidden
        ? element('sheet').getBoundingClientRect().height
        : 0;
    map.setView(view.center, view.zoom, cover);
  });
}
