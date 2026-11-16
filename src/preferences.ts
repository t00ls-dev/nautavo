/**
 * Everything the app keeps in this browser's Web Storage, in one place.
 * Device preferences live in localStorage, page-session layout in
 * sessionStorage; none of it enters links, saved routes, backups, the JSON
 * editor or requests. Storage may be disabled or full: reads then return
 * null and writes are dropped, and every caller works with its default.
 *
 * Key names are stored data: never rename one without migrating it.
 */
export const PREFERENCE = {
  language: 'language',
  averageSpeed: 'average-speed',
  distanceUnits: 'distance-units',
  temperatureUnits: 'temperature-units',
  autoDeparture: 'auto-departure',
  photonUrl: 'photon-url',
  weatherServer: 'weather-server',
  regionUrl: 'region-url',
  detectRegion: 'detect-region',
  mapLayer: 'map-layer',
  satelliteVintage: 'satellite-vintage',
  routeColoring: 'route-coloring',
  routeArrows: 'route-arrows',
  weatherMarkers: 'weather-markers',
  navigationNotice: 'navigation-notice',
  autoReroute: 'auto-reroute',
  pointPlacement: 'point-placement',
  /** The planner map's center and zoom when the page was last left. */
  lastView: 'last-view',
  /**
   * When this browser last searched Nominatim, to space searches across tabs
   * (a time, no location). The only prefixed key, kept for compatibility.
   */
  lastSearch: 'route-gpx-last-search',
} as const;
export type PreferenceKey = (typeof PREFERENCE)[keyof typeof PREFERENCE];

/** Page-session state in sessionStorage. */
export const SESSION = {
  panelOpen: 'panel-open',
  panelSize: 'panel-size',
  regionAttempted: 'region-attempted',
} as const;
export type SessionKey = (typeof SESSION)[keyof typeof SESSION];

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* Without storage the choice lasts for this page only. */
  }
}

export const readPreference = (key: PreferenceKey): string | null =>
  read(() => localStorage, key);
/** Store a device preference; null removes it (back to the default). */
export const writePreference = (key: PreferenceKey, value: string | null) =>
  write(() => localStorage, key, value);
export const readSession = (key: SessionKey): string | null =>
  read(() => sessionStorage, key);
export const writeSession = (key: SessionKey, value: string) =>
  write(() => sessionStorage, key, value);
