import { departureOf } from './departure';
import { RoutingCache } from './routing-cache';
import { setupWeather } from './weather-ui';
import { renderDaylight } from './daylight-ui';
import {
  listSavedRoutes,
  saveNamedRoute,
  deleteSavedRoute,
  exportRouteBackup,
  parseRouteBackup,
  importRouteBackup,
  savedRouteKey,
  markDirectionsChecked,
  updateSavedSteps,
  type SavedRoute,
} from './saved-routes';
import { missingDirections, sameRoad } from './directions';
import { legDistances } from './track-position';
import {
  speedToKmh,
  speedFromKmh,
  travelTimeSeconds,
  speedInputBounds,
  snapSpeed,
  speedNotches,
  convertSpeedUnits,
  storedSpeedKmh,
  rememberSpeedKmh,
} from './travel-time';
import {
  distanceLabel,
  milepostLabel,
  shortDistanceLabel,
  stepDistanceLabel,
} from './units';
import { UndoHistory } from './history';
import {
  getLanguage,
  isLanguage,
  observeTranslations,
  preferredLanguage,
  rememberLanguage,
  setLanguage,
  t,
  type Language,
} from './i18n';
import { languageQuery } from './seo';
import {
  markHomeScreenApp,
  registerServiceWorker,
  watchConnection,
} from './offline';
import './style.css';
import {
  defaults,
  decodeState,
  encodeState,
  filename,
  generateGpx,
  highways,
  importTrackFile,
  linkServerOverrides,
  localSections,
  meters,
  parseCoordinates,
  serverUrl,
  validateState,
  type Coord,
  type Point,
  type Route,
  type ServerUrls,
  type State,
} from './core';
import { PREFERENCE, readPreference, writePreference } from './preferences';
import {
  calculate,
  defaultPhotonUrl,
  osrmMatch,
  searchAddress,
} from './services';
import {
  isImportedRoute,
  legsAt,
  rememberLegs,
  routeKeepingLegs,
} from './track-legs';
import {
  canShareFiles,
  exportFile,
  GPX_TYPES,
  JSON_TYPES,
  sharesFirst,
} from './share-file';
import { setupPointMenu } from './point-menu';
import { setupNavigation } from './navigation-ui';
import { setupHomeScreen } from './home-screen';
import { setupElevation } from './elevation-ui';
import { setupSurface } from './surface-ui';
import { SURFACE_KINDS } from './surface';
import { gradeRanges } from './elevation';
import { setupRouteOverlays } from './route-overlays';
import {
  repeatsFor,
  routePieces,
  setupRouteMarks,
  splitByRepeat,
} from './route-marks';
import { lineFeature, PlannerMap, RANK, type MapMarker } from './planner-map';
import { PASS_OFFSET } from './route-overlays';
import { routeDaylight } from './daylight';
import { addressAutocomplete } from './autocomplete';
import { setupMapView } from './map-view';
import { defaultView } from './default-view';
import { setupMapLayers } from './map-layers';
import { moveItem, setupPointOrder } from './point-order';
import { gpsPoint, getPosition, locationError, positionView } from './location';
import {
  createCrosshair,
  createLoupe,
  placementMode,
  rememberPlacementMode,
  type PlacementMode,
} from './point-placement';
import { setupMapControls } from './map-controls';
import { compactLayout, setupPanel } from './panel';
import { icon, iconControl } from './icons';
import {
  maneuverIcon,
  maneuverPositions,
  maneuverText,
  shortRoadName,
} from './maneuvers';
import { byId as $, optionalById } from './dom';
import {
  chosenDistanceUnits,
  chosenTemperatureUnits,
  detectedUnits,
  distanceUnits,
  rememberDistanceUnits,
  rememberTemperatureUnits,
  type DistanceChoice,
  type TemperatureChoice,
} from './unit-preferences';
const text = (tag: string, value: string, className = '') => {
  const e = document.createElement(tag);
  e.textContent = value;
  e.className = className;
  return e;
};
// Footer links: Help, What's new and the repository, each with its icon.
$('help').prepend(icon('help'));
$('changelog').prepend(icon('news'));
$('github').prepend(icon('github'));
let state: State = defaults(),
  selected = 0,
  current: Route | null = null,
  revision = 0,
  // The route a load asked to frame; edits keep the user's view (#117).
  fitRevision = -1,
  timer: ReturnType<typeof setTimeout>;
function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
/**
 * Edit lock, kept in page memory only. Every route edit entry point checks
 * `editBlocked()`; viewing, export and sharing stay available.
 */
let locked = false;
function editBlocked(): boolean {
  if (!locked) return false;
  status('Route locked. Unlock editing to change it.', true);
  return true;
}
let linkServers: ServerUrls | null = null;
/**
 * Servers suggested by a link are used only after an explicit choice: the
 * route opens with the default servers, so a crafted link cannot send the
 * visitor's requests elsewhere.
 */
function fromLink(next: State): State {
  linkServers = linkServerOverrides(next);
  $('server-notice').hidden = !linkServers;
  if (!linkServers) return next;
  const initial = defaults();
  const hosts = (['osrm', 'valhalla', 'nominatim'] as const)
    .filter((key) => next[key] !== initial[key])
    .map((key) => new URL(next[key]).host);
  $('server-notice-text').textContent =
    `This link suggests other routing servers: ${[...new Set(hosts)].join(', ')}. The route uses the default servers.`;
  return {
    ...next,
    osrm: initial.osrm,
    valhalla: initial.valhalla,
    nominatim: initial.nominatim,
  };
}
// `?lang=` names the page's language (one indexable URL per language); it
// wins over the language in a route link and the device preference.
const linkedLanguage = new URLSearchParams(location.search).get('lang');
try {
  state = fromLink(decodeState(location.hash));
} catch {
  status('This route link is invalid. Start a new route below.', true);
}
$('use-link-servers').onclick = () => {
  if (!linkServers || editBlocked()) return;
  Object.assign(state, linkServers);
  linkServers = null;
  $('server-notice').hidden = true;
  settings();
  changed();
};
$('keep-default-servers').onclick = () => {
  linkServers = null;
  $('server-notice').hidden = true;
};
/** Language is a preference, not a route edit, so undo never reverts it. */
const routeSnapshot = (s: State): State => ({ ...s, language: undefined });
/** Each undo step keeps the route shown for it, so undoing restores that exact geometry. */
const undoHistory = new UndoHistory<State, Route>(routeSnapshot(state));
let drafts = new WeakMap<Point, string>();
const dirty = new Set<Point>();
const lookupVersions = new WeakMap<Point, number>();
const routingCache = new RoutingCache();
/** The last displayed imported track and the points it was shown for. */
let trackBase: { route: Route; points: Coord[] } | null = null;
let savedEntries: SavedRoute[] = [];
let libraryRevision = 0;
let savingRoute = false;
let photonUrl = defaultPhotonUrl;
try {
  photonUrl = serverUrl(
    readPreference(PREFERENCE.photonUrl) ?? defaultPhotonUrl,
  );
} catch {
  /* An invalid stored URL falls back to the default. */
}
$<HTMLInputElement>('photon').value = photonUrl;
let autocompleteCleanups: (() => void)[] = [];
const localView = defaultView(
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  navigator.languages,
);
const map = new PlannerMap($('map'), localView.center, localView.zoom);
if (import.meta.env.DEV)
  (window as unknown as { plannerMap: PlannerMap }).plannerMap = map;
/** Route point markers on the map. */
let markers: MapMarker[] = [];
/** The route line: a white casing under the route color, per base map. */
const ROUTE_COLORS: Record<string, string> = {
  standard: '#12796e',
  topographic: '#174cbd',
  satellite: '#b61f64',
};
const setRouteLine = map.overlay('rg-route', RANK.route, () => {
  // Out-and-back stretches are thinner lines offset to the right of travel.
  const pass = (repeated: number, normal: number) =>
    ['case', ['get', 'repeated'], repeated, normal] as unknown as number;
  return [
    {
      id: 'rg-route-casing',
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#fff',
        'line-opacity': 0.95,
        'line-width': pass(6, 8),
        'line-offset': pass(PASS_OFFSET, 0),
      },
    },
    {
      id: 'rg-route-line',
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color':
          ROUTE_COLORS[document.body.dataset.mapLayer ?? 'standard'] ??
          ROUTE_COLORS.standard,
        'line-width': pass(3, 4),
        'line-offset': pass(PASS_OFFSET, 0),
      },
    },
  ];
});
const line = { clearLayers: () => setRouteLine([]) };
// Moving a point precisely under the finger (Settings): a loupe while a
// marker is dragged by touch, or a fixed marker over a panning map.
const loupe = createLoupe(map);
const crosshair = createCrosshair(map);
/** The point being placed with the crosshair, drawn by it, not as a marker. */
let adjusting: Point | null = null;
let touchDrag = false;
map.container.addEventListener(
  'pointerdown',
  (event) => (touchDrag = event.pointerType !== 'mouse'),
  { capture: true, passive: true },
);
/**
 * Places `point` with the crosshair: from its marker (Settings) or from Choose
 * on map in its field, which starts at the map center when the point is empty
 * and names it by its role, so the field shows the coordinates.
 */
function adjustPoint(point: Point, fromField = false) {
  const i = state.points.indexOf(point);
  const start: Coord | null =
    point.coord && !dirty.has(point)
      ? point.coord
      : fromField
        ? map.getCenter()
        : null;
  if (i < 0 || !start || editBlocked()) return;
  if (!$('route-panel').hidden && compactLayout()) $('panel-toggle').click();
  adjusting = point;
  renderMarkers();
  crosshair.start(start, i + 1, (coord) => {
    adjusting = null;
    const index = state.points.indexOf(point);
    if (coord && index >= 0 && !editBlocked()) {
      selected = index;
      setPoint(point, index, coord, fromField ? pointLabel(index) : undefined);
    } else renderMarkers();
  });
}
/**
 * My location in a point's field: one position on this explicit choice,
 * at full precision, never stored apart from the
 * route point it sets.
 */
function useMyLocation(point: Point) {
  if (editBlocked()) return;
  if (!navigator.geolocation || !window.isSecureContext) {
    status(locationError(2), true);
    return;
  }
  status('Finding your location…');
  const before = revision;
  getPosition()
    .then((position) => {
      const index = state.points.indexOf(point);
      // A later edit wins over a late position.
      if (index < 0 || revision !== before || editBlocked()) return;
      const coord = gpsPoint(positionView(position).center);
      setPoint(point, index, coord, pointLabel(index));
      map.panTo(coord);
    })
    .catch((error: GeolocationPositionError | Error) => {
      if (revision === before)
        status(locationError('code' in error ? error.code : 2), true);
    });
}
/** Distance shown beside a suggestion: from the point before it, or after. */
function suggestionDistance(point: Point, coord: Coord): string | null {
  const i = state.points.indexOf(point);
  const known = (p: Point | undefined) =>
    p && p !== point && p.coord && !dirty.has(p) ? p.coord : null;
  let reference: Coord | null = null;
  for (let j = i - 1; j >= 0 && !reference; j--)
    reference = known(state.points[j]);
  for (let j = i + 1; j < state.points.length && !reference; j++)
    reference = known(state.points[j]);
  return reference
    ? stepDistanceLabel(
        meters(reference, coord),
        distanceUnits(),
        state.language === 'pt' ? 'pt-BR' : 'en',
      )
    : null;
}
// Maneuver chosen in the itinerary, shown until the next map click or route.
let maneuver: MapMarker | null = null;
const maneuverLayer = {
  clearLayers() {
    maneuver?.remove();
    maneuver = null;
  },
};
map.on('click', () => maneuverLayer.clearLayers());
function showManeuver(coord: Coord) {
  if (!$('route-panel').hidden && compactLayout()) $('panel-toggle').click();
  map.stop();
  map.setView(coord, Math.max(map.getZoom(), 16));
  maneuverLayer.clearLayers();
  maneuver = map.marker(coord, {
    className: 'maneuver-marker',
    size: [24, 24],
    anchor: [12, 12],
    z: 3,
  });
}
/** The traveler's average speed (km/h): a device preference, changed only by the user. */
let speedKmh = storedSpeedKmh(distanceUnits());
/** Distance units the speed was last shown in, for converting it on a change. */
let previousUnits = distanceUnits();
const weather = setupWeather(
  map,
  () => state,
  () => current,
  syncUrl,
  () => speedKmh,
);
/** Recorded `<ele>` of imported GPX routes, in page memory only. */
const recordedElevation = new WeakMap<Route, (number | null)[][]>();
const elevation = setupElevation(map, {
  state: () => state,
  endpoint: () => weather.endpoint(),
  recorded: (route) => recordedElevation.get(route),
  speed: () => speedKmh,
  // The Grade coloring is an explicit choice that needs the profile too.
  wanted: () => overlays.active() === 'grade',
  onProfile: () => overlays.refresh(),
});
const surface = setupSurface(map, {
  state: () => state,
  // The Surface coloring is an explicit choice that needs it too.
  wanted: () => overlays.active() === 'surface',
  onSurface: () => overlays.refresh(),
});
const overlays = setupRouteOverlays(map, {
  route: () => current,
  repeats: {
    of: repeatsFor,
    split: splitByRepeat,
  },
});
const marks = setupRouteMarks(map, {
  route: () => current,
});
const departureTime = () =>
  departureOf(state) ? Date.parse(departureOf(state)!) : NaN;
overlays.register({
  id: 'grade',
  label: 'Grade',
  legend: [
    { kind: 'steep-down', label: 'Steep descent (8%+)' },
    { kind: 'down', label: 'Descent (3–8%)' },
    { kind: 'flat', label: 'Flat (under 3%)' },
    { kind: 'up', label: 'Climb (3–8%)' },
    { kind: 'steep-up', label: 'Steep climb (8%+)' },
  ],
  unavailable: () => null,
  // A compact color scale on the map; the ranges above are read out in full.
  scale: {
    start: 'slope-down',
    end: 'slope-up',
    limits: ['−8%', '−3%', '+3%', '+8%'],
  },
  // Drawn once the elevation profile arrives (requested on this choice).
  ranges: () => {
    const loaded = elevation.profile();
    return loaded ? gradeRanges(loaded.profile, loaded.source) : [];
  },
  activate: () => elevation.want(),
});
overlays.register({
  id: 'surface',
  label: 'Surface',
  // Paved and unpaved; Unknown only when the route has unmatched stretches.
  get legend() {
    const present = new Set(surface.ranges()?.map((r) => r.kind));
    return SURFACE_KINDS.filter(
      ({ kind }) => kind !== 'unknown' || present.has(kind),
    );
  },
  unavailable: () => null,
  // Drawn once the road attributes arrive (requested on this choice).
  ranges: () => surface.ranges() ?? [],
  activate: () => surface.want(),
});
overlays.register({
  id: 'daylight',
  label: 'Daylight',
  legend: [
    { kind: 'day', label: 'Day' },
    { kind: 'twilight', label: 'Twilight' },
    { kind: 'night', label: 'Dark' },
  ],
  unavailable: () =>
    Number.isFinite(departureTime()) ? null : 'Choose a departure date',
  ranges: (route) => routeDaylight(route, departureTime(), speedKmh).ranges,
});
// Registered after the weather handler, which stores the new departure first.
$('departure').addEventListener('change', () => {
  if (current) renderSummary(current);
  else renderDaylight(state, null, speedKmh);
});
new ResizeObserver(() => map.resize()).observe($('map'));
function fit() {
  const pts =
    current?.segments.flat() ??
    state.points.flatMap((p) => (p.coord ? [p.coord] : []));
  if (pts.length) {
    // The bottom sheet covers the lower part of the map on phones.
    const compact = compactLayout();
    const bottom = compact
      ? $('sheet').getBoundingClientRect().height + 30
      : 70;
    map.fit(pts, {
      padding: { left: 45, top: compact ? 125 : 60, right: 76, bottom },
      maxZoom: 14,
    });
  }
}
/** Help and What's new open in the chosen language and keep the route for Back to map. */
function pageLinks(lang: Language, hash: string) {
  $<HTMLAnchorElement>('help').href = `./help.html?lang=${lang}${hash}`;
  $<HTMLAnchorElement>('changelog').href =
    `./changelog.html?lang=${lang}${hash}`;
}
function syncUrl() {
  updateSaveButton();
  undoHistory.record(routeSnapshot(state));
  const hash = encodeState(state);
  $<HTMLButtonElement>('undo').disabled =
    locked || (!undoHistory.canUndo && !dirty.size);
  history.replaceState(
    null,
    '',
    location.pathname + languageQuery(getLanguage()) + hash,
  );
  pageLinks(getLanguage(), hash);
}
function settings() {
  weather.syncInputs();
  const input = $<HTMLInputElement>('average-speed');
  const bounds = speedInputBounds(distanceUnits());
  const notches = speedNotches(distanceUnits());
  const value = snapSpeed(
    speedFromKmh(speedKmh, distanceUnits()),
    distanceUnits(),
  );
  // The slider moves through the notches: fine at low speeds, coarser above.
  input.min = '0';
  input.max = String(notches.length - 1);
  input.step = '1';
  input.value = String(notches.indexOf(value));
  input.setAttribute('aria-valuemin', '1');
  input.setAttribute('aria-valuemax', String(bounds.max));
  showSpeed(value);
  $('speed-range').textContent =
    `1–${bounds.max} ${distanceUnits() === 'imperial' ? 'mph' : 'km/h'}`;
  $('speed-unit').textContent = distanceUnits() === 'imperial' ? 'mph' : 'km/h';
  unitSelects();
  for (const key of ['osrm', 'valhalla', 'nominatim'] as const)
    $<HTMLInputElement>(key).value = state[key];
  $<HTMLInputElement>('route-name').value = state.name;
  $<HTMLInputElement>('prefer').checked = state.prefer;
}
function pointLabel(i: number): string {
  return i === 0
    ? 'Start'
    : i === state.points.length - 1
      ? 'Destination'
      : `Stop ${i}`;
}
function selectPoint(i: number, showMap = false) {
  selected = i;
  updateSelection();
  renderMarkers();
  if (showMap) {
    $('map').scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (state.points[i].coord) map.panTo(state.points[i].coord!);
  }
}
function updateSelection() {
  $('points')
    .querySelectorAll('li')
    .forEach((row, i) => {
      row.classList.toggle('selected', i === selected);
      row
        .querySelector('button')
        ?.setAttribute('aria-pressed', String(i === selected));
    });
  // A sentence, not the field label: "Set the start on the map".
  const target =
    selected === 0
      ? 'the start'
      : selected === state.points.length - 1
        ? 'the destination'
        : `stop ${selected}`;
  // Phones set points by typing or by moving markers, so their map has no
  // hint unless the route is locked.
  const note = $('map-note');
  note.hidden = !locked && matchMedia('(pointer: coarse)').matches;
  note.textContent = locked
    ? 'Route locked. Unlock editing to change it.'
    : `Set ${target} on the map`;
  $<HTMLButtonElement>('undo').disabled =
    locked || (!undoHistory.canUndo && !dirty.size);
  $<HTMLButtonElement>('calculate').disabled =
    locked || state.points.some((p) => !p.coord) || dirty.size > 0;
}
function setPoint(
  point: Point,
  index: number,
  coord: Coord,
  name?: string,
  preserveEditor = false,
) {
  point.coord = coord;
  if (name) point.name = name;
  drafts.delete(point);
  dirty.delete(point);
  const next = state.points.findIndex((p, i) => i > index && !p.coord);
  if (next >= 0) selected = next;
  changed(preserveEditor);
  if (preserveEditor) {
    const input = $<HTMLInputElement>(`location-${index}`);
    input.value = pointValue(point);
    input.removeAttribute('aria-invalid');
    $(`point-results-${index}`).replaceChildren();
  }
}
function pointValue(point: Point): string {
  return (
    drafts.get(point) ??
    (point.coord
      ? /^(Start|Destination|Stop \d+|Point \d+|Return to start)$/.test(
          point.name,
        )
        ? point.coord.map((n) => n.toFixed(6)).join(', ')
        : point.name
      : '')
  );
}
function renderPoints() {
  const list = $('points');
  const scroll = list.scrollTop;
  autocompleteCleanups.forEach((close) => close());
  autocompleteCleanups = [];
  list.replaceChildren();
  $('point-count').textContent = `${state.points.length} points`;
  state.points.forEach((point, i) => {
    const row = document.createElement('li');
    row.className = i === selected ? 'selected' : '';
    const choose = text(
      'button',
      String(i + 1),
      'point-number',
    ) as HTMLButtonElement;
    choose.type = 'button';
    choose.setAttribute('aria-label', `Select point ${i + 1}`);
    choose.setAttribute('aria-pressed', String(i === selected));
    choose.title = 'Set on map';
    choose.onclick = () => selectPoint(i, true);
    const fields = document.createElement('div');
    fields.className = 'point-fields';
    const label = text('label', pointLabel(i));
    label.setAttribute('for', `location-${i}`);
    const form = document.createElement('form');
    form.className = 'point-location-form';
    const input = document.createElement('input');
    input.id = `location-${i}`;
    input.value = pointValue(point);
    // The point's role, which the list no longer shows as a label; short
    // enough for the field at 320 px (tests/point-order.spec.ts).
    input.placeholder =
      i === 0
        ? 'Starting point'
        : i === state.points.length - 1
          ? 'Destination'
          : 'Add a stop';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Location of point ${i + 1}`);
    input.enterKeyHint = 'search';
    input.readOnly = locked;
    const results = document.createElement('div');
    results.id = `point-results-${i}`;
    results.className = 'point-results';
    // A named group: aria-label is not allowed on a plain div.
    results.setAttribute('role', 'group');
    results.setAttribute('aria-label', `Results for point ${i + 1}`);
    const suggestions = document.createElement('div');
    suggestions.id = `suggestions-${i}`;
    suggestions.className = 'point-results suggestions';
    suggestions.setAttribute('aria-label', `Results for point ${i + 1}`);
    const closeSuggestions = addressAutocomplete(input, suggestions, {
      base: () => photonUrl,
      center: () => map.getCenter(),
      valid: () => state.points[i] === point && input.isConnected,
      choose: (result) => {
        if (editBlocked()) return;
        const coord = parseCoordinates(`${result.lat},${result.lon}`);
        if (!coord) return;
        setPoint(point, i, coord, result.display_name.slice(0, 240), true);
        map.panTo(coord);
      },
      pending: () => status('Searching…'),
      completed: (count) =>
        status(
          count
            ? 'Choose a place.'
            : 'No suggestions found. Press Enter to search with Nominatim.',
        ),
      failed: () =>
        status(
          'Suggestions unavailable. Press Enter to search with Nominatim.',
        ),
      actions: () => [
        {
          label: 'My location',
          icon: 'locate',
          run: () => useMyLocation(point),
        },
        {
          label: 'Choose on map',
          icon: 'pin',
          run: () => adjustPoint(point, true),
        },
      ],
      distance: (coord) => suggestionDistance(point, coord),
    });
    autocompleteCleanups.push(closeSuggestions);
    let coordinateTimer: ReturnType<typeof setTimeout>;
    let addressTimer: ReturnType<typeof setTimeout>;
    function commitCoordinates() {
      if (state.points[i] !== point || !input.isConnected) return false;
      const c = parseCoordinates(input.value);
      if (!c) return false;
      clearTimeout(coordinateTimer);
      if (
        !dirty.has(point) &&
        point.coord &&
        point.coord[0] === c[0] &&
        point.coord[1] === c[1]
      )
        return true;
      setPoint(point, i, c, pointLabel(i), true);
      return true;
    }
    input.onfocus = () => selectPoint(i);
    input.oninput = () => {
      drafts.set(point, input.value);
      dirty.add(point);
      selected = i;
      revision++;
      clearTimeout(timer);
      current = null;
      weather.invalidate();
      updateSaveButton();
      line.clearLayers();
      clearSummary();
      $<HTMLButtonElement>('download').disabled = true;
      results.replaceChildren();
      input.removeAttribute('aria-invalid');
      updateSelection();
      renderMarkers();
      clearTimeout(coordinateTimer);
      if (parseCoordinates(input.value))
        coordinateTimer = setTimeout(commitCoordinates, 600);
      status('Enter a place, or paste coordinates.');
    };
    input.onchange = () => {
      commitCoordinates();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      closeSuggestions();
      if (editBlocked()) return;
      if (commitCoordinates()) return;
      const q = input.value.trim();
      if (q.length < 3) {
        input.setAttribute('aria-invalid', 'true');
        status('Enter a place or valid coordinates.', true);
        return;
      }
      if (/^[\s(+-]*\d/.test(q) && /[,;]/.test(q)) {
        input.setAttribute('aria-invalid', 'true');
        status(
          'Invalid coordinates. Use latitude, longitude (for example: -22.90, -43.18).',
          true,
        );
        return;
      }
      const version = (lookupVersions.get(point) ?? 0) + 1;
      lookupVersions.set(point, version);
      status('Searching…');
      results.replaceChildren();
      clearTimeout(addressTimer);
      addressTimer = setTimeout(() => {
        void searchAddress(q, state.nominatim)
          .then((matches) => {
            if (
              version !== lookupVersions.get(point) ||
              state.points[i] !== point ||
              input.value.trim() !== q
            )
              return;
            if (!matches.length) {
              status(
                'No address found. Try a nearby street, city, or coordinates.',
                true,
              );
              return;
            }
            matches.forEach((r) => {
              const b = text('button', r.display_name) as HTMLButtonElement;
              b.type = 'button';
              b.onclick = () => {
                if (editBlocked()) return;
                const c = parseCoordinates(`${r.lat},${r.lon}`);
                if (!c) {
                  status('Search returned invalid coordinates.', true);
                  return;
                }
                setPoint(
                  point,
                  i,
                  c,
                  r.display_name.split(',').slice(0, 2).join(',').slice(0, 240),
                  true,
                );
                map.panTo(c);
              };
              results.append(b);
            });
            status('Choose a place.');
          })
          .catch(() => {
            if (version === lookupVersions.get(point))
              status(
                'Address search unavailable. Try again later or paste coordinates.',
                true,
              );
          });
      }, 500);
    };
    form.append(input);
    fields.append(label, form, suggestions, results);
    // The grip sits inside the field, at its end: drag it, or focus it and
    // use the arrow keys (src/point-order.ts).
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'point-grip';
    iconControl(grip, 'grip', `Move point ${i + 1}`, true);
    grip.title = 'Drag or use the arrow keys to reorder';
    grip.disabled = locked;
    form.append(grip);
    const remove = text('button', '×') as HTMLButtonElement;
    remove.type = 'button';
    remove.className = 'point-remove';
    iconControl(remove, 'close', `Remove point ${i + 1}`, true);
    remove.disabled = locked || state.points.length <= 2;
    remove.onclick = () => {
      if (editBlocked()) return;
      dirty.delete(point);
      state.points.splice(i, 1);
      selected = Math.min(selected, state.points.length - 1);
      changed();
    };
    row.append(choose, fields, remove);
    list.append(row);
  });
  list.scrollTop = scroll;
  renderMarkers();
  updateSelection();
  $<HTMLButtonElement>('add').disabled = locked || state.points.length >= 50;
}
setupPointOrder($('points'), {
  enabled: () => !locked,
  start: () => autocompleteCleanups.forEach((close) => close()),
  moved: (from, to) => {
    if (editBlocked()) return;
    // The selection stays with its point.
    const chosen = state.points[selected];
    moveItem(state.points, from, to);
    selected = Math.max(0, state.points.indexOf(chosen));
    changed();
  },
});
function renderMarkers() {
  // Locking, undo or removing the point ends its placement (its callback
  // draws the markers again, so this comes before clearing them).
  if (
    crosshair.active &&
    (locked || !adjusting || !state.points.includes(adjusting))
  )
    crosshair.cancel();
  for (const m of markers) m.remove();
  markers = [];
  const mode = placementMode();
  state.points.forEach((p, i) => {
    if (!p.coord || dirty.has(p) || p === adjusting) return;
    const head = document.createElement('span');
    head.append(text('b', String(i + 1)));
    // The point's name on hover and focus, as a tooltip.
    const tip = text('div', t(p.name));
    tip.className = 'marker-tooltip';
    const m = map.marker(p.coord, {
      className: `route-marker ${i === selected ? 'active' : ''}`,
      html: head,
      size: [30, 38],
      anchor: [15, 36],
      draggable: !locked && mode !== 'crosshair',
      interactive: true,
      z: 6,
    });
    m.element.append(tip);
    m.element.setAttribute('aria-label', t(p.name));
    markers.push(m);
    // A drag ends with a click on the marker; that click is not a selection.
    let dragged = false;
    m.element.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dragged) {
        dragged = false;
        return;
      }
      selectPoint(i);
      if (mode === 'crosshair' && !locked) adjustPoint(p);
    });
    m.on('dragstart', () => {
      dragged = true;
      if (mode === 'loupe' && touchDrag) loupe.move(m.getCoord());
    });
    if (mode === 'loupe')
      m.on('drag', () => {
        if (touchDrag) loupe.move(m.getCoord());
      });
    m.on('dragend', () => {
      loupe.hide();
      selected = i;
      setPoint(p, i, m.getCoord());
      // The click that may follow a mouse drag comes at once, if at all.
      setTimeout(() => (dragged = false), 0);
    });
  });
}
function drawRoute(route: Route) {
  // Stretches travelled twice in opposite directions become two parallel
  // lines, each offset to the right of its own direction (visual only).
  setRouteLine(
    routePieces(route).map(({ repeated, coords }) =>
      lineFeature(coords, { repeated }),
    ),
  );
}
function clearSummary() {
  $('summary').hidden = true;
  $('route-details').hidden = true;
  $('peek-main').textContent = '';
  for (const id of ['summary-content', 'summary-notes', 'itinerary'])
    $(id).replaceChildren();
  renderDaylight(state, null, speedKmh);
  maneuverLayer.clearLayers();
  elevation.setRoute(null);
  surface.setRoute(null);
  overlays.refresh();
  marks.refresh();
}
const ROAD_CHANGED =
  'Directions not added: the road has changed. Calculate route to update it.';
/** Routes already asked for directions, so reopening never asks again. */
const directionsTried = new WeakSet<Route>();
/** Progress or outcome of a directions request, per route. */
const directionsStatus = new WeakMap<Route, string>();
/** Itinerary open across re-renders (language, units, new directions). */
let itineraryOpen = false;
/** The saved entry the shown route came from, to store added directions. */
let savedOrigin: { id: string; route: Route } | null = null;

/**
 * Adds missing turn directions without changing the geometry: map matching
 * for an imported track, or one step-only route request for a route saved
 * before directions existed (kept only when it follows the same road).
 */
async function addDirections(route: Route) {
  const need = missingDirections(route);
  if (!need || directionsTried.has(route)) return;
  directionsTried.add(route);
  const version = revision;
  const shown = () => current === route && revision === version;
  const show = (message: string) => {
    directionsStatus.set(route, message);
    const element = optionalById('directions-status');
    if (element && shown()) {
      element.textContent = t(message);
      element.hidden = false;
    }
  };
  show('Finding directions…');
  try {
    let steps: Route['steps'] | null;
    if (need === 'match')
      // Traces restart at every route point, so after an edit only the legs
      // next to the changed point are requested again; the rest is cached.
      steps = await osrmMatch(
        state.osrm,
        route.segments,
        legDistances(
          route.segments,
          state.points.flatMap((p) => (p.coord ? [p.coord] : [])),
        ),
        shown,
        (done, all) => show(`Finding directions… ${done}/${all}`),
      );
    else {
      const fresh = await calculate(structuredClone(state), shown);
      steps = sameRoad(route, fresh) ? fresh.steps : null;
    }
    if (!shown()) return;
    if (steps) {
      route.steps = steps;
      directionsStatus.delete(route);
      if (savedOrigin?.route === route)
        void updateSavedSteps(savedOrigin.id, route)
          .then(() => refreshSavedRoutes())
          .catch(() => {
            /* Directions still show; the saved entry keeps its old steps. */
          });
    } else {
      directionsStatus.set(route, ROAD_CHANGED);
      // Remembered in the saved entry: reopening does not ask again.
      if (savedOrigin?.route === route)
        void markDirectionsChecked(savedOrigin.id)
          .then(() => refreshSavedRoutes())
          .catch(() => {
            /* Only means it may be asked again next time. */
          });
    }
  } catch (error) {
    if (!shown() || (error as Error).name === 'AbortError') return;
    directionsStatus.set(
      route,
      need === 'match'
        ? 'Directions unavailable for this track.'
        : 'Directions unavailable. Try again later.',
    );
  }
  if (current === route) renderSummary(route);
}

/** Route summary card; departure, units, speed and language changes only re-render this. */
function renderSummary(route: Route) {
  const locale = state.language === 'pt' ? 'pt-BR' : 'en';
  // Our own estimate from the traveler's speed, never the router's duration.
  const duration = travelTimeSeconds(route.distance, speedKmh);
  const minutes = Math.round(duration / 60);
  const summary = $('summary-content'),
    notes = $('summary-notes'),
    itinerary = $('itinerary');
  $('summary').hidden = false;
  $('route-details').hidden = false;
  summary.replaceChildren();
  notes.replaceChildren();
  itinerary.replaceChildren();
  const leaving = departureOf(state);
  const departure = leaving ? Date.parse(leaving) : NaN;
  const stats = document.createElement('dl');
  stats.className = 'stats';
  const stat = (label: string, value: string, note?: string) => {
    const item = document.createElement('div');
    const term = text('dt', label);
    const data = document.createElement('dd');
    data.append(text('strong', value));
    // A smaller second line, so the value stays on one line on phones.
    if (note) data.append(text('span', note));
    item.append(term, data);
    stats.append(item);
  };
  const distance = distanceLabel(route.distance, distanceUnits(), locale);
  const time =
    minutes === null
      ? '—'
      : minutes < 60
        ? `${minutes} min`
        : `${Math.floor(minutes / 60)}h ${minutes % 60} min`;
  stat('Distance', distance);
  stat('Time', time);
  // Shown on the handle of the closed bottom sheet.
  $('peek-main').textContent = `${distance} · ${time}`;
  if (duration !== null && Number.isFinite(departure)) {
    const arrival = new Date(departure + duration * 1000);
    // The date is added only when the arrival is on another day.
    stat(
      'Arrival',
      arrival.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      arrival.toDateString() === new Date(departure).toDateString()
        ? undefined
        : arrival.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          }),
    );
  }
  // The basis of the time estimate, next to the numbers it explains.
  const speed = speedFromKmh(speedKmh, distanceUnits()).toLocaleString(locale, {
    maximumFractionDigits: 1,
  });
  const basis = `At ${speed} ${distanceUnits() === 'imperial' ? 'mph' : 'km/h'} · no stops`;
  const daylight = document.createElement('div');
  daylight.id = 'daylight-summary';
  summary.append(stats, text('p', basis, 'hint stats-basis'), daylight);
  renderDaylight(state, route, speedKmh);
  elevation.setRoute(route);
  surface.setRoute(route);
  overlays.refresh();
  marks.refresh();
  const chips = document.createElement('div');
  chips.className = 'chips';
  const refs = highways(route.steps);
  refs.forEach((ref) => chips.append(text('span', ref)));
  const local = state.prefer ? localSections(route.steps) : [];
  // Street-by-street detail: the Itinerary row of the summary card.
  const roads = document.createElement('details');
  roads.className = 'road-list';
  roads.append(
    text(
      'summary',
      `Itinerary (${route.steps.filter((s) => s.distance > 0).length})`,
    ),
    text(
      'p',
      `${route.provider} · ${route.segments.reduce((n, s) => n + s.length, 0).toLocaleString(locale)} points`,
      'hint',
    ),
  );
  // Directions missing (imported track, or saved before they existed) are
  // fetched when the itinerary is opened; their progress or outcome shows here.
  const directions = text('p', directionsStatus.get(route) ?? '', 'hint');
  directions.id = 'directions-status';
  directions.hidden = !directionsStatus.has(route);
  roads.append(directions);
  roads.open = itineraryOpen;
  roads.addEventListener('toggle', () => {
    itineraryOpen = roads.open;
    if (roads.open) void addDirections(route);
  });
  if (roads.open) void addDirections(route);
  if (local.length) {
    roads.append(
      text('p', 'Highlighted roads are local sections to review.', 'hint'),
    );
    // The warning stays visible on the card and leads to the first section.
    const review = text(
      'button',
      local.length === 1
        ? '1 road section to review'
        : `${local.length} road sections to review`,
      'warning review-link',
    ) as HTMLButtonElement;
    review.type = 'button';
    review.onclick = () => {
      roads.open = true;
      const first = roads.querySelector<HTMLElement>('.local-road');
      if (!first) return;
      first.scrollIntoView({ block: 'nearest' });
      (first.querySelector('button') ?? first).focus({ preventScroll: true });
    };
    notes.append(review);
  }
  const ul = document.createElement('ul');
  const positions = maneuverPositions(route, !isImportedRoute(route));
  // Without any position (an imported track's rerouted parts saved before
  // locations existed), the km column is left out rather than kept empty.
  const withPositions = positions.some((at) => at !== null);
  maneuverLayer.clearLayers();
  route.steps.forEach((s, n) => {
    if (s.distance <= 0) return;
    const li = document.createElement('li');
    // A step with a maneuver location is a button that shows it on the map.
    // The grid (position, arrow, instruction and road) is an inner element:
    // older Safari does not lay out a <button> itself as a grid and falls
    // back to the centered button layout.
    const holder: HTMLElement = document.createElement(s.at ? 'button' : 'div');
    holder.className = 'step-item';
    const row = document.createElement('span');
    row.className = 'step-row';
    holder.append(row);
    // Turn direction from the router; the instruction stays an English key
    // that the DOM translation handles.
    const arrow = maneuverIcon(s);
    const instruction = maneuverText(s);
    const at = positions[n];
    if (withPositions)
      row.append(
        text(
          'span',
          // Trailing space keeps the text readable when copied or read aloud.
          at === null ? '' : `${milepostLabel(at, distanceUnits(), locale)} `,
          'milepost',
        ),
      );
    else row.classList.add('no-position');
    if (arrow) {
      const svg = icon(arrow.name);
      svg.classList.add('maneuver-icon');
      if (arrow.mirror) svg.classList.add('mirror');
      row.append(svg);
    } else row.append(text('span', '', 'maneuver-icon'));
    // One line: shortened road names and compact lengths; the full text stays
    // in the tooltip and accessible label.
    const road = t(s.name);
    const length = stepDistanceLabel(s.distance, distanceUnits(), locale);
    // Highway references are in the chips above the list; on the line they
    // stand in only for a road without a name.
    const shortRoad =
      s.ref && s.name === 'Unnamed road' ? s.ref : shortRoadName(road);
    const full = `${instruction ? `${t(instruction)} · ` : ''}${s.ref ? `${s.ref} · ` : ''}${road} · ${length}`;
    const body = document.createElement('span');
    body.className = 'step-text';
    if (instruction)
      body.append(
        text('span', instruction, 'maneuver'),
        document.createTextNode(' · '),
      );
    body.append(document.createTextNode(`${shortRoad} · ${length}`));
    row.append(body);
    holder.title = full;
    if (s.at) {
      const button = holder as HTMLButtonElement;
      button.type = 'button';
      button.classList.add('maneuver-link');
      button.setAttribute('aria-controls', 'map');
      button.setAttribute(
        'aria-label',
        `${t('Show on map')}: ${at === null ? '' : `${milepostLabel(at, distanceUnits(), locale)} · `}${full}`,
      );
      const coord = s.at;
      button.onclick = () => showManeuver(coord);
    }
    li.append(holder);
    if (local.includes(s)) li.className = 'local-road';
    ul.append(li);
  });
  roads.append(chips, ul);
  itinerary.append(roads);
  if (route.snapped) {
    const far = route.snapped
      .map((p, i) => ({
        distance: state.points[i]?.coord
          ? meters(p, state.points[i].coord!)
          : 0,
        index: i,
      }))
      .filter((p) => p.distance > 100);
    if (far.length)
      notes.append(
        text(
          'p',
          `Check road positions: ${far.map((p) => `${p.index + 1} (${shortDistanceLabel(p.distance, distanceUnits())})`).join(', ')}`,
          'warning',
        ),
      );
  }
}
function renderRoute(route: Route) {
  undoHistory.attach(route);
  trackBase =
    isImportedRoute(route) && state.points.every((p) => p.coord)
      ? { route, points: state.points.map((p) => p.coord!) }
      : null;
  drawRoute(route);
  renderSummary(route);
  $<HTMLButtonElement>('download').disabled = false;
  updateSaveButton();
  weather.render();
}
function changed(preserveEditor = false, forceRouting = false) {
  weather.invalidate();
  revision++;

  current = null;
  $<HTMLButtonElement>('download').disabled = true;
  clearTimeout(timer);
  syncUrl();
  if (preserveEditor) {
    updateSelection();
    renderMarkers();
  } else renderPoints();
  settings();
  line.clearLayers();
  clearSummary();
  if (state.points.some((p) => !p.coord) || dirty.size) {
    status(
      !state.points[0].coord
        ? 'Set your start.'
        : !state.points.at(-1)!.coord
          ? 'Set your destination.'
          : 'Set all stops.',
    );
    return;
  }
  status('Updating…');
  const version = revision;
  const snapshot = structuredClone(state);
  // Calculate route asks for a fresh router result over the whole route.
  const base = forceRouting ? null : trackBase;
  timer = setTimeout(() => {
    status('Calculating…');
    $<HTMLButtonElement>('calculate').disabled = true;
    const isCurrent = () => version === revision;
    const route = (s: State) => {
      const cached = forceRouting ? undefined : routingCache.get(s);
      return cached
        ? Promise.resolve(cached)
        : calculate(s, isCurrent).then((r) => {
            if (isCurrent()) routingCache.set(s, r);
            return r;
          });
    };
    // Imported tracks keep every unchanged leg; only edited legs are rerouted.
    void (
      base
        ? routeKeepingLegs(snapshot, base, route).then(
            (r) => r ?? route(snapshot),
          )
        : route(snapshot)
    )
      .then((route) => {
        if (version !== revision) return;
        current = route;
        renderRoute(route);
        status('Route ready.');
        updateSelection();
        if (version === fitRevision) fit();
      })
      .catch((e) => {
        if (version !== revision) return;
        updateSelection();
        if (!navigator.onLine) {
          status(
            'No connection. The route will be calculated when the connection returns.',
            true,
          );
          // One new attempt when the browser is back online, if nothing
          // changed meanwhile: a single request, not a retry loop.
          window.addEventListener(
            'online',
            () => {
              if (version === revision) changed(true, forceRouting);
            },
            { once: true },
          );
          return;
        }
        status(
          e instanceof Error
            ? e.message
            : 'Routing server unavailable. Please try again.',
          true,
        );
      });
  }, 900);
}
setupPointMenu(map, {
  click: (coord) => {
    if (!crosshair.active) setPoint(state.points[selected], selected, coord);
  },
  editable: () => !editBlocked() && !crosshair.active,
  elevation: (coord) => elevation.queryPoint(coord),
  dismiss: () => elevation.closePoint(),
});
$('calculate').onclick = () => {
  if (editBlocked()) return;
  if (dirty.size || state.points.some((p) => !p.coord)) {
    status('Set your start and destination.', true);
    return;
  }
  // Without a connection the request can only fail: keep the route on screen.
  if (!navigator.onLine) {
    // Nothing failed: the route is intact, so this is information, not an error.
    status(
      'No connection. The route on screen is kept; calculate it again when you are back online.',
    );
    return;
  }
  changed(false, true);
};
$('undo').onclick = () => {
  if (editBlocked()) return;
  if (dirty.size) {
    dirty.clear();
    drafts = new WeakMap();
    changed();
    status('Change undone.');
    return;
  }
  const previous = undoHistory.undo();
  if (!previous) return;
  state = previous;
  const restoredLanguage = state.language ?? getLanguage();
  state.language = restoredLanguage;
  setLanguage(restoredLanguage);
  $<HTMLSelectElement>('language').value = restoredLanguage;
  drafts = new WeakMap();
  dirty.clear();
  selected = Math.max(
    0,
    state.points.findIndex((p) => !p.coord),
  );
  const cached = undoHistory.attachment;
  changed();
  if (cached) {
    clearTimeout(timer);
    current = cached;
    renderRoute(cached);
  }
  status('Change undone.');
};
window.addEventListener('keydown', (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === 'z' &&
    !e.shiftKey &&
    !(
      e.target instanceof Element &&
      e.target.closest('input,textarea,[contenteditable]')
    )
  ) {
    e.preventDefault();
    $('undo').click();
  }
});
$('add').onclick = () => {
  if (editBlocked() || state.points.length >= 50) return;
  state.points.splice(state.points.length - 1, 0, {
    name: `Stop ${state.points.length - 1}`,
    coord: null,
  });
  selected = state.points.length - 2;
  changed();
};
$('reverse').onclick = () => {
  if (editBlocked()) return;
  state.points.reverse();
  selected = 0;
  changed();
};
$('roundtrip').onclick = () => {
  if (editBlocked()) return;
  if (state.points.length * 2 - 1 > 50) {
    status('A round trip would exceed the 50-point limit.', true);
    return;
  }
  state.points.push(...structuredClone(state.points.slice(0, -1).reverse()));
  state.points.at(-1)!.name = 'Return to start';
  changed();
  status('Round trip added. Check stops on divided roads.');
};
$('fit').onclick = fit;
/** Unit selects in Settings; Automatic names what this device resolves to. */
function unitSelects() {
  const found = detectedUnits();
  const label = (id: string, texts: string[]) =>
    texts.forEach((text, i) => {
      $<HTMLSelectElement>(id).options[i].textContent = t(text);
    });
  label('distance-units', [
    `Automatic (${found.distance === 'imperial' ? 'mi' : 'km'})`,
    'Kilometers',
    'Miles',
  ]);
  label('temperature-units', [
    `Automatic (${found.temperature === 'fahrenheit' ? '°F' : '°C'})`,
    'Celsius',
    'Fahrenheit',
  ]);
  label('point-placement', ['Drag with a magnifier', 'Tap, then move the map']);
  $<HTMLSelectElement>('distance-units').value = chosenDistanceUnits();
  $<HTMLSelectElement>('temperature-units').value = chosenTemperatureUnits();
}
// Units are device preferences applied at once: no rerouting or new requests.
$<HTMLSelectElement>('distance-units').onchange = () => {
  rememberDistanceUnits(
    $<HTMLSelectElement>('distance-units').value as DistanceChoice,
  );
  const units = distanceUnits();
  // Switching units keeps the speed on a notch of the new scale (the default
  // of one system becomes the other's).
  speedKmh = convertSpeedUnits(speedKmh, previousUnits, units);
  previousUnits = units;
  rememberSpeedKmh(speedKmh);
  settings();
  if (current) renderRoute(current);
  void refreshSavedRoutes();
};
$<HTMLSelectElement>('temperature-units').onchange = () => {
  rememberTemperatureUnits(
    $<HTMLSelectElement>('temperature-units').value as TemperatureChoice,
  );
  if (current) renderRoute(current);
};

$<HTMLInputElement>('prefer').onchange = () => {
  state.prefer = $<HTMLInputElement>('prefer').checked;
  syncUrl();
  if (current) renderRoute(current);
};
$('save-settings').onclick = () => {
  try {
    // Validate every URL before applying any, so an invalid field changes nothing.
    const servers = (['osrm', 'valhalla', 'nominatim'] as const).map(
      (key) => [key, serverUrl($<HTMLInputElement>(key).value.trim())] as const,
    );
    const photon = serverUrl($<HTMLInputElement>('photon').value.trim());
    const reroute = servers.some(([key, url]) => state[key] !== url);
    // Routing server changes recalculate the route; device preferences do not.
    if (reroute && editBlocked()) return;
    weather.applyServer(); // Validates its own URL before changing anything.
    for (const [key, url] of servers) state[key] = url;
    photonUrl = photon;
    writePreference(PREFERENCE.photonUrl, photonUrl);
    state.name = $<HTMLInputElement>('route-name').value.trim();
    // Only a routing server change needs a new route; names and search servers do not.
    if (reroute) changed();
    else {
      settings();
      syncUrl();
      if (current) {
        // Undo to this step restores the shown geometry instead of rerouting.
        undoHistory.attach(current);
        weather.render(); // Picks up a changed weather server.
      }
      status('Settings applied.');
    }
    $<HTMLDialogElement>('settings-dialog').close();
  } catch (e) {
    status((e as Error).message, true);
    // The status line is behind the dialog; repeat the reason inside it.
    $('settings-status').textContent = (e as Error).message;
  }
};
$<HTMLInputElement>('route-name').oninput = () => {
  state.name = $<HTMLInputElement>('route-name').value.trim();
  updateSaveButton();
};
$<HTMLInputElement>('route-name').onchange = () => {
  state.name = $<HTMLInputElement>('route-name').value.trim();
  syncUrl();
  if (current) undoHistory.attach(current);
};
function gpxContent(): string {
  return generateGpx(
    current!,
    state.points,
    state.name || `${state.points[0].name} to ${state.points.at(-1)!.name}`,
  );
}
// Touch devices that can share files export through the share sheet, with a
// named file (see src/share-file.ts): the main export action and the saved
// routes share, and Share GPX in More actions merges into it. Elsewhere they
// download, and Share GPX stays in More actions where files can be shared.
const shareExports = sharesFirst();
const GPX_DOWNLOAD = 'application/gpx+xml;charset=utf-8';
function exportGpx(share: boolean) {
  if (!current) return;
  const name = filename(state.points, state.name);
  void exportFile(gpxContent(), name, {
    share,
    types: GPX_TYPES,
    downloadType: GPX_DOWNLOAD,
  }).then((result) => {
    if (result === 'downloaded') status('GPX downloaded.');
  });
}
$('share-gpx').onclick = () => exportGpx(true);
$('download').onclick = () => exportGpx(shareExports);
$('share').onclick = () => {
  syncUrl();
  void navigator.clipboard
    .writeText(location.href)
    .then(() => status('Link copied.'))
    .catch(() => status('Copy the link from your address bar.'));
};
$<HTMLInputElement>('import').onchange = () => {
  const file = $<HTMLInputElement>('import').files?.[0];
  if (!file) return;
  if (editBlocked()) {
    $<HTMLInputElement>('import').value = '';
    return;
  }
  if (file.size > 10_000_000) {
    status('Choose a file smaller than 10 MB.', true);
    return;
  }
  void file
    .arrayBuffer()
    .then((buffer) => {
      const imported = importTrackFile(new Uint8Array(buffer));
      revision++;
      clearTimeout(timer);
      dirty.clear();
      drafts = new WeakMap();
      state.points = imported.points;
      // A file without a name gets one in the current interface language.
      state.name = imported.name || t('Imported route');
      selected = 0;
      weather.invalidate();
      current = imported.route;
      if (imported.elevations)
        recordedElevation.set(current, imported.elevations);
      if (imported.indices)
        rememberLegs(current, legsAt(current.segments, imported.indices));
      syncUrl();
      renderPoints();
      settings();
      renderRoute(current);
      fit();
      status('Route imported. Edits recalculate only the changed sections.');
    })
    .catch((e) => status((e as Error).message, true))
    .finally(() => {
      $<HTMLInputElement>('import').value = '';
    });
};
window.addEventListener('hashchange', () => {
  try {
    state = fromLink(decodeState(location.hash));
    // A link stores points, not imported geometry: route it from scratch.
    trackBase = null;
    const lang = state.language ?? getLanguage();
    state.language = lang;
    setLanguage(lang);
    settings();
    $<HTMLSelectElement>('language').value = lang;
    selected = 0;
    changed();
    fitRevision = revision;
    fit();
  } catch {
    status('Invalid route link. Your current route has been kept.', true);
  }
});
settings();
renderPoints();
if (state.points.every((p) => p.coord)) changed();
fitRevision = revision;
fit();

$('export-json').onclick = () => {
  $<HTMLTextAreaElement>('state-json').value = JSON.stringify(state, null, 2);
};
$('apply-json').onclick = () => {
  if (editBlocked()) return;
  try {
    const parsed: unknown = JSON.parse(
      $<HTMLTextAreaElement>('state-json').value,
    );
    state = validateState(parsed);
    selected = 0;
    changed();
    fitRevision = revision;
    fit();
    $<HTMLDialogElement>('settings-dialog').close();
  } catch {
    const message =
      'Invalid JSON state. Load the current state to see the expected format.';
    status(message, true);
    $('settings-status').textContent = message;
  }
};

const initialLanguage: Language = isLanguage(linkedLanguage)
  ? linkedLanguage
  : (state.language ?? preferredLanguage());
state.language = initialLanguage;
$<HTMLSelectElement>('language').value = initialLanguage;
setLanguage(initialLanguage);
history.replaceState(
  null,
  '',
  location.pathname + languageQuery(initialLanguage) + location.hash,
);
pageLinks(initialLanguage, encodeState(state));
renderPoints();
observeTranslations();
watchConnection($('offline-notice'));
markHomeScreenApp();
registerServiceWorker();
$<HTMLSelectElement>('language').onchange = () => {
  const lang = $<HTMLSelectElement>('language').value as Language;
  rememberLanguage(lang);
  state.language = lang;
  setLanguage(lang);
  settings();
  pageLinks(lang, encodeState(state));
  renderPoints();
  if (current) renderRoute(current);
  syncUrl();
  void refreshSavedRoutes();
};

function updateSpeedEstimate() {
  if (current) renderRoute(current);
  status(current ? 'Route ready.' : 'Set your start and destination.');
}
/** The chosen speed in the slider's value, readout and accessible text. */
function showSpeed(value: number) {
  const input = $<HTMLInputElement>('average-speed');
  input.setAttribute('aria-valuenow', String(value));
  input.setAttribute(
    'aria-valuetext',
    `${value} ${distanceUnits() === 'imperial' ? 'mph' : 'km/h'}`,
  );
  $('average-speed-value').textContent = String(value);
}
$<HTMLInputElement>('average-speed').oninput = () => {
  const notches = speedNotches(distanceUnits());
  const index = Number($<HTMLInputElement>('average-speed').value);
  const value = notches[Math.max(0, Math.min(notches.length - 1, index))];
  speedKmh = speedToKmh(value, distanceUnits());
  rememberSpeedKmh(speedKmh);
  showSpeed(value);
  updateSpeedEstimate();
};
function updateSaveButton() {
  $('share-gpx').hidden = shareExports || !canShareFiles();
  $<HTMLButtonElement>('share-gpx').disabled = !current || dirty.size > 0;
  const button = $<HTMLButtonElement>('save-route');
  button.disabled =
    savingRoute || !current || !state.name.trim() || dirty.size > 0;
  button.textContent = savedEntries.some(
    (r) => r.id === savedRouteKey(state.name),
  )
    ? 'Update saved route'
    : 'Save route';
}
async function refreshSavedRoutes() {
  const version = ++libraryRevision;
  try {
    const rows = await listSavedRoutes();
    if (version !== libraryRevision) return;
    savedEntries = rows;
    $('saved-count').textContent = `(${rows.length})`;
    const list = $('saved-list');
    list.replaceChildren();
    if (!rows.length) list.append(text('p', 'No saved routes.', 'hint'));
    rows.forEach((record) => {
      const card = document.createElement('article');
      card.className = 'saved-route';
      card.append(
        text('strong', record.name),
        text(
          'small',
          `${distanceLabel(record.route.distance, distanceUnits(), state.language === 'pt' ? 'pt-BR' : 'en')} · ${new Date(record.updatedAt).toLocaleDateString(state.language === 'pt' ? 'pt-BR' : 'en')}`,
        ),
      );
      const actions = document.createElement('div');
      const open = text('button', 'Open') as HTMLButtonElement;
      open.type = 'button';
      open.setAttribute('aria-label', `Open saved route: ${record.name}`);
      open.classList.add('open-saved');
      open.disabled = locked;
      open.onclick = () => {
        if (editBlocked()) return;
        const language = state.language;
        revision++;
        clearTimeout(timer);
        dirty.clear();
        drafts = new WeakMap();
        // Validation strips legacy fields such as a stored average speed.
        state = validateState(structuredClone(record.state));
        state.language = language;
        selected = 0;
        weather.invalidate();
        current = structuredClone(record.route);
        savedOrigin = { id: record.id, route: current };
        // Tried before and the road had changed: show that, ask nothing.
        if (record.directionsChecked) {
          directionsTried.add(current);
          directionsStatus.set(current, ROAD_CHANGED);
        }
        syncUrl();
        settings();
        renderPoints();
        renderRoute(current);
        fit();
        status('Saved route opened.');
        void refreshSavedRoutes();
      };
      const download = text(
        'button',
        shareExports ? 'Share GPX' : 'Download GPX',
      ) as HTMLButtonElement;
      download.type = 'button';
      download.setAttribute(
        'aria-label',
        shareExports
          ? `Share saved route: ${record.name}`
          : `Download saved route: ${record.name}`,
      );
      download.onclick = () => {
        const name = filename(record.state.points, record.name);
        void exportFile(
          generateGpx(record.route, record.state.points, record.name),
          name,
          {
            share: shareExports,
            types: GPX_TYPES,
            downloadType: GPX_DOWNLOAD,
          },
        );
      };
      const remove = text('button', 'Delete') as HTMLButtonElement;
      remove.type = 'button';
      remove.setAttribute('aria-label', `Delete saved route: ${record.name}`);
      remove.onclick = () => {
        void deleteSavedRoute(record.id)
          .then(() => {
            libraryMessage('Saved route deleted.');
            return refreshSavedRoutes();
          })
          .catch(() => libraryMessage('Could not access saved routes.', true));
      };
      actions.append(open, download, remove);
      card.append(actions);
      list.append(card);
    });
    $<HTMLButtonElement>('backup-routes').disabled = !rows.length;
    updateSaveButton();
  } catch {
    libraryMessage('Local route storage is unavailable in this browser.', true);
  }
}
function libraryMessage(message: string, error = false) {
  $('library-status').textContent = message;
  $('library-status').classList.toggle('error', error);
}
$('save-route').onclick = () => {
  if (!current || !state.name.trim() || dirty.size) return;
  const snapshot = structuredClone(state);
  const route = structuredClone(current);
  savingRoute = true;
  updateSaveButton();
  void saveNamedRoute(snapshot, route)
    .then(() => {
      status('Route saved on this device.');
      libraryMessage('Route saved on this device.');
      return refreshSavedRoutes();
    })
    .catch(() => {
      status('Could not save locally. Download the GPX to keep it.', true);
    })
    .finally(() => {
      savingRoute = false;
      updateSaveButton();
    });
};
if (shareExports) $('backup-routes').textContent = 'Share backup';
$('backup-routes').onclick = () => {
  if (!savedEntries.length) return;
  void exportFile(
    exportRouteBackup(savedEntries),
    `route-gpx-backup-${new Date().toISOString().slice(0, 10)}.json`,
    {
      share: shareExports,
      types: JSON_TYPES,
      downloadType: 'application/json',
    },
  );
};
$<HTMLInputElement>('restore-routes').onchange = () => {
  const input = $<HTMLInputElement>('restore-routes');
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 50_000_000) {
    libraryMessage('Choose a backup smaller than 50 MB.', true);
    input.value = '';
    return;
  }
  void file
    .text()
    .then((data) => importRouteBackup(parseRouteBackup(data)))
    .then((count) => {
      libraryMessage(
        count === 1
          ? 'Imported 1 route. Existing names were kept.'
          : `Imported ${count} routes. Existing names were kept.`,
      );
      return refreshSavedRoutes();
    })
    .catch(() => libraryMessage('Could not import this route backup.', true))
    .finally(() => {
      input.value = '';
    });
};
void refreshSavedRoutes();
updateSaveButton();

setupPanel(map);
setupHomeScreen();
const navigation = setupNavigation({
  route: () => current,
  state: () => state,
  speedKmh: () => speedKmh,
  locale: () => (state.language === 'pt' ? 'pt-BR' : 'en'),
  status,
  weather: () => weather.routeWeather(),
});
// Settings always open with the values in use; unapplied edits are dropped.
$('open-settings').addEventListener('click', () => {
  settings();
  navigation.syncSetting();
  $<HTMLInputElement>('photon').value = photonUrl;
});
setupMapView(map, {
  hasRoute: () => state.points.some((p) => p.coord !== null),
});

setupMapLayers(map);
const placementSelect = $<HTMLSelectElement>('point-placement');
placementSelect.value = placementMode();
placementSelect.onchange = () => {
  rememberPlacementMode(placementSelect.value as PlacementMode);
  crosshair.cancel();
  renderMarkers();
};

setupMapControls(map);

function setLocked(value: boolean) {
  locked = value;
  $('lock').setAttribute('aria-pressed', String(locked));
  $('lock-notice').hidden = !locked;
  for (const id of ['reverse', 'roundtrip', 'apply-json', 'use-link-servers'])
    $<HTMLButtonElement>(id).disabled = locked;
  $<HTMLInputElement>('import').disabled = locked;
  document
    .querySelectorAll<HTMLButtonElement>('#saved-list .open-saved')
    .forEach((button) => (button.disabled = locked));
  // Rebuild the editor and markers with the new read-only/draggable state.
  renderPoints();
  status(
    locked
      ? 'Route locked. Map, export and sharing still work.'
      : 'Editing unlocked.',
  );
}
$('lock').onclick = () => setLocked(!locked);
$('unlock').onclick = () => {
  setLocked(false);
  $('lock').focus();
};
