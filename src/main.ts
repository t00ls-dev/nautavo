import { departureOf } from './departure';
import { RoutingCache } from './routing-cache';
import { setupWeather } from './weather-ui';
import { renderDaylight } from './daylight-ui';
import {
  markDirectionsChecked,
  updateSavedSteps,
  type SavedRoute,
} from './saved-routes';
import { missingDirections, sameRoad } from './directions';
import { legDistances, legPositions } from './track-position';
import {
  speedToKmh,
  speedFromKmh,
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
  withUnit,
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
  onlineAttempt,
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
  importParsed,
  readTrackFile,
  linkServerOverrides,
  localSections,
  meters,
  parseCoordinates,
  serverUrl,
  settingsServerUrl,
  trackStops,
  validateState,
  type Coord,
  type ParsedTrack,
  type Point,
  type Route,
  type ServerUrls,
  type State,
} from './core';
import { PREFERENCE, readPreference, writePreference } from './preferences';
import { calculate } from './routing';
import { osrmMatch } from './route-match';
import { defaultPhotonUrl, searchAddress } from './search';
import { ROAD_DATA_LIMIT } from './valhalla-trace';
import {
  isImportedRoute,
  legsAt,
  rememberLegs,
  routeKeepingLegs,
} from './track-legs';
import {
  exportFile,
  FIT_DOWNLOAD,
  FIT_TYPES,
  GPX_DOWNLOAD,
  GPX_TYPES,
  sharesFirst,
  TCX_DOWNLOAD,
  TCX_TYPES,
} from './share-file';
import { courseCues, generateFit, generateTcx } from './course-export';
import { setupPointMenu } from './point-menu';
import { setupNavigation } from './navigation-ui';
import { resumableNavigation } from './navigation-resume';
import { setupHomeScreen } from './home-screen';
import { setupElevation } from './elevation-ui';
import { setupSurface } from './surface-ui';
import { SURFACE_KINDS } from './surface';
import { elevationStats, gradeRanges, trackElevations } from './elevation';
import { setupRouteOverlays } from './route-overlays';
import {
  repeatsFor,
  routePieces,
  setupRouteMarks,
  splitByRepeat,
} from './route-marks';
import {
  highlightLayers,
  lineFeature,
  PlannerMap,
  RANK,
  type MapMarker,
} from './planner-map';
import { createRouteFit } from './route-fit';
import { setupLibrary } from './library-ui';
import {
  itineraryList,
  showAscent,
  summaryStats,
  tripLine,
} from './summary-ui';
import { checkTrack, type TrackCheck } from './track-check';
import { PASS_OFFSET } from './route-overlays';
import { routeDaylight } from './daylight';
import { addressAutocomplete, placeOption } from './autocomplete';
import { setupMapView } from './map-view';
import { defaultView } from './default-view';
import { routeLineColor, setupMapLayers } from './map-layers';
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
import { compactLayout, placeLibrary, setupPanel } from './panel';
import { stopTapHoldLoupe } from './tap-hold';
import { setupRouteDrag } from './route-drag';
import { createPointPopup, createTrash, pointRole } from './point-removal';
import { activityOf, activityProfile, type Activity } from './activity';
import { setupActivityView } from './activity-ui';
import { activityColorings } from './activity-colorings';
import { icon, iconControl } from './icons';
import { coordText, FAVORITE_ICONS } from './favorite-dialog';
import { byId as $, optionalById, text } from './dom';
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
// Footer links: Help, What's new and the repository, each with its icon.
$('help').prepend(icon('help'));
$('changelog').prepend(icon('news'));
$('github').prepend(icon('github'));
let state: State = defaults(),
  selected = 0,
  // A point chosen in the list (its number or field) for the next map click
  // (#295): with every point set, a click elsewhere on the map moves nothing.
  placing = false,
  // The last calculation failed: Calculate route offers Try again (#296).
  routeFailed = false,
  current: Route | null = null,
  revision = 0,
  // The route a load asked to frame; edits keep the user's view (#117).
  fitRevision = -1,
  timer: ReturnType<typeof setTimeout>;
/** Counts status messages, so background work can tell it was superseded. */
let statusCount = 0;
function status(message: string, error = false) {
  statusCount++;
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
/**
 * Edit lock, kept in page memory only. Every route edit entry point checks
 * `editBlocked()`; viewing, export and sharing stay available.
 */
let locked = false;
/** The open activity's track, set once the activity view exists (#156). */
let activityCoords = (): Coord[] | null => null;
/** The open recorded activity, once the activity view exists. */
let openActivity = (): Activity | null => null;
function editBlocked(): boolean {
  // An open activity leaves the planned route as it is (#156).
  if (activityCoords()) return true;
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
const routeSnapshot = (s: State): State => {
  const snapshot = { ...s };
  delete snapshot.language;
  return snapshot;
};
/** Each undo step keeps the route shown for it, so undoing restores that exact geometry. */
const undoHistory = new UndoHistory<State, Route>(routeSnapshot(state));
let drafts = new WeakMap<Point, string>();
const dirty = new Set<Point>();
const lookupVersions = new WeakMap<Point, number>();
const routingCache = new RoutingCache();
/** The last displayed imported track and the points it was shown for. */
let trackBase: { route: Route; points: Coord[] } | null = null;
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
// Touch devices that can share files export through the share sheet, with a
// named file (see src/share-file.ts): the main export action and the saved
// routes share, and Share GPX in More actions merges into it. Elsewhere they
// download, and Share GPX stays in More actions where files can be shared.
const shareExports = sharesFirst();
const library = setupLibrary({
  state: () => state,
  route: () => current,
  pending: () => dirty.size > 0,
  locked: () => locked,
  editBlocked,
  status,
  open: openSavedRoute,
  pointValue: (point) => pointValue(point),
  generatedName: (point) => generatedName(point),
  pointNamed: () => {
    syncUrl();
    renderPoints();
  },
  rename: (name) => {
    $<HTMLInputElement>('route-name').value = name;
    renameRoute();
  },
  map,
  photonUrl: () => photonUrl,
  shareExports,
});
/** Route point markers on the map. */
let markers: MapMarker[] = [];
/**
 * What checking an imported track against the roads found, per route shown:
 * the track aligned to the roads (with the recording it replaced) and the
 * stretches it cannot follow exactly
 * (highlighted on the map, listed in the summary). Page memory only.
 */
const trackChecks = new WeakMap<
  Route,
  TrackCheck & { raw?: { route: Route; points: Point[] } }
>();
let checkRevision = 0;
const setOffTrack = map.overlay('rg-unfollowable', RANK.highlight, () =>
  highlightLayers('rg-unfollowable-line'),
);
/** The route line: a white casing under the route color, per base map. */
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
        'line-color': routeLineColor(),
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
/** A stop from the route line being placed with the crosshair (#285). */
let inserting = false;
// Removing a point from the map (#285): the trash zone while a marker is
// dragged and the popup of a tapped marker.
const trash = createTrash(map);
const pointPopup = createPointPopup(map);
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
    .catch((error: unknown) => {
      if (revision === before)
        status(locationError((error as { code?: number }).code ?? 2), true);
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
map.on('click', (event: { originalEvent: Event }) => {
  maneuverLayer.clearLayers();
  // A tap on a marker opens its popup; any other tap on the map closes it.
  if (!(event.originalEvent.target as Element).closest('.maplibregl-marker'))
    pointPopup.close();
});
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
  // The Grade coloring and Show ascent are explicit choices that need the
  // profile too; a recorded profile asks for nothing.
  wanted: () =>
    overlays.active() === 'grade' ||
    ascentShown ||
    (!!current && recordedElevation.has(current)),
  onProfile: () => {
    overlays.refresh();
    refreshAscent();
  },
  onStatus: () => refreshAscent(),
});
/** Show ascent was chosen in the summary: later routes show it too (#302). */
let ascentShown = false;
/** The summary's Ascent, from the profile when it is known. */
function refreshAscent() {
  const cell = optionalById('summary-ascent');
  if (!cell) return;
  const loaded = elevation.profile();
  showAscent(
    cell,
    loaded
      ? (elevationStats(loaded.profile, loaded.source)?.ascent ?? null)
      : null,
    elevation.loading(),
    state.language === 'pt' ? 'pt-BR' : 'en',
    () => {
      ascentShown = true;
      elevation.want();
      refreshAscent();
    },
  );
}
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
  activity: () => openActivity(),
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
  // An activity's own recorded altitude, with no request.
  activityRanges: (activity) =>
    gradeRanges(activityProfile(activity), 'recorded'),
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
for (const coloring of activityColorings({
  activity: () => openActivity(),
  locale: () => (state.language === 'pt' ? 'pt-BR' : 'en'),
}))
  overlays.register(coloring);
// Registered after the weather handler, which stores the new departure first.
$('departure').addEventListener('change', () => {
  if (current) renderSummary(current);
  else renderDaylight(state, null, speedKmh);
});
const routeFit = createRouteFit(
  map,
  () =>
    activityCoords() ??
    current?.segments.flat() ??
    state.points.flatMap((p) => (p.coord ? [p.coord] : [])),
);
const fit = () => routeFit.fit();
/** Help and What's new open in the chosen language and keep the route for Back to map. */
function pageLinks(lang: Language, hash: string) {
  $<HTMLAnchorElement>('help').href = `./help?lang=${lang}${hash}`;
  $<HTMLAnchorElement>('changelog').href = `./changelog?lang=${lang}${hash}`;
}
function syncUrl() {
  library.updateSaveButton();
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
  $('speed-range').textContent = withUnit(
    `1–${bounds.max}`,
    distanceUnits() === 'imperial' ? 'mph' : 'km/h',
  );
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
  placing = true;
  updateSelection();
  renderMarkers();
  if (showMap) {
    $('map').scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (state.points[i].coord) map.panTo(state.points[i].coord);
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
  // hint unless the route is locked; on desktop it shows while a click
  // would set a point.
  const note = $('map-note');
  note.hidden =
    !locked && (matchMedia('(pointer: coarse)').matches || !clickPlaces());
  note.textContent = locked
    ? 'Route locked. Unlock editing to change it.'
    : `Set ${target} on the map`;
  $<HTMLButtonElement>('undo').disabled =
    locked || (!undoHistory.canUndo && !dirty.size);
  $<HTMLButtonElement>('calculate').disabled =
    locked || state.points.some((p) => !p.coord) || dirty.size > 0;
}
/** Whether a desktop map click sets the selected point (#295). */
const clickPlaces = () => placing || !state.points[selected]?.coord;
function setPoint(
  point: Point,
  index: number,
  coord: Coord,
  name?: string,
  preserveEditor = false,
) {
  point.coord = coord;
  if (name) point.name = name;
  placing = false;
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
/** Names the app gives points: the field shows the point, not the name. */
const generatedName = (point: Point) =>
  /^(Start|Destination|Stop \d+|Point \d+|Return to start)$/.test(point.name);
/** Along-track distance of each point on the route shown, in order. */
const pointPositions = new WeakMap<Route, Map<Point, number>>();
/**
 * An automatic stop of an imported track, named by its place on the route
 * ("Stop · km 1.2", #208), locally: phones cut its coordinates, which stay in
 * the GPX and on the map.
 */
function stopLabel(point: Point, route = current): string | null {
  const at = stopPosition(point, route);
  return at === null ? null : t(`Stop · ${at}`);
}
/** An automatic stop's place on the route shown ("km 1.2"), or null. */
function stopPosition(point: Point, route = current): string | null {
  if (!/^Stop \d+$/.test(point.name) || !point.coord || !route) return null;
  let positions = pointPositions.get(route);
  if (!positions) {
    const placed = state.points.filter((p) => p.coord);
    const at = legPositions(
      route.segments,
      placed.map((p) => p.coord!),
    );
    positions = new Map(
      placed.flatMap((p, i) => (at[i] === null ? [] : [[p, at[i]]])),
    );
    pointPositions.set(route, positions);
  }
  const at = positions.get(point);
  if (at === undefined) return null;
  const locale = getLanguage() === 'pt' ? 'pt-BR' : 'en';
  return milepostLabel(at, distanceUnits(), locale);
}
function pointValue(point: Point, route = current): string {
  return (
    drafts.get(point) ??
    (point.coord
      ? generatedName(point)
        ? (stopLabel(point, route) ??
          point.coord.map((n) => n.toFixed(6)).join(', '))
        : point.name
      : '')
  );
}
/** Saved routes and favorites come first while no point is set (#213). */
const placeLists = () => placeLibrary(state.points.every((p) => !p.coord));
function renderPoints() {
  const list = $('points');
  const scroll = list.scrollTop;
  autocompleteCleanups.forEach((close) => close());
  autocompleteCleanups = [];
  list.replaceChildren();
  $('point-count').textContent = `${state.points.length} points`;
  placeLists();
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
    // Enter results read like the suggestions, in the same card (#214).
    results.className = 'point-results suggestions';
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
            : 'No suggestions found. Press Enter to search addresses.',
        ),
      failed: () =>
        status('Suggestions unavailable. Press Enter to search addresses.'),
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
        // Favorites (#52): save this point's place, unless it already is
        // one, then each favorite with its icon and distance.
        ...(point.coord && !editBlocked() && !library.favoriteAt(point.coord)
          ? [
              {
                label: 'Save as favorite',
                icon: 'star' as const,
                run: () => library.saveAsFavorite(point),
              },
            ]
          : []),
        ...library.favoritesFor(input.value, point).map((favorite, n) => ({
          heading: n ? undefined : t('Favorite places'),
          label: favorite.name,
          note: favorite.place ?? coordText(favorite.coord),
          icon: FAVORITE_ICONS[favorite.kind ?? 'place'],
          detail:
            point.coord && library.favoriteAt(point.coord) === favorite
              ? t('This point')
              : (suggestionDistance(point, favorite.coord) ?? undefined),
          run: () => {
            if (editBlocked()) return;
            setPoint(point, i, favorite.coord, favorite.name, true);
            map.panTo(favorite.coord);
          },
        })),
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
      library.updateSaveButton();
      line.clearLayers();
      clearSummary();
      exportable(false);
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
              const b = document.createElement('button');
              b.type = 'button';
              placeOption(b, r, (coord) => suggestionDistance(point, coord));
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
    remove.onclick = () => removePoint(i);
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
/**
 * Removes route point `index`: the list's ×, or the map (its popup, the
 * trash zone or the Delete key).
 */
function removePoint(index: number) {
  if (editBlocked() || state.points.length <= 2) return;
  dirty.delete(state.points[index]);
  state.points.splice(index, 1);
  selected = Math.min(selected, state.points.length - 1);
  changed();
}
/** A point can leave from the map: editing open and more than two points. */
const removableFromMap = () =>
  !locked && !activityCoords() && state.points.length > 2;
/**
 * The popup of a marker: Remove, and Move with the crosshair preference.
 * False with only two points, which cannot be removed.
 */
function openPointPopup(point: Point): boolean {
  const index = state.points.indexOf(point);
  const move =
    placementMode() === 'crosshair' && !locked && !activityCoords()
      ? () => adjustPoint(point)
      : undefined;
  // With two points there is nothing to remove: no popup, as before.
  if (index < 0 || !point.coord || !removableFromMap()) return false;
  pointPopup.show({
    coord: point.coord,
    number: index + 1,
    // Beside its number: a stop's place on the route, the role of a point
    // the app named, or the name the user gave.
    name: generatedName(point)
      ? (stopPosition(point) ?? pointLabel(index))
      : point.name,
    role: pointRole(index, state.points.length),
    remove: () => removePoint(state.points.indexOf(point)),
    move,
  });
  return true;
}
function renderMarkers() {
  // Locking, undo or removing the point ends its placement (its callback
  // draws the markers again, so this comes before clearing them).
  if (
    crosshair.active &&
    (locked || (adjusting ? !state.points.includes(adjusting) : !inserting))
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
      framed: true,
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
      // With only two points the crosshair starts at once, as before.
      if (!openPointPopup(p) && mode === 'crosshair' && !locked) adjustPoint(p);
    });
    // A right click on a marker opens its popup, not the map point menu.
    m.element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectPoint(i);
      openPointPopup(p);
    });
    m.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      event.preventDefault();
      if (removableFromMap()) removePoint(i);
    });
    // Dropped on the trash zone, the point leaves the route.
    let overTrash = false;
    m.on('dragstart', () => {
      dragged = true;
      pointPopup.close();
      if (removableFromMap()) trash.show();
      if (touchDrag) loupe.move(m.getCoord());
    });
    m.on('drag', () => {
      overTrash = trash.over(m.getCoord());
      m.element.classList.toggle('over-trash', overTrash);
      if (!touchDrag) return;
      if (overTrash) loupe.hide();
      else loupe.move(m.getCoord());
    });
    m.on('dragend', () => {
      loupe.hide();
      trash.hide();
      // The click that may follow a mouse drag comes at once, if at all.
      setTimeout(() => (dragged = false), 0);
      if (overTrash) {
        removePoint(i);
        return;
      }
      selected = i;
      setPoint(p, i, m.getCoord());
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
  showCalculate(null);
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
/** Directions that failed offline wait for the connection (one attempt). */
const directionsOnline = onlineAttempt();
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
      // The router that made the saved route is asked first, so the fresh
      // route can follow the same road.
      const fresh = await calculate(
        structuredClone(state),
        shown,
        null,
        route.provider.startsWith('Valhalla') ? 'valhalla' : 'osrm',
      );
      steps = sameRoad(route, fresh) ? fresh.steps : null;
    }
    if (!shown()) return;
    if (steps) {
      route.steps = steps;
      directionsStatus.delete(route);
      if (savedOrigin?.route === route)
        void updateSavedSteps(savedOrigin.id, route)
          .then(() => library.refreshSavedRoutes())
          .catch(() => {
            /* Directions still show; the saved entry keeps its old steps. */
          });
    } else {
      directionsStatus.set(route, ROAD_CHANGED);
      // Remembered in the saved entry: reopening does not ask again.
      if (savedOrigin?.route === route)
        void markDirectionsChecked(savedOrigin.id)
          .then(() => library.refreshSavedRoutes())
          .catch(() => {
            /* Only means it may be asked again next time. */
          });
    }
  } catch (error) {
    if (!shown() || (error as Error).name === 'AbortError') return;
    // Offline: asked again when the connection returns, if the Itinerary is
    // open then, or the next time it opens; until then the route stays tried,
    // so re-rendering the summary asks nothing.
    if (
      directionsOnline(() => {
        directionsTried.delete(route);
        if (current === route) renderSummary(route);
      })
    ) {
      directionsStatus.set(
        route,
        'No connection. Directions will be added when the connection returns.',
      );
    } else
      directionsStatus.set(
        route,
        need === 'match'
          ? 'Directions unavailable for this track.'
          : 'Directions unavailable. Try again later.',
      );
  }
  if (current === route) renderSummary(route);
}

/** Meters from a route point to the road the route uses, above which it warns. */
const FAR_FROM_ROAD = 500;
/**
 * The summary's heading (#302): the route's name, else its first and last
 * points by the first part of their names.
 */
function routeTitle(): Node[] {
  if (state.name) return [document.createTextNode(state.name)];
  const short = (point: Point) => point.name.split(',')[0].trim();
  // The arrow is drawn; screen readers hear "to".
  return [
    text('span', short(state.points[0])),
    icon('right'),
    text('span', 'to', 'sr-only'),
    document.createTextNode(' '),
    text('span', short(state.points.at(-1)!)),
  ];
}
/** Trip options closes to one line once a route is shown, until opened (#303). */
let tripOptionsTouched = false;
$('trip-options')
  .querySelector('summary')!
  .addEventListener('click', () => {
    tripOptionsTouched = true;
  });
function showTripLine(departure: number, locale: string) {
  const parts = tripLine(departure, speedKmh, state.prefer, locale);
  $('trip-line').replaceChildren(
    ...parts.flatMap((part, i) => [
      ...(i ? [document.createTextNode(' · ')] : []),
      text('span', part),
    ]),
  );
  if (!tripOptionsTouched) $<HTMLDetailsElement>('trip-options').open = false;
}
/** Route summary card; departure, units, speed and language changes only re-render this. */
function renderSummary(route: Route) {
  const locale = state.language === 'pt' ? 'pt-BR' : 'en';
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
  const { stats, basis, peek } = summaryStats(
    route,
    speedKmh,
    departure,
    locale,
  );
  // Shown on the handle of the closed bottom sheet.
  $('peek-main').textContent = peek;
  $('summary-title').replaceChildren(...routeTitle());
  showTripLine(departure, locale);
  const daylight = document.createElement('div');
  daylight.id = 'daylight-summary';
  summary.append(stats, basis, daylight);
  renderDaylight(state, route, speedKmh);
  elevation.setRoute(route);
  refreshAscent();
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
  // The router and the point count are not shown (#210): Help explains them.
  roads.append(
    text(
      'summary',
      `Itinerary (${route.steps.filter((s) => s.distance > 0).length})`,
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
    // Information, not a warning (#299): with Prefer main roads, the local
    // roads left on the route; the line leads to the first one.
    const length = distanceLabel(
      local.reduce((sum, step) => sum + step.distance, 0),
      distanceUnits(),
      locale,
    );
    const review = text(
      'button',
      local.length === 1
        ? `1 local road section · ${length}`
        : `${local.length} local road sections · ${length}`,
      'warning info review-link',
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
  maneuverLayer.clearLayers();
  const ul = itineraryList(route, local, locale, showManeuver);
  roads.append(chips, ul);
  itinerary.append(roads);
  if (route.snapped) {
    const far = route.snapped
      .map((p, i) => ({
        distance: state.points[i]?.coord ? meters(p, state.points[i].coord) : 0,
        index: i,
      }))
      .filter((p) => p.distance > 100);
    // Points placed away from a road (a park, a building) are routed from
    // the nearest one: information, a warning only when that is far (#299).
    if (far.length)
      notes.append(
        text(
          'p',
          `Off the road: ${far.map((p) => `point ${p.index + 1} (${shortDistanceLabel(p.distance, distanceUnits())})`).join(', ')}. The route uses the nearest road.`,
          far.some((p) => p.distance > FAR_FROM_ROAD)
            ? 'warning'
            : 'warning info',
        ),
      );
  }
}
/** The summary's notes about an imported track checked against the roads. */
function trackNotes(route: Route) {
  const check = trackChecks.get(route);
  if (!check) return;
  const notes = $('summary-notes');
  const locale = state.language === 'pt' ? 'pt-BR' : 'en';
  if (check.raw) {
    const fixed = text('p', 'Track aligned to the roads.', 'track-fixed');
    const keep = text('button', 'Keep the recorded track') as HTMLButtonElement;
    keep.type = 'button';
    keep.className = 'link-button';
    keep.onclick = () => keepRecorded(route);
    fixed.append(' ', keep);
    notes.append(fixed);
  }
  if (check.off.length) {
    const box = document.createElement('div');
    box.className = 'warning unfollowable';
    box.append(
      text(
        'p',
        check.off.length === 1
          ? 'This route cannot be followed exactly in 1 place:'
          : `This route cannot be followed exactly in ${check.off.length} places:`,
      ),
    );
    const list = document.createElement('ul');
    for (const stretch of check.off) {
      const label = `${milepostLabel(stretch.from, distanceUnits(), locale)}–${milepostLabel(stretch.to, distanceUnits(), locale)}`;
      const item = document.createElement('li');
      const show = text('button', label) as HTMLButtonElement;
      show.type = 'button';
      show.className = 'link-button';
      show.setAttribute('aria-label', `${t('Show on map')}: ${label}`);
      show.onclick = () => {
        if (!$('route-panel').hidden && compactLayout())
          $('panel-toggle').click();
        map.fit(stretch.coords.flat(), {
          padding: routeFit.padding(),
          maxZoom: 16,
        });
      };
      item.append(show);
      list.append(item);
    }
    box.append(list);
    notes.append(box);
  }
}
/** Back to the track as recorded, before it was aligned to the roads. */
function keepRecorded(route: Route) {
  const raw = trackChecks.get(route)?.raw;
  if (!raw || editBlocked() || current !== route) return;
  checkRevision++;
  state.points = structuredClone(raw.points);
  current = raw.route;
  syncUrl();
  renderPoints();
  renderRoute(raw.route);
  status('Recorded track restored.');
}
/** An import made offline is checked when the connection returns, once. */
const importOnline = onlineAttempt();
/**
 * After an import: checks the track against the roads and replaces its GPS
 * glitches with the road taken. Offline, it waits for the connection once.
 * Its messages never replace a newer status, such as the error of a later
 * import that failed (#267); its result still applies to the route.
 */
async function checkImported(
  raw: Route,
  autoStops: boolean,
  mark = statusCount,
) {
  const token = ++checkRevision;
  const fresh = () => token === checkRevision && current === raw;
  const report = (message: string) => {
    if (statusCount !== mark) return;
    status(message);
    mark = statusCount;
  };
  if (
    importOnline(() => {
      if (fresh()) void checkImported(raw, autoStops, mark);
    })
  ) {
    report(
      'Route imported. No connection: the track will be checked against the roads when the connection returns.',
    );
    return;
  }
  report('Checking the track against the roads…');
  // Waypoints from the file are the traveler's own and protect their
  // stretch; automatic stops do not, since they are placed again after.
  const stops = autoStops
    ? []
    : state.points.flatMap((p) => (p.coord ? [p.coord] : []));
  const outcome = await checkTrack(
    raw,
    state.valhalla,
    'repair',
    stops,
    recordedElevation.get(raw),
    fresh,
  );
  if (!fresh()) return;
  // The check is an extra: when it cannot run, the import stands as it is.
  if (outcome.kind !== 'checked') {
    report(
      outcome.kind === 'limit'
        ? 'Route imported. The track could not be checked against the roads now.'
        : 'Route imported. Edits recalculate only the changed sections.',
    );
    return;
  }
  const { check } = outcome;
  if (!check.glitches && !check.aligned) {
    report('Route imported. Edits recalculate only the changed sections.');
    trackChecks.set(raw, check);
    renderRoute(raw);
    return;
  }
  report('Track aligned to the roads.');
  const points = structuredClone(state.points);
  adoptAligned(check, { route: raw, points }, autoStops);
}
/**
 * Shows a track aligned to the roads, keeping the recording for Keep the
 * recorded track. Automatic stops are placed again on it, so none sits on a
 * removed glitch; otherwise the start and end follow it onto the street.
 */
function adoptAligned(
  check: TrackCheck,
  raw: { route: Route; points: Point[] },
  autoStops: boolean,
) {
  const route = check.route;
  trackChecks.set(route, { ...check, raw });
  if (check.elevations) recordedElevation.set(route, check.elevations);
  const flat = route.segments.flat();
  if (autoStops) {
    const stops = trackStops(flat);
    state.points = stops.points;
    rememberLegs(route, legsAt(route.segments, stops.indices));
  } else {
    const ends = [state.points[0], state.points.at(-1)];
    if (ends[0]?.coord) ends[0].coord = flat[0];
    if (ends[1]?.coord) ends[1].coord = flat.at(-1)!;
  }
  current = route;
  syncUrl();
  renderPoints();
  renderRoute(route);
}
/**
 * Calculate route on an imported track: the road it follows, from map
 * matching, with its directions; stretches no road explains stay as
 * recorded and are flagged. Never a different road in place of the track.
 */
async function followImported(base: Route) {
  const token = ++checkRevision;
  const fresh = () => token === checkRevision && current === base;
  status('Calculating…');
  $<HTMLButtonElement>('calculate').disabled = true;
  // A track already aligned is matched again from its recording, whose
  // pieces are cached: the same road, now with its directions.
  const raw = trackChecks.get(base)?.raw;
  const source = raw?.route ?? base;
  const outcome = await checkTrack(
    source,
    state.valhalla,
    'follow',
    state.points.flatMap((p) => (p.coord ? [p.coord] : [])),
    recordedElevation.get(source),
    fresh,
  );
  if (!fresh()) return;
  updateSelection();
  if (outcome.kind !== 'checked' || !outcome.check.complete) {
    status(
      outcome.kind === 'limit'
        ? ROAD_DATA_LIMIT
        : 'The route could not be calculated along the imported track now. The imported track is kept.',
      true,
    );
    return;
  }
  const { check } = outcome;
  if (raw || check.aligned || check.glitches)
    adoptAligned(
      check,
      raw ?? { route: base, points: structuredClone(state.points) },
      false,
    );
  else {
    trackChecks.set(check.route, check);
    current = check.route;
    renderRoute(check.route);
  }
  status('Route calculated along the imported track.');
}
function renderRoute(route: Route) {
  showCalculate(route);
  undoHistory.attach(route);
  routeDrag.reset();
  // Automatic stops are named by their place on this route (#208).
  state.points.forEach((point, i) => {
    const input = optionalById<HTMLInputElement>(`location-${i}`);
    if (input && document.activeElement !== input && !drafts.has(point))
      input.value = pointValue(point, route);
  });
  trackBase =
    isImportedRoute(route) && state.points.every((p) => p.coord)
      ? { route, points: state.points.map((p) => p.coord!) }
      : null;
  drawRoute(route);
  setOffTrack(
    (trackChecks.get(route)?.off ?? []).flatMap((o) =>
      o.coords.map((c) => lineFeature(c)),
    ),
  );
  renderSummary(route);
  trackNotes(route);
  exportable(true);
  library.updateSaveButton();
  weather.render();
}
/**
 * The first point still to set, named by its role or its number in the
 * editor (#212): an empty field or typed text not yet resolved to a place.
 */
function missingPoint(): string | null {
  const i = state.points.findIndex((p) => !p.coord || dirty.has(p));
  if (i < 0) return null;
  if (i === 0)
    return state.points.at(-1)!.coord
      ? 'Set your start.'
      : 'Set your start and destination.';
  if (i === state.points.length - 1) return 'Set your destination.';
  return `Set point ${i + 1}.`;
}
/**
 * After a failed calculation, Calculate route says Try again, beside the
 * message (#210): the same action on the same queue, never automatic.
 */
function routingFailed(failed: boolean) {
  routeFailed = failed;
  iconControl(
    $('calculate'),
    'refresh',
    failed ? 'Try again' : 'Calculate route',
  );
  showCalculate(current);
}
/**
 * Calculate route shows only where it does something (#296): Try again after
 * a failed calculation, and on an imported track, which it matches to the
 * roads again. Routing runs on its own after every edit otherwise.
 */
function showCalculate(route: Route | null) {
  $('calculate').hidden = !(
    routeFailed ||
    (route !== null && isImportedRoute(route))
  );
}
/** A route that failed offline is calculated when the connection returns, once. */
const routeOnline = onlineAttempt();
function changed(preserveEditor = false, forceRouting = false) {
  weather.invalidate();
  revision++;
  routingFailed(false);

  current = null;
  routeDrag.reset();
  pointPopup.close();
  exportable(false);
  clearTimeout(timer);
  syncUrl();
  if (preserveEditor) {
    updateSelection();
    renderMarkers();
    placeLists();
  } else renderPoints();
  settings();
  line.clearLayers();
  clearSummary();
  const missing = missingPoint();
  if (missing) {
    status(missing);
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
        routingFailed(false);
        status('Route ready.');
        updateSelection();
        if (version === fitRevision) fit();
      })
      .catch((e: unknown) => {
        if (version !== revision) return;
        updateSelection();
        // One new attempt when the browser is back online, if nothing
        // changed meanwhile: a single request, not a retry loop.
        if (
          routeOnline(() => {
            if (version === revision) changed(true, forceRouting);
          })
        ) {
          status(
            'No connection. The route will be calculated when the connection returns.',
            true,
          );
          return;
        }
        status(
          e instanceof Error
            ? e.message
            : 'Routing server unavailable. Please try again.',
          true,
        );
        routingFailed(true);
      });
  }, 900);
}
/** A stop added from the route line, between the points of its leg. */
function insertStop(index: number, coord: Coord) {
  if (editBlocked() || state.points.length >= 50) return;
  state.points.splice(index, 0, { name: '', coord });
  state.points[index].name = pointLabel(index);
  selected = index;
  changed();
}
const routeDrag = setupRouteDrag(map, {
  // Only a current route of set points takes a stop from its line.
  route: () =>
    current &&
    !locked &&
    !activityCoords() &&
    !crosshair.active &&
    !dirty.size &&
    state.points.length < 50 &&
    state.points.every((p) => p.coord)
      ? current
      : null,
  points: () => state.points.map((p) => p.coord!),
  insert: insertStop,
  place: (index, coord) => {
    if (placementMode() !== 'crosshair' || editBlocked()) return false;
    const before = revision;
    inserting = true;
    crosshair.start(coord, index + 1, (chosen) => {
      inserting = false;
      // A later edit wins: the leg may not be there any more.
      if (chosen && revision === before) insertStop(index, chosen);
    });
    return true;
  },
  loupe,
});
setupPointMenu(map, {
  click: (coord) => {
    if (!crosshair.active && clickPlaces())
      setPoint(state.points[selected], selected, coord);
  },
  editable: () => !editBlocked() && !crosshair.active,
  elevation: (coord) => elevation.queryPoint(coord),
  dismiss: () => elevation.closePoint(),
});
$('calculate').onclick = () => {
  if (editBlocked()) return;
  const missing = missingPoint();
  if (missing) {
    status(missing, true);
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
  // An imported track is matched to the roads it follows, never rerouted.
  if (current && isImportedRoute(current)) {
    void followImported(current);
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
  activityView.refresh();
  void library.refreshSavedRoutes();
};
$<HTMLSelectElement>('temperature-units').onchange = () => {
  rememberTemperatureUnits(
    $<HTMLSelectElement>('temperature-units').value as TemperatureChoice,
  );
  if (current) renderRoute(current);
  activityView.refresh();
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
      (key) =>
        [
          key,
          settingsServerUrl($<HTMLInputElement>(key).value.trim()),
        ] as const,
    );
    const photon = settingsServerUrl(
      $<HTMLInputElement>('photon').value.trim(),
    );
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
  library.updateSaveButton();
};
/** The route takes the Route name field's name, in the link and undo. */
function renameRoute() {
  state.name = $<HTMLInputElement>('route-name').value.trim();
  syncUrl();
  if (current) undoHistory.attach(current);
}
$<HTMLInputElement>('route-name').onchange = renameRoute;
/** The route's exports (GPX and the courses) follow the route shown. */
function exportable(ready: boolean) {
  for (const id of ['download', 'download-tcx', 'download-fit'])
    $<HTMLButtonElement>(id).disabled = !ready;
}
const exportName = () =>
  state.name || `${state.points[0].name} to ${state.points.at(-1)!.name}`;
/**
 * Elevation of every track point for the exports, from what the page already
 * has: recorded in the imported file, else the profile Elevation loaded for
 * this route. Never a request (#290).
 */
function exportElevations(route: Route) {
  const recorded = recordedElevation.get(route);
  if (recorded) return recorded;
  const loaded = elevation.profile();
  return loaded?.source === 'terrain'
    ? trackElevations(route.segments, loaded.profile)
    : undefined;
}
/** Elevation is never requested for an export: say how to include it. */
const WITHOUT_ELEVATION =
  'File saved without elevation. Open Elevation before downloading to include it.';
function gpxContent(): string {
  return generateGpx(
    current!,
    state.points,
    exportName(),
    undefined,
    exportElevations(current!),
  );
}
/** The course formats: how each is written, shared and announced. */
const COURSES = {
  tcx: {
    generate: generateTcx,
    types: TCX_TYPES,
    downloadType: TCX_DOWNLOAD,
    downloaded: 'TCX downloaded.',
  },
  fit: {
    generate: generateFit,
    types: FIT_TYPES,
    downloadType: FIT_DOWNLOAD,
    downloaded: 'FIT downloaded.',
  },
};
/**
 * A course with the route's turns, TCX (#288) or FIT. An imported track
 * without directions gets them as the Itinerary does, on this explicit
 * choice.
 */
async function exportCourse(format: keyof typeof COURSES, share: boolean) {
  const course = COURSES[format];
  const route = current;
  if (!route) return;
  if (missingDirections(route)) await addDirections(route);
  if (current !== route) return;
  const cues = courseCues(
    route,
    state.points,
    (i) =>
      t(generatedName(state.points[i]) ? pointLabel(i) : state.points[i].name),
    t,
  );
  const result = await exportFile(
    course.generate(route, exportName(), cues, {
      speedKmh,
      elevations: exportElevations(route),
    }),
    filename(state.points, state.name, format),
    { share, types: course.types, downloadType: course.downloadType },
  );
  if (missingDirections(route))
    status(
      'Course exported without turns: directions are not available now.',
      true,
    );
  else if (result === 'cancelled') return;
  else if (!exportElevations(route)) status(WITHOUT_ELEVATION);
  else if (result === 'downloaded') status(course.downloaded);
}
function exportGpx(share: boolean) {
  if (!current) return;
  const name = filename(state.points, state.name);
  void exportFile(gpxContent(), name, {
    share,
    types: GPX_TYPES,
    downloadType: GPX_DOWNLOAD,
  }).then((result) => {
    if (result === 'cancelled') return;
    if (!exportElevations(current!)) status(WITHOUT_ELEVATION);
    else if (result === 'downloaded') status('GPX downloaded.');
  });
}
$('share-gpx').onclick = () => exportGpx(true);
$('download-tcx').onclick = () => void exportCourse('tcx', shareExports);
$('download-fit').onclick = () => void exportCourse('fit', shareExports);
$('download').onclick = () => exportGpx(shareExports);
$('share').onclick = () => {
  syncUrl();
  void navigator.clipboard
    .writeText(location.href)
    .then(() =>
      status(
        current && isImportedRoute(current)
          ? 'Link copied. Opening it recalculates the route, which can differ from the imported track; share the GPX for the exact track.'
          : 'Link copied.',
      ),
    )
    .catch(() => status('Copy the link from your address bar.'));
};
/**
 * A file read by Import, used as the route: its geometry, names and recorded
 * elevation; times and sensor values are not kept.
 */
function adoptImport(parsed: ParsedTrack) {
  const imported = importParsed(parsed);
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
  if (imported.elevations) recordedElevation.set(current, imported.elevations);
  if (imported.indices)
    rememberLegs(current, legsAt(current.segments, imported.indices));
  syncUrl();
  renderPoints();
  settings();
  renderRoute(current);
  fit();
  status('Route imported. Edits recalculate only the changed sections.');
  void checkImported(current, imported.indices !== undefined);
}
/** The file the open activity came from, for Use as route. */
let activityFile: ParsedTrack | null = null;
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
      const parsed = readTrackFile(new Uint8Array(buffer));
      // A recording with times opens as an activity (#156), apart from the
      // planned route; any other file becomes the route, as before.
      const activity = activityOf(parsed);
      if (!activity) {
        adoptImport(parsed);
        return;
      }
      activityFile = parsed;
      activityView.show(
        activity,
        file.name.replace(/\.(gpx|fit|tcx)(\.gz)?$/i, ''),
      );
    })
    .catch((e: unknown) => status((e as Error).message, true))
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
// A reload during navigation shows the route that was being followed, as it
// was (a link would recalculate it), and offers to continue (#138).
const resumable = resumableNavigation(location.hash, Date.now());
if (resumable) {
  current = resumable.route;
  renderRoute(current);
} else if (state.points.every((p) => p.coord)) changed();
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
  activityView.refresh();
  syncUrl();
  void library.refreshSavedRoutes();
};

function updateSpeedEstimate() {
  if (current) renderRoute(current);
  // A route still calculating or failed keeps its own status.
  const missing = current ? null : missingPoint();
  if (current || missing) status(missing ?? 'Route ready.');
}
/** The chosen speed in the slider's value, readout and accessible text. */
function showSpeed(value: number) {
  const input = $<HTMLInputElement>('average-speed');
  input.setAttribute('aria-valuenow', String(value));
  input.setAttribute(
    'aria-valuetext',
    withUnit(value, distanceUnits() === 'imperial' ? 'mph' : 'km/h'),
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
void library.refreshSavedRoutes();
void library.refreshFavorites();
library.updateSaveButton();

/** Opens a saved route as it was stored: no routing request. */
function openSavedRoute(record: SavedRoute) {
  if (editBlocked()) return;
  const language = state.language;
  revision++;
  clearTimeout(timer);
  dirty.clear();
  drafts = new WeakMap();
  // Validation strips legacy fields such as a stored average speed.
  state = validateState(structuredClone(record.state));
  if (language) state.language = language;
  else delete state.language;
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
  void library.refreshSavedRoutes();
}

setupPanel(map);
stopTapHoldLoupe();
setupHomeScreen();
const navigation = setupNavigation({
  route: () => current,
  state: () => state,
  speedKmh: () => speedKmh,
  locale: () => (state.language === 'pt' ? 'pt-BR' : 'en'),
  status,
});
if (resumable) navigation.offerResume(resumable.progress);
const activityView = setupActivityView({
  map,
  overlays,
  locale: () => (state.language === 'pt' ? 'pt-BR' : 'en'),
  fit,
  replay: (activity, back) => navigation.replayActivity(activity, back),
  useAsRoute: () => {
    const parsed = activityFile;
    activityFile = null;
    if (parsed) adoptImport(parsed);
  },
  restore: () => {
    activityFile = null;
    if (current) renderSummary(current);
    else $('peek-main').textContent = '';
    status('Activity closed. The planned route is as you left it.');
  },
  status,
});
activityCoords = activityView.coords;
openActivity = activityView.current;
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
  library.syncLock();
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
