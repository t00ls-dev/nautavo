import type {
  GeoJSONSource,
  Map as VectorMap,
  Marker as VectorMarker,
  StyleSpecification,
} from 'maplibre-gl';
import { meters, type Coord, type Route, type State, type Step } from './core';
import { byId as $, text } from './dom';
import { t } from './i18n';
import { icon, iconControl, type IconName } from './icons';
import { gpsPoint, locationError } from './location';
import { navigationRoute } from './routing';
import { creditsDialog } from './map-credits';
import {
  NEUTRAL_STYLE,
  STYLE_URL,
  fetchStyle,
  mapPixelRatio,
  refetchTilesOnline,
  vectorCredits,
} from './basemap';
import { loadMapLibre } from './maplibre-loader';
import { maneuverText, stepRoad } from './maneuvers';
import { navigationStyle } from './navigation-style';
import {
  createNavigationTracker,
  createRerouteSchedule,
  nextStopName,
  spliceRoute,
  stopAt,
  isMoving,
  turnToward,
  navigationDistanceLabel,
  type NavigationManeuver,
  type NavigationFix,
  type NavigationReadout,
} from './navigation';
import { navigationCompass } from './navigation-compass';
import {
  addNavigationLayers,
  circleAround,
  lines,
  rejoinLine,
} from './navigation-layers';
import { maneuverGlyph, upcomingList } from './navigation-list';
import {
  navigationSwitches,
  noticeWanted,
  rememberNotice,
} from './navigation-settings';
import { travelTimeSeconds } from './travel-time';
import { departureOf } from './departure';
import {
  indexTrack,
  legPositions,
  locateOnTrack,
  type TrackIndex,
} from './track-position';
import { sunAhead } from './daylight';
import { arrivalSpeedKmh, createSpeedMeter } from './navigation-speed';
import { createVoiceSchedule } from './navigation-voice';
import {
  forgetNavigation,
  rememberNavigation,
  rememberProgress,
} from './navigation-resume';
import { speedFromKmh } from './travel-time';
import {
  METERS_PER_SECOND,
  replayAdvance,
  replayFix,
} from './navigation-replay';
import {
  activityAdvance,
  distanceAt,
  playedAt,
  playedLength,
  timeAtPlayed,
  valuesAt,
  type Activity,
  type Peak,
  type Stop,
} from './activity';
import { distanceLabel, durationLabel, MISSING } from './units';
import { distanceUnits } from './unit-preferences';
import { activityValues, PEAK_ICONS, peakLabel } from './activity-values';

/**
 * Guided navigation screen (#31, first delivery): follows the route on screen
 * with live position, next maneuver, remaining distance and arrival time.
 *
 * Location is watched only between an explicit start and Stop, and stops
 * while the page is hidden. Fixes stay in page memory and are never stored,
 * linked or sent anywhere. The only network use is the map tiles; without
 * them the route and position still draw over a neutral background.
 */

/** Short, as the data page's labels, so the notice keeps to one line. */
const PEAK_TEXT: Record<Peak['kind'], string> = {
  speed: 'Max. speed',
  hr: 'Max. HR',
  cadence: 'Max. cadence',
  power: 'Max. power',
  altitude: 'Highest point',
};
/** How long a replay notice stays, ms, and how many show at once. */
const NOTICE_MS = 5000,
  NOTICE_STACK = 4;
/** Replay speeds: a route's (× 250 m/s), a recorded activity's (× real time). */
const ROUTE_RATES = [1, 2, 5, 10],
  ACTIVITY_RATES = [1, 10, 60, 300];
/**
 * Following zoom, live and in a replay: far enough out to show a good stretch
 * of the road ahead (vector tiles are 512 px, so 15 is raster zoom 16).
 */
const ZOOM = 15;
/**
 * Replay: meters of travel for the map to turn most of the way to a new
 * direction. Counted in distance, not time, so faster replays do not lag.
 */
const REPLAY_TURN_METERS = 40;
/** How long "Route recalculated" stays on screen, ms. */
const REROUTED_NOTICE = 4000;
/** A sunset or sunrise shows this many minutes ahead, or fewer. */
const SUN_NOTICE_MINUTES = 60;
/** Room kept between the rejoin point and the screen edges, pixels. */
const REJOIN_MARGIN = 40;
/** Off the route, the map never zooms out farther than this. */
const MIN_REJOIN_ZOOM = 12;
/** How long following takes to slide back to the traveler after a zoom, ms. */
const EASE_BACK = 300;
async function loadStyle(): Promise<StyleSpecification | null> {
  const style = await fetchStyle(STYLE_URL);
  return style && navigationStyle(style);
}
/** Where the traveler sits on the map while following, as a share of its height. */
const PIVOT = 0.7;
/**
 * Screens where the guidance is two cards on the left of the map (#252);
 * the same query is in `style.css`.
 */
const LANDSCAPE = '(orientation: landscape) and (min-width: 560px)';
/**
 * The map view: following the traveler (heading-up, any zoom the traveler
 * chooses), the whole route (north-up), or free after the traveler moved or
 * zoomed it there. Anything but following at the default zoom offers Resume.
 */
type MapView = 'follow' | 'overview' | 'free';
/** Off the route by more than this (meters), the device heading is used. */
const OFF_ROUTE_HEADING = 50;
/** Road text shown for a maneuver: its name, its reference or the instruction. */
function roadText(step: Step): string {
  const road = stepRoad(step);
  const roundabout = step.exit ? maneuverText(step) : null;
  if (roundabout && road) return `${t(roundabout)} · ${road}`;
  return road || t(maneuverText(step) ?? 'Continue');
}

export function setupNavigation(deps: {
  route: () => Route | null;
  /** The planned route's state: servers, options and route points. */
  state: () => State;
  speedKmh: () => number;
  locale: () => string;
  status: (message: string, error?: boolean) => void;
}) {
  const button = $<HTMLButtonElement>('navigate'),
    notice = $<HTMLDialogElement>('nav-notice'),
    hide = $<HTMLInputElement>('nav-notice-hide'),
    setting = $<HTMLInputElement>('nav-notice-setting'),
    screen = $<HTMLDialogElement>('nav-screen'),
    stage = $('nav-stage'),
    rotor = $('nav-rotor'),
    overview = $<HTMLButtonElement>('nav-overview'),
    resume = $<HTMLButtonElement>('nav-resume'),
    compassButton = $<HTMLButtonElement>('nav-compass-button');
  // The accessible name starts with the visible label, so voice control
  // finds it by what it shows (#217); the tooltip says more.
  iconControl(button, 'navigate', 'Navigate');
  button.title = 'Start navigation';
  iconControl(resume, 'navigate', 'Re-center');
  iconControl(compassButton, 'compass', 'North up', true);
  const needle = compassButton.querySelector<SVGSVGElement>('svg')!;
  iconControl($('nav-stop'), 'close', 'End');
  $('nav-stop').title = 'End navigation';
  $('nav-stop').setAttribute('aria-label', 'End navigation');
  $('nav-notice').querySelector('.nav-notice-warning')!.prepend(icon('alert'));
  $('nav-notice')
    .querySelector('li:not(.nav-notice-warning)')!
    .prepend(icon('weather-sun'));
  $('nav-notice').querySelector('.nav-notice-reroute')!.prepend(icon('route'));
  $('nav-gps').prepend(icon('alert'));
  $('nav-no-map').prepend(icon('info'));
  $('nav-no-gl').prepend(icon('info'));
  $('nav-rerouted').prepend(icon('route'));
  $('nav-reroute-failed').prepend(icon('alert'));
  const rerouteButton = $<HTMLButtonElement>('nav-reroute');
  rerouteButton.onclick = () => reroute(true);
  $('nav-compass').prepend(icon('alert'));
  // Credits behind an info button, as on the planner map.
  const credits = creditsDialog({
    id: 'nav-credits-dialog',
    name: 'nav-credits',
  });
  stage.append(...credits.elements);
  credits.setCredits(vectorCredits);
  setting.checked = noticeWanted();
  setting.onchange = () => rememberNotice(setting.checked);
  const switches = navigationSwitches({ locale: deps.locale, screen });
  const { say, silence } = switches;
  let voice = createVoiceSchedule();

  let route: Route | null = null,
    tracker: ReturnType<typeof createNavigationTracker> | null = null,
    map: VectorMap | null = null,
    mapReady: Promise<void> | null = null,
    noStyle = false,
    /** The browser could not draw the map (no WebGL). */
    mapFailed = false,
    marker: VectorMarker | null = null,
    MarkerClass: typeof VectorMarker | null = null,
    watch: number | null = null,
    lock: WakeLockSentinel | null = null,
    view: MapView = 'follow',
    /** Zoom while following; the traveler may change it. */
    followZoom = ZOOM,
    /** Where the traveler sits (share of the height), kept in the free view. */
    pivotRatio = PIVOT,
    /** The map's current turn in degrees, kept in the free view for panning. */
    rotorAngle = 0,
    /** Following north-up instead of heading-up, chosen with the compass. */
    northUp = false,
    /** A zoom gesture is under way. */
    gestureZoom = false,
    /**
     * A gesture holds the camera, or the map eases back to the traveler
     * after a zoom: fixes and the compass leave it alone meanwhile.
     */
    held = false,
    /** A zoom gesture ended while following: ease back once it settles. */
    easeBack = false,
    heading = 0,
    /** Direction of travel: the route ahead, or the GPS course off the route. */
    travelHeading = 0,
    moving = false,
    previous: { coord: Coord; time: number } | null = null,
    last: NavigationFix | null = null,
    readout: NavigationReadout | null = null,
    announced: NavigationManeuver | 'off' | null | undefined,
    /** Each navigation gets a number; late answers of an older one are dropped. */
    session = 0,
    schedule = createRerouteSchedule(),
    rerouting: 'idle' | 'pending' | 'failed' = 'idle',
    /** GPS course while moving, degrees, or null. */
    course: number | null = null,
    reroutedTimer = 0,
    /** The device's latest speed, m/s, for the voice's thresholds. */
    speedNow = 0,
    tileErrors = 0,
    tileLoads = 0,
    pivot = { x: 0, y: 0 },
    /** Replay (#154): simulated positions instead of the device's. */
    replaying = false,
    replayIndex: TrackIndex | null = null,
    replayDistance = 0,
    /** When the replayed trip leaves, ms since the epoch. */
    replayDeparture = 0,
    replayFrame = 0,
    replayLast = 0,
    /** Replay distance when the heading was last chosen, for smoothing. */
    headingDistance = 0,
    /** Replay: direction of the road's segment under the traveler, or null. */
    replayBearing: number | null = null,
    /** A recorded activity being replayed at its own pace (#156), or null. */
    activity: Activity | null = null,
    /** The replayed activity's recorded time, ms since the epoch. */
    activityTime = 0,
    /** What gets the focus back when the activity replay ends. */
    activityBack: HTMLElement | null = null,
    /** A travelled-line redraw is under way; the latest progress waits. */
    travelledBusy = false,
    travelledNext: number | null = null,
    /** How long a travelled-line redraw takes to show, ms (smoothed). */
    travelledDelay = 50,
    /** The planned route and the traveler's progress on it, for the trip's
        average and the sun notices. */
    plannedIndex: TrackIndex | null = null,
    plannedProgress = 0,
    /** What the sun notice was computed for, to redo it only on a change. */
    sunShown = '',
    /** Minutes to a sunset before the arrival, for the voice; else null. */
    sunsetIn: number | null = null,
    /** Current speed and the trip's average for the arrival (#32, #136). */
    meter = createSpeedMeter();
  /** The traveler's clock: simulated while replaying. */
  const now = () =>
    activity
      ? activityTime
      : replaying && replayIndex
        ? replayDeparture +
          travelTimeSeconds(replayDistance, deps.speedKmh()) * 1000
        : Date.now();

  const units = () => distanceUnits();

  /** Every view but the default one offers a clear way back to following. */
  function setViewButtons() {
    iconControl(overview, 'route', 'Route overview', true);
    overview.hidden = view === 'overview';
    resume.hidden = view === 'follow' && followZoom === ZOOM && !northUp;
  }
  /** Turns the map to `angle` and the compass needle with it. */
  function setRotor(angle: number, fromGesture = false) {
    rotorAngle = angle;
    const shown = Math.round(angle * 10) / 10 || 0;
    // The vector map turns itself, so its labels stay upright.
    report();
    if (
      map &&
      !fromGesture &&
      !held &&
      Math.abs(map.getBearing() + shown) > 0.05
    )
      map.setBearing(-shown);
    // The compass shows only on a turned map and points to its north.
    compassButton.hidden = !shown;
    needle.style.transform = shown ? `rotate(${shown}deg)` : '';
    turnArrow();
  }
  /** The map's turn and zoom, readable on the page (and by tests). */
  function report() {
    rotor.dataset.turn = String(Math.round(rotorAngle * 10) / 10 || 0);
    if (map) rotor.dataset.zoom = map.getZoom().toFixed(2);
  }
  /** The position arrow points along the heading on the turned map. */
  function turnArrow() {
    const arrow = marker
      ?.getElement()
      ?.querySelector<HTMLElement>('.nav-arrow');
    // A replay's map turns smoothly, so its arrow takes the direction of the
    // road's own segment under the traveler rather than the map's.
    const direction = replaying ? (replayBearing ?? heading) : heading;
    const angle = Math.round((direction + rotorAngle) * 10) / 10 || 0;
    if (arrow) arrow.style.transform = `rotate(${angle}deg)`;
    turnRejoinArrow();
  }
  /** Off the route, the banner arrow points to the rejoin point on screen. */
  function turnRejoinArrow() {
    const svg = $('nav-turn').querySelector<SVGElement>('.rejoin');
    if (!svg || !readout?.rejoin) return;
    const angle =
      Math.round((((readout.rejoin.bearing + rotorAngle) % 360) + 360) % 360) ||
      0;
    svg.style.transform = `rotate(${angle}deg)`;
  }
  /** A pinch or double tap: following keeps following, at that zoom. */
  function userZoom() {
    if (!map) return;
    if (view === 'follow') followZoom = map.getZoom();
    else view = 'free';
    setViewButtons();
  }
  /** A pan or a turn stops following. */
  function goFree() {
    if (view === 'free') return;
    view = 'free';
    setViewButtons();
  }

  /**
   * Moving, the map turns with the direction of travel; stopped, with the
   * compass, so it follows where the phone points. The compass is not used
   * while moving: mounts and car metal often make it wrong.
   */
  function chooseHeading() {
    const reading = deviceCompass.heading();
    const target = !moving && reading !== null ? reading : travelHeading;
    // A playing replay crosses many small bends a second; turning part of the
    // way for each meter travelled keeps the map from shaking. Live fixes,
    // paused or dragged replays turn at once.
    if (replaying && replayFrame) {
      const travelled = Math.abs(replayDistance - headingDistance);
      heading = turnToward(
        heading,
        target,
        1 - Math.exp(-travelled / REPLAY_TURN_METERS),
      );
    } else heading = target;
    headingDistance = replayDistance;
  }
  /** Asks to calibrate only while the compass is what turns the map. */
  function calibrationNotice() {
    $('nav-compass').hidden = !(deviceCompass.poor() && !moving);
  }
  /** Turns the map (while following) and the position arrow. */
  function applyHeading() {
    // A tenth of a degree is finer than the eye sees; it keeps styles short.
    const angle = Math.round(heading * 10) / 10 || 0;
    if (view === 'follow') setRotor(northUp ? 0 : -angle);
    else turnArrow();
  }
  const deviceCompass = navigationCompass({
    onReading() {
      chooseHeading();
      applyHeading();
      calibrationNotice();
    },
    idle: () => !moving,
    active: () => screen.open,
  });

  /**
   * The traveler sits at `pivotRatio` of the height through the map's
   * padding, centered in the map left free beside the cards in landscape.
   */
  function layout() {
    const w = stage.clientWidth,
      h = stage.clientHeight,
      left = cardsRight();
    pivot = { x: left + (w - left) / 2, y: h * pivotRatio };
    if (!map) return;
    map.resize();
    map.setPadding({
      top: Math.max(0, 2 * pivot.y - h),
      bottom: Math.max(0, h - 2 * pivot.y),
      left,
      right: 0,
    });
    place();
  }

  async function createMap() {
    // A style missing because the device was offline is asked again when the
    // connection returns, even if it returns while the map is being created.
    const offlineAtStart = !navigator.onLine;
    const [ml, style] = await Promise.all([loadMapLibre(), loadStyle()]);
    MarkerClass = ml.Marker;
    noStyle = !style;
    const pixelRatio = mapPixelRatio();
    map = new ml.Map({
      container: 'nav-map',
      style: style ?? NEUTRAL_STYLE,
      attributionControl: false,
      center: [0, 0],
      zoom: ZOOM,
      maxPitch: 0,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      // Pinch, double tap, two-finger tap and one-finger zoom work as on the
      // planner map, around the fingers; following then eases back to the
      // traveler (see `zoomend`).
      boxZoom: false,
      keyboard: false,
      fadeDuration: 0,
      renderWorldCopies: false,
      // The screen's resolution, or one pixel per CSS pixel without a GPU.
      ...(pixelRatio ? { pixelRatio } : {}),
      // MapLibre's default 'same-origin' credentials send nothing cross-origin.
    });
    const m = map;
    // Tiles that failed offline are asked again when the connection returns.
    refetchTilesOnline(m);
    // Gestures carry the event that caused them; the code's moves do not.
    // One finger pans; two fingers pinch, and their drift is not a pan.
    m.on('dragstart', (e) => {
      if (!e.originalEvent) return;
      held = true;
      if (!((e.originalEvent as TouchEvent).touches?.length > 1)) goFree();
    });
    m.on('rotate', (e) => {
      if (!e.originalEvent) return;
      goFree();
      setRotor(-m.getBearing(), true);
    });
    m.on('zoomstart', (e) => {
      if (!e.originalEvent) return;
      gestureZoom = true;
      held = true;
    });
    m.on('zoom', report);
    m.on('zoomend', () => {
      if (!gestureZoom) return;
      gestureZoom = false;
      userZoom();
      easeBack = view === 'follow';
    });
    // The zoom was around the fingers: following slides the traveler back
    // to its place, at the new zoom.
    m.on('moveend', () => {
      const coord = last?.coord ?? route?.segments[0]?.[0];
      if (!easeBack || !coord) {
        easeBack = false;
        held = false;
        return;
      }
      easeBack = false;
      m.easeTo({
        center: [coord[1], coord[0]],
        zoom: zoomToRejoin(coord),
        bearing: -Math.round(rotorAngle * 10) / 10 || 0,
        duration: EASE_BACK,
      });
    });
    m.on('error', () => {
      tileErrors++;
      mapNotice();
    });
    m.on('data', (e) => {
      if ((e as { tile?: unknown }).tile) {
        tileLoads++;
        mapNotice();
      }
    });
    await new Promise<void>((resolve) => {
      if (m.isStyleLoaded()) resolve();
      else m.once('load', () => resolve());
    });
    addNavigationLayers(m);
    // The map lives as long as the page: a style that failed offline is
    // asked again when the connection returns (one attempt per `online`
    // event, as the planner does), with the route and the travelled line
    // drawn again over it.
    const retryStyle = () => {
      if (!noStyle) return;
      void loadStyle().then((next) => {
        if (!next || !noStyle) return;
        noStyle = false;
        m.once('style.load', () => {
          addNavigationLayers(m);
          if (route) drawRoute(route);
          render();
          mapNotice();
        });
        m.setStyle(next, { diff: false });
      });
    };
    window.addEventListener('online', retryStyle);
    // Back online while the map was being created: that event has passed.
    if (offlineAtStart && navigator.onLine) retryStyle();
  }
  /** The dashed way back from the position to the rejoin point, or nothing. */
  function drawRejoin() {
    const rejoin = readout?.rejoin;
    void source('rejoin')?.setData(
      rejoin && last ? rejoinLine(last.coord, rejoin.coord) : lines([]),
    );
  }
  /** Without tiles the route still draws over the neutral background. */
  function mapNotice() {
    $('nav-no-gl').hidden = !mapFailed;
    $('nav-no-map').hidden =
      mapFailed ||
      (navigator.onLine && !noStyle && !(tileErrors >= 4 && !tileLoads));
  }
  const source = (id: string) => map?.getSource<GeoJSONSource>(id);

  function drawRoute(next: Route) {
    void source('route')?.setData(lines(next.segments));
    void source('travelled')?.setData(lines([]));
  }

  /**
   * While following off the route, the zoom steps out just enough for the
   * rejoin point to show between the traveler and the screen edges, in any
   * direction; on the route it is the traveler's chosen zoom.
   */
  function zoomToRejoin(coord: Coord): number {
    const rejoin = readout?.rejoin;
    if (!rejoin) return followZoom;
    const w = stage.clientWidth - cardsRight();
    const room = Math.max(
      60,
      Math.min(pivot.y - bannerAbove(), w / 2, stage.clientHeight - pivot.y) -
        REJOIN_MARGIN,
    );
    // Meters per CSS pixel at the follow zoom (512 px vector tiles).
    const perPixel =
      (40075016.7 * Math.cos((coord[0] * Math.PI) / 180)) /
      (512 * 2 ** followZoom);
    const needed = rejoin.straight / perPixel;
    return needed <= room
      ? followZoom
      : Math.max(MIN_REJOIN_ZOOM, followZoom - Math.log2(needed / room));
  }
  /** Moves the map and the marker to the latest fix (or the route start). */
  function place() {
    if (!map || !route) return;
    const coord = last?.coord ?? route.segments[0]?.[0];
    if (!coord) return;
    if (view === 'follow' && !held)
      map.jumpTo({ center: [coord[1], coord[0]], zoom: zoomToRejoin(coord) });
    else if (view === 'overview') {
      setRotor(0);
      const all = route.segments.flat();
      const lats = all.map((c) => c[0]),
        lons = all.map((c) => c[1]);
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        {
          animate: false,
          bearing: 0,
          // The floating banner covers the top of the map, or the cards
          // its left side in landscape.
          padding: {
            top: 24 + bannerAbove(),
            bottom: 24,
            left: 24 + cardsRight(),
            right: 24,
          },
        },
      );
    }
    if (!last) {
      applyHeading();
      return;
    }
    if (!marker && MarkerClass) {
      const element = document.createElement('div');
      element.className = 'nav-position';
      element.setAttribute('aria-hidden', 'true');
      element.innerHTML = '<span class="nav-arrow"></span>';
      element.querySelector('.nav-arrow')!.append(icon('navigate'));
      // Subpixel, so the arrow does not wobble against the moving map.
      marker = new MarkerClass({ element, subpixelPositioning: true })
        .setLngLat([last.coord[1], last.coord[0]])
        .addTo(map);
    } else marker?.setLngLat([last.coord[1], last.coord[0]]);
    marker?.getElement().classList.toggle('weak', !!readout?.weak);
    void source('accuracy')?.setData(
      readout?.weak ? circleAround(last.coord, last.accuracy) : lines([]),
    );
    applyHeading();
  }

  function render() {
    if (!route || !tracker) return;
    if (activity) {
      renderActivity(activity);
      return;
    }
    if (renderPasses()) return;
    const r = readout;
    const turn = $('nav-turn');
    const arrived = !!r?.arrived;
    // Arrived: nothing left to continue after a reload.
    if (arrived && !replaying) forgetNavigation();
    const rejoin = !arrived ? (r?.rejoin ?? null) : null;
    screen.classList.toggle('off-route', !!rejoin);
    $('nav-hint').hidden = !rejoin;
    renderReroute(!!rejoin);
    drawRejoin();
    if (rejoin) {
      // Off the route: an arrow to the rejoin point and the straight distance.
      const arrow = icon('maneuver-straight');
      arrow.classList.add('rejoin');
      turn.replaceChildren(arrow);
      turnRejoinArrow();
      $('nav-distance').hidden = false;
      $('nav-distance').textContent = navigationDistanceLabel(
        rejoin.straight,
        units(),
        deps.locale(),
      );
      $('nav-road').textContent = 'Back to route';
      $('nav-then').hidden = true;
    } else renderManeuver(r, arrived);
    announce(r, arrived, !!rejoin);
    renderSun();
    // A maneuver comes first; the sunset waits for a quiet readout.
    say(
      voice.next(r, speedNow, units(), deps.locale(), nextStop(r)) ??
        voice.sunset(sunsetIn),
    );
    renderBar(r);
    upcoming.render();
    renderSpeed();
  }
  /** The passes on screen, by their along-track distances. */
  let passesShown = '';
  /**
   * Where the route uses the same road more than once and the start cannot
   * tell which pass the traveler is on (#191), the banner asks, with one
   * button per pass: the next route point and the distance left. Nothing is
   * said or shown as ahead until one is chosen. False when there is no
   * question.
   */
  function renderPasses(): boolean {
    const choices = tracker?.choices ?? null;
    screen.classList.toggle('choosing-pass', !!choices);
    $('nav-pass').hidden = !choices;
    if (!choices) {
      passesShown = '';
      return false;
    }
    const key = choices.map((p) => Math.round(p.at)).join();
    if (key !== passesShown) {
      passesShown = key;
      $('nav-announce').textContent = t('Which way are you going?');
      const total = tracker!.total;
      $('nav-pass-options').replaceChildren(
        ...choices.map((pass) => {
          const button = document.createElement('button');
          button.type = 'button';
          const name = t(nextStopName(stopPlaces, pass.at));
          button.title = name;
          button.append(
            icon('pin'),
            text('span', name, 'nav-pass-name'),
            document.createTextNode(' '),
            text(
              'span',
              distanceLabel(total - pass.at, units(), deps.locale()),
              'nav-pass-left',
            ),
          );
          button.addEventListener('click', () => choosePass(pass.at));
          return button;
        }),
      );
    }
    $('nav-hint').hidden = true;
    $('nav-then').hidden = true;
    screen.classList.remove('off-route');
    renderBar(null);
    upcoming.render();
    renderSpeed();
    return true;
  }
  function choosePass(at: number) {
    if (!tracker) return;
    tracker.choose(at);
    plannedProgress = at;
    readout = last ? tracker.update(last) : null;
    if (!replaying) rememberProgress(plannedProgress, Date.now());
    // The buttons are gone; the screen keeps the focus.
    screen.focus({ preventScroll: true });
    render();
    place();
  }
  /**
   * The speed the arrival follows: the trip's own average once it has lasted
   * a while (#32); a replay travels at the configured average speed.
   */
  function arrivalSpeed(): number {
    return replaying
      ? deps.speedKmh()
      : arrivalSpeedKmh(meter, Date.now(), deps.speedKmh(), units());
  }
  /** The current speed badge (#136); a replay shows its own speed. */
  function renderSpeed() {
    // An activity shows its speed with its other values.
    const metersPerSecond = activity
      ? null
      : replaying
        ? replayFrame
          ? deps.speedKmh() / 3.6
          : 0
        : last
          ? meter.current()
          : null;
    const badge = $('nav-speed');
    badge.hidden = metersPerSecond === null;
    if (metersPerSecond === null) return;
    const imperial = units() === 'imperial';
    const value = String(
      Math.round(speedFromKmh(metersPerSecond * 3.6, units())),
    );
    const unit = imperial ? 'mph' : 'km/h';
    if (badge.dataset.value !== value || badge.dataset.unit !== unit) {
      badge.dataset.value = value;
      badge.dataset.unit = unit;
      $('nav-speed-value').textContent = value;
      $('nav-speed-unit').textContent = unit;
      badge.setAttribute('aria-label', `${value} ${unit}`);
    }
  }
  /**
   * The next sunset or sunrise before the arrival, within the hour, as a
   * chip ("Sunset in 40 min"): local, from the route, the progress and the
   * trip's speed, so it never goes stale. Weather stays in the planner.
   */
  function renderSun() {
    const planned = deps.route(),
      at = now();
    const key = `${Math.floor(at / 60_000)}:${Math.round(plannedProgress / 250)}:${Math.round(arrivalSpeed())}`;
    if (key === sunShown) return;
    sunShown = key;
    const sun = planned
      ? sunAhead(planned, plannedProgress, at, arrivalSpeed())
      : null;
    const minutes = sun
      ? Math.max(1, Math.round((sun.time - at) / 60_000))
      : Infinity;
    sunsetIn = sun?.kind === 'sunset' ? minutes : null;
    const chip = $('nav-sun');
    chip.hidden = minutes > SUN_NOTICE_MINUTES;
    if (!sun || chip.hidden) return;
    // English text: the page translator turns it into the chosen language.
    chip.replaceChildren(
      icon(sun.kind),
      text(
        'span',
        `${sun.kind === 'sunset' ? 'Sunset' : 'Sunrise'} in ${minutes} min`,
      ),
    );
  }
  /** The Recalculate route button and the failure notice, off the route. */
  function renderReroute(offRoute: boolean) {
    const online = navigator.onLine,
      wait = schedule.wait(Date.now());
    rerouteButton.hidden = !offRoute || !online;
    $('nav-reroute-failed').hidden = !offRoute || rerouting !== 'failed';
    const label =
      rerouting === 'pending'
        ? 'Recalculating…'
        : wait > 0
          ? `Recalculate in ${Math.ceil(wait / 1000)} s`
          : 'Recalculate route';
    if (rerouteButton.dataset.label !== label) {
      rerouteButton.dataset.label = label;
      iconControl(rerouteButton, 'refresh', label);
    }
    rerouteButton.disabled = !schedule.manual(Date.now(), online);
  }
  function renderManeuver(r: NavigationReadout | null, arrived: boolean) {
    const turn = $('nav-turn');
    const step = arrived ? null : (r?.next?.step ?? null);
    turn.replaceChildren(maneuverGlyph(step));
    $('nav-distance').textContent = arrived
      ? ''
      : navigationDistanceLabel(
          r ? r.toNext : (tracker?.total ?? 0),
          units(),
          deps.locale(),
        );
    $('nav-distance').hidden = arrived;
    $('nav-road').textContent = arrived
      ? 'You have arrived'
      : step
        ? t(nextStop(r) ?? roadText(step))
        : 'Destination';
    const after = !arrived && r?.after ? r.after : null;
    $('nav-then').hidden = !after;
    if (after) {
      $('nav-then-icon').replaceChildren(maneuverGlyph(after.step));
      $('nav-then-distance').textContent = navigationDistanceLabel(
        r!.afterGap,
        units(),
        deps.locale(),
      );
    }
  }
  /** Spoken by screen readers only when the maneuver or the state changes. */
  function announce(
    r: NavigationReadout | null,
    arrived: boolean,
    offRoute: boolean,
  ) {
    const current = offRoute ? 'off' : arrived ? null : (r?.next ?? null);
    if (!r || current === announced) return;
    announced = current;
    $('nav-announce').textContent = offRoute
      ? `${t('Off the route')} · ${t('Back to route')}`
      : arrived
        ? t('You have arrived')
        : r.next
          ? `${t(maneuverText(r.next.step) ?? 'Continue')} · ${roadText(r.next.step)}`
          : t('Destination');
  }
  function renderBar(r: NavigationReadout | null) {
    if (!tracker) return;
    const remaining = r ? r.remaining : tracker.total;
    const seconds = travelTimeSeconds(remaining, arrivalSpeed());
    $('nav-time').textContent = r ? durationLabel(seconds) : MISSING;
    // Until a pass is chosen (#191), the distance left is not known either.
    if (tracker.choices) {
      $('nav-rest').textContent = MISSING;
      $('nav-waiting').hidden = true;
      $('nav-gps').hidden = true;
      return;
    }
    const clock = new Date(now() + seconds * 1000).toLocaleTimeString(
      deps.locale(),
      { hour: '2-digit', minute: '2-digit' },
    );
    $('nav-rest').textContent =
      `${distanceLabel(remaining, units(), deps.locale())}${r ? ` · ${clock}` : ''}`;
    // The map's chips say when the signal is missing or weak; the bar keeps
    // to the time and distance.
    $('nav-waiting').hidden = !!last || replaying;
    $('nav-gps').hidden = !last || !r?.weak;
    if (r) drawTravelled(Math.min(tracker.total, r.progress + replayLead()));
  }
  /**
   * A playing replay moves on while the travelled line is redrawn, so the
   * line is drawn as far ahead as the arrow goes meanwhile, never beyond the
   * arrow's radius: the end stays under the arrow instead of behind it.
   */
  function replayLead(): number {
    if (!replaying || !replayFrame || !map || !last) return 0;
    const speed =
      (activity
        ? (valuesAt(activity, activityTime).speed ?? 0)
        : METERS_PER_SECOND) * Number(replayRate.value);
    // Meters per CSS pixel at this zoom (512 px vector tiles).
    const perPixel =
      (40075016.7 * Math.cos((last.coord[0] * Math.PI) / 180)) /
      (512 * 2 ** map.getZoom());
    const radius = (marker?.getElement().offsetWidth ?? 28) / 2;
    return Math.min((speed * travelledDelay) / 1000, radius * perPixel);
  }
  /**
   * Redraws the travelled line up to `progress`. Each redraw goes through
   * MapLibre's worker; while one is under way only the latest progress waits,
   * so a playing replay keeps the line right behind the arrow without a queue.
   */
  function drawTravelled(progress: number) {
    const target = source('travelled');
    if (!target || !tracker) return;
    if (travelledBusy) {
      travelledNext = progress;
      return;
    }
    travelledBusy = true;
    const sent = performance.now();
    void target
      .setData(lines(tracker.travelled(progress)))
      .catch(() => undefined)
      .finally(() => {
        travelledBusy = false;
        travelledDelay =
          0.7 * travelledDelay + 0.3 * (performance.now() - sent);
        const next = travelledNext;
        travelledNext = null;
        if (next !== null) drawTravelled(next);
      });
  }

  function onFix(position: GeolocationPosition) {
    if (!tracker) return;
    const {
      latitude,
      longitude,
      accuracy,
      heading: deviceHeading,
    } = position.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const coord: Coord = [latitude, longitude];
    // The device's speed, or one measured between fixes when it gives none.
    const time = position.timestamp || Date.now();
    let speed: number | null = Number.isFinite(position.coords.speed)
      ? position.coords.speed
      : null;
    if (speed === null && previous && time - previous.time >= 500)
      speed = meters(previous.coord, coord) / ((time - previous.time) / 1000);
    previous = { coord, time };
    moving = isMoving(speed, moving);
    speedNow = speed ?? speedNow;
    // The GPS course, while moving, tells the router which way the
    // traveler is going, and the start which pass of the route (#191); the
    // compass is not reliable enough for that.
    course =
      moving && deviceHeading !== null && Number.isFinite(deviceHeading)
        ? deviceHeading
        : null;
    last = { coord, accuracy: Math.max(0, accuracy || 0), course };
    deviceCompass.placeAt(last.coord);
    // A replay knows its distance along the route; live fixes are located.
    // While the traveler has not chosen a pass, nothing is shown as ahead.
    readout = tracker.update(last, replaying ? replayDistance : undefined);
    if (tracker.choices) readout = null;
    // Progress on the planned route: the trip's average and the sun notices
    // are measured on it, so both hold after a recalculation.
    if (replaying) plannedProgress = replayDistance;
    else if (plannedIndex) {
      const position = locateOnTrack(plannedIndex, last.coord, {
        progress: plannedProgress,
        backtrack: 50,
      });
      if (position) plannedProgress = position.distance;
      // A pass still to be chosen is not one to continue after a reload.
      if (!tracker.choices) rememberProgress(plannedProgress, Date.now());
      meter.update({
        time,
        progress: plannedProgress,
        speed,
        accuracy: last.accuracy,
        moving,
      });
    }
    const offRoute =
      !readout || readout.offTrack > Math.max(OFF_ROUTE_HEADING, last.accuracy);
    // A replay gives its own heading, looking further ahead than the tracker.
    if (replaying && deviceHeading !== null && Number.isFinite(deviceHeading))
      travelHeading = deviceHeading;
    else if (
      !offRoute &&
      readout?.heading !== null &&
      readout?.heading !== undefined
    )
      travelHeading = readout.heading;
    else if (deviceHeading !== null && Number.isFinite(deviceHeading))
      travelHeading = deviceHeading;
    chooseHeading();
    calibrationNotice();
    render();
    place();
    reroute(false);
  }
  let stopPlaces: { at: number | null; name: string }[] = [];
  /** The intermediate stop the next maneuver arrives at, by name. */
  function nextStop(r: NavigationReadout | null): string | null {
    const next = r?.next;
    return next?.step.kind === 'arrive' ? stopAt(stopPlaces, next.at) : null;
  }
  function placeStops() {
    if (!route) return;
    // A recorded activity has no route points.
    if (activity) {
      stopPlaces = [];
      return;
    }
    const points = deps
      .state()
      .points.slice(1)
      .filter((p) => p.coord);
    const at = legPositions(
      route.segments,
      points.map((p) => p.coord!),
    );
    stopPlaces = points.map((p, i) => ({
      at: at[i],
      name:
        p.name || (i === points.length - 1 ? 'Destination' : `Stop ${i + 1}`),
    }));
  }
  const upcoming = upcomingList({
    screen,
    toggle: $<HTMLButtonElement>('nav-list-toggle'),
    list: $<HTMLOListElement>('nav-list'),
    ahead: () =>
      tracker && {
        maneuvers: tracker.maneuvers,
        stops: stopPlaces,
        progress: readout?.progress ?? plannedProgress,
        departure: tracker.departure,
      },
    arrivalSpeed,
    now,
    locale: deps.locale,
  });
  /** Route points after the start, so neither hint nor reroute skips one. */
  function stops(): Coord[] {
    if (activity) return [];
    return deps
      .state()
      .points.slice(1)
      .flatMap((p) => (p.coord ? [p.coord] : []));
  }
  /**
   * Off the route, asks the router for a way back to the planned route,
   * automatically or from the button, within `createRerouteSchedule`'s
   * limits. Only the position and the course are sent; the new
   * route lives in page memory until End.
   */
  function reroute(manual: boolean) {
    if (replaying) return;
    const r = readout;
    if (!r?.rejoin || !last || !route || !tracker) return;
    const now = Date.now(),
      online = navigator.onLine;
    if (
      manual
        ? !schedule.manual(now, online)
        : !switches.autoReroute() || !schedule.auto(now, r.offSince, online)
    )
      return;
    const target = tracker.rerouteTarget(r.rejoin);
    if (!target) return;
    const planned = route,
      mine = session;
    // Superseded once navigation ends or the traveler is back on the route.
    const isCurrent = () => mine === session && !!readout?.offRoute;
    schedule.start(now, !manual);
    rerouting = 'pending';
    render();
    navigationRoute(
      deps.state(),
      gpsPoint(last.coord),
      target.coord,
      course,
      isCurrent,
    )
      .then((fresh) => {
        if (!isCurrent() || route !== planned || !last) return;
        route = spliceRoute(planned, fresh, target.at);
        tracker = createNavigationTracker(route, stops());
        placeStops();
        readout = tracker.update(last);
        announced = undefined;
        drawRoute(route);
        rerouting = 'idle';
        $('nav-rerouted').hidden = false;
        say(voice.rerouted());
        clearTimeout(reroutedTimer);
        reroutedTimer = window.setTimeout(
          () => ($('nav-rerouted').hidden = true),
          REROUTED_NOTICE,
        );
      })
      .catch(() => {
        // No retry: the local hint stays until the next allowed attempt.
        if (mine === session) rerouting = 'failed';
      })
      .finally(() => {
        if (mine !== session) return;
        schedule.finish();
        if (rerouting === 'pending') rerouting = 'idle';
        render();
        place();
      });
  }
  function onError(error: GeolocationPositionError) {
    if (error.code === 1) {
      stop();
      deps.status(locationError(1), true);
      return;
    }
    // Timeout or no signal: keep watching and say the GPS is being awaited.
    last = null;
    readout = null;
    render();
  }

  function startWatching() {
    if (watch !== null || !navigator.geolocation) return;
    watch = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000,
    });
  }
  function stopWatching() {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
  }
  async function keepScreenOn() {
    if (lock || !('wakeLock' in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!screen.open) {
        void sentinel.release();
        return;
      }
      lock = sentinel;
      sentinel.addEventListener('release', () => {
        if (lock === sentinel) lock = null;
        render();
      });
    } catch {
      lock = null;
    }
    render();
  }
  /** Location stops while the page is hidden and resumes when it is shown. */
  function onVisibility() {
    if (!screen.open) return;
    if (replaying) {
      if (document.visibilityState === 'hidden') setReplayPlaying(false);
      return;
    }
    if (document.visibilityState === 'hidden') {
      stopWatching();
      silence();
      // A hidden tab may be discarded: keep the latest progress now.
      rememberProgress(plannedProgress, Date.now(), true);
    } else {
      startWatching();
      void keepScreenOn();
    }
  }
  // The map follows its area's size, not the window's resize events: turning
  // an iPhone fires them while the screen is still rotating, and the map then
  // kept an in-between width (#252).
  new ResizeObserver(() => {
    if (screen.open) layout();
  }).observe(stage);
  const onNetwork = () => mapNotice();

  /**
   * `remind`: the notice was skipped, so a chip says recalculation is on.
   * `replay`: simulated positions along the route, with no location.
   */
  function start(
    remind: boolean,
    replay = false,
    progress = 0,
    replayed: Route | null = null,
  ) {
    route = replayed ?? deps.route();
    if (!route) return;
    plannedIndex = indexTrack(route.segments);
    plannedProgress = progress;
    // Kept in this tab so a reload can continue it (#138); a replay is not.
    if (!replay) rememberNavigation(route, location.hash, Date.now(), progress);
    meter = createSpeedMeter();
    sunShown = '';
    sunsetIn = null;
    session++;
    switches.hideAutoChip();
    voice = createVoiceSchedule();
    // Start and Continue are taps: iOS lets speech begin only from one.
    if (!activity) say('Navigation started.');
    travelledBusy = false;
    travelledNext = null;
    replaying = replay;
    screen.classList.toggle('replaying', replay);
    // An activity has no turns ahead: its replay shows no list of them.
    screen.classList.toggle('activity-replay', !!activity);
    $('nav-replay').hidden = !replay;
    if (remind && !replay) switches.remindAutoReroute();
    schedule = createRerouteSchedule();
    rerouting = 'idle';
    course = null;
    // A live start from the beginning asks which pass the traveler is on
    // where the route uses the same road more than once (#191).
    tracker = createNavigationTracker(
      route,
      stops(),
      progress,
      !replay && !activity && progress === 0,
    );
    placeStops();
    upcoming.set(false);
    deviceCompass.placeAt(route.segments[0]?.[0]);
    last = null;
    readout = null;
    announced = undefined;
    view = 'follow';
    followZoom = ZOOM;
    pivotRatio = PIVOT;
    northUp = false;
    setRotor(0);
    heading = 0;
    travelHeading = 0;
    deviceCompass.forget();
    moving = false;
    previous = null;
    tileErrors = 0;
    tileLoads = 0;
    setViewButtons();
    screen.showModal();
    // iOS 26 ignores -webkit-touch-callout on the map itself; with selection
    // off on the whole page (as `html.map-touching` does for the planner
    // map), no callout or selection menu opens while navigating.
    document.documentElement.classList.add('navigating');
    // The planner's location watch stops before this one starts.
    document.dispatchEvent(new Event('navigationchange'));
    // The screen itself takes focus, not its first button, so no button
    // looks selected when navigation starts.
    screen.focus({ preventScroll: true });
    // Without WebGL there is no map; the directions above still guide.
    mapReady ??= createMap().catch(() => {
      mapFailed = true;
      map = null;
    });
    const shown = route;
    void mapReady.then(() => {
      if (route !== shown) return;
      mapNotice();
      if (!map) return;
      drawRoute(shown);
      setRotor(rotorAngle);
      layout();
      render();
    });
    layout();
    mapNotice();
    render();
    if (activity) activityAt(activityTime);
    else if (replay) replayAt(replayDistance);
    else {
      startWatching();
      deviceCompass.watch();
      void keepScreenOn();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
  }
  function stop() {
    if (screen.open) screen.close();
  }
  /** Every way out (Stop, Escape, the back gesture) ends here. */
  function cleanup() {
    // A recalculation still under way belongs to this navigation only.
    session++;
    forgetNavigation();
    silence();
    const wasReplay = replaying;
    if (replaying) {
      setReplayPlaying(false);
      replaying = false;
      screen.classList.remove('replaying');
      $('nav-replay').hidden = true;
    }
    const back = activity ? activityBack : null;
    if (activity) endActivity();
    clearTimeout(reroutedTimer);
    $('nav-rerouted').hidden = true;
    switches.hideAutoChip();
    $('nav-sun').hidden = true;
    document.documentElement.classList.remove('navigating');
    stopWatching();
    // The planner's location watch resumes only after this one has stopped.
    document.dispatchEvent(new Event('navigationchange'));
    deviceCompass.stop();
    const sentinel = lock;
    lock = null;
    void sentinel?.release().catch(() => undefined);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onNetwork);
    window.removeEventListener('offline', onNetwork);
    marker?.remove();
    marker = null;
    void source('accuracy')?.setData(lines([]));
    last = null;
    readout = null;
    tracker = null;
    route = null;
    (back ?? (wasReplay ? travel : button)).focus();
    replayIndex = null;
  }
  screen.addEventListener('close', cleanup);
  // Navigation is offered exactly when the route can be downloaded: a route
  // is on screen and no edit has made it stale.
  const download = $<HTMLButtonElement>('download');
  // Travel the route (#154) replays the same route on this screen.
  const travel = $<HTMLButtonElement>('travel-route');
  const sync = () =>
    (button.disabled = travel.disabled = download.disabled || !deps.route());
  new MutationObserver(sync).observe(download, {
    attributes: true,
    attributeFilter: ['disabled'],
  });
  sync();

  button.onclick = () => {
    if (!deps.route()) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      deps.status(
        'Navigation needs location, which this browser does not offer here.',
        true,
      );
      return;
    }
    if (noticeWanted()) {
      hide.checked = false;
      switches.syncNotice();
      notice.showModal();
    } else start(true);
  };
  $('nav-notice-start').onclick = () => {
    if (hide.checked) {
      rememberNotice(false);
      setting.checked = false;
    }
    notice.close();
    start(false);
  };
  $('nav-stop').onclick = stop;
  // After a reload during navigation (#138): location starts only after
  // this tap, as it does after Start navigation.
  const resumeNotice = $<HTMLDialogElement>('nav-resume-notice');
  let resumeAt = 0;
  $('nav-resume-continue').onclick = () => {
    resumeNotice.close();
    start(false, false, resumeAt);
  };
  $('nav-resume-dismiss').onclick = () => {
    forgetNavigation();
    resumeNotice.close();
  };
  /**
   * The pressed button hides, so focus moves on: to the other button from a
   * keyboard, to the screen after a tap, so no button looks selected.
   */
  const moveFocus = (event: MouseEvent, next: HTMLElement) =>
    (event.detail ? screen : next).focus({ preventScroll: true });
  overview.onclick = (event) => {
    view = 'overview';
    pivotRatio = 0.5;
    setViewButtons();
    layout();
    moveFocus(event, resume);
  };
  resume.onclick = (event) => {
    view = 'follow';
    northUp = false;
    followZoom = ZOOM;
    pivotRatio = PIVOT;
    setViewButtons();
    layout();
    moveFocus(event, overview);
  };
  /** North up: following keeps following, north-up; other views just turn. */
  compassButton.onclick = (event) => {
    if (view === 'follow') northUp = true;
    setRotor(0);
    setViewButtons();
    moveFocus(event, resume);
  };
  // Notices and buttons stay below the floating banner, whatever its height;
  // in landscape they sit beside the cards instead (#252).
  const banner = screen.querySelector<HTMLElement>('.nav-banner')!;
  const landscape = matchMedia(LANDSCAPE);
  /** How far down the banner covers the map, px. */
  function bannerBottom() {
    const b = banner.getBoundingClientRect(),
      s = stage.getBoundingClientRect();
    return b.left < s.right && b.right > s.left
      ? Math.max(0, b.bottom - s.top)
      : 0;
  }
  /** The banner across the top of the map (portrait), else 0. */
  const bannerAbove = () => (cardsRight() ? 0 : bannerBottom());
  /**
   * How far the cards on the left reach into the map in landscape (#252),
   * px; 0 when the banner spans the map's width.
   */
  function cardsRight() {
    if (!landscape.matches) return 0;
    const b = banner.getBoundingClientRect(),
      s = stage.getBoundingClientRect();
    return Math.max(0, b.right - s.left);
  }
  const bannerObserver = new ResizeObserver(() =>
    screen.style.setProperty('--nav-top', `${bannerBottom()}px`),
  );
  bannerObserver.observe(banner);
  bannerObserver.observe(stage);
  // The browser's own long-press menu, loupe, callout and text selection
  // never open on the map; MapLibre handles pan, pinch, turn and zoom.
  stage.addEventListener('contextmenu', (event) => event.preventDefault());
  stage.addEventListener('selectstart', (event) => event.preventDefault());
  // Cancelling the touch stops iOS from starting its loupe or callout;
  // MapLibre still reads it.
  stage.addEventListener(
    'touchstart',
    (event) => {
      if (
        !(event.target as Element | null)?.closest?.(
          'button, a, input, label, select, .credits-dialog',
        )
      )
        event.preventDefault();
    },
    { passive: false },
  );

  // Replay (#154): the same screen fed with simulated positions.
  const replayToggle = $<HTMLButtonElement>('nav-replay-toggle'),
    replayRange = $<HTMLInputElement>('nav-replay-position'),
    replayRate = $<HTMLSelectElement>('nav-replay-rate');
  const REPLAY_STEPS = Number(replayRange.max);
  /** Shows the simulated position at an along-track distance. */
  function replayAt(distance: number) {
    if (!replayIndex) return;
    replayDistance = Math.max(0, Math.min(replayIndex.total, distance));
    const fix = replayFix(
      replayIndex,
      replayDistance,
      deps.speedKmh(),
      replayDeparture,
    );
    replayRange.value = String(
      Math.round((replayDistance / (replayIndex.total || 1)) * REPLAY_STEPS),
    );
    // The trip's clock and the distance travelled, for screen readers: the
    // screen shows them as the arrival and the slider (#252). Attribute
    // text is not observed by the DOM translator.
    const clock = new Date(now()).toLocaleTimeString(deps.locale(), {
      hour: '2-digit',
      minute: '2-digit',
    });
    replayRange.setAttribute(
      'aria-valuetext',
      `${clock} · ${t(
        `${distanceLabel(replayDistance, units(), deps.locale())} of ${distanceLabel(replayIndex.total, units(), deps.locale())}`,
      )}`,
    );
    if (!fix) return;
    replayBearing = fix.bearing;
    onFix({
      coords: {
        latitude: fix.coord[0],
        longitude: fix.coord[1],
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: fix.heading,
        // Paused, the traveler stands still.
        speed: replayFrame ? fix.speed : 0,
      },
      timestamp: fix.time,
    } as GeolocationPosition);
  }
  /**
   * The activity replay (#156) at a recorded time: the position the
   * recording had then, its speed and the time, fed to the same screen.
   */
  function activityAt(time: number) {
    if (!activity || !replayIndex) return;
    activityTime = Math.max(activity.start, Math.min(activity.end, time));
    replayDistance = distanceAt(activity, activityTime);
    replayRange.value = String(
      Math.round(
        (playedAt(activity, activityTime) / (playedLength(activity) || 1)) *
          REPLAY_STEPS,
      ),
    );
    replayRange.setAttribute(
      'aria-valuetext',
      `${activityClock(activityTime)} · ${t(
        `${distanceLabel(replayDistance, units(), deps.locale())} of ${distanceLabel(replayIndex.total, units(), deps.locale())}`,
      )}`,
    );
    const fix = replayFix(replayIndex, replayDistance, 1, 0);
    if (!fix) return;
    replayBearing = fix.bearing;
    onFix({
      coords: {
        latitude: fix.coord[0],
        longitude: fix.coord[1],
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: fix.heading,
        speed: valuesAt(activity, activityTime).speed ?? 0,
      },
      timestamp: activityTime,
    } as GeolocationPosition);
  }
  const activityClock = (time: number) =>
    new Date(time).toLocaleTimeString(deps.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  /** Elapsed replay time as h:mm:ss, or m:ss under an hour. */
  function elapsedLabel(ms: number): string {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600),
      m = Math.floor((total % 3600) / 60),
      sec = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }
  /** The recorded time, the place and the values at that moment. */
  /**
   * The activity's data page in the bottom card: time ridden, distance and
   * the recorded fields. The map stays clear; navigation's banner, chips and
   * speed badge are not used.
   */
  function renderActivity(a: Activity) {
    screen.classList.remove('off-route');
    $('nav-time').textContent = elapsedLabel(playedAt(a, activityTime));
    $('nav-rest').textContent = t(
      `${distanceLabel(replayDistance, units(), deps.locale())} of ${distanceLabel(a.distance, units(), deps.locale())}`,
    );
    values.render(a, activityTime);
    if (tracker)
      drawTravelled(Math.min(tracker.total, replayDistance + replayLead()));
  }
  /** The recorded values panel and its Values shown menu (#156). */
  const values = activityValues(deps.locale, () => {
    if (activity) render();
  });
  /** Timers of the notices on screen, cleared when the replay ends. */
  const noticeTimers = new Set<number>();
  /**
   * A short notice over the map for a few seconds: a stop the replay
   * skipped, or a highest value it has just passed. Notices close together
   * stack, each leaving on its own time; the oldest goes first when the
   * stack is full.
   */
  function activityNotice(
    name: IconName,
    message: string,
    value = '',
    kind?: Peak['kind'],
  ) {
    const stack = $('nav-activity-notices');
    const chip = document.createElement('p');
    // A peak takes its color, as its label on the planner map.
    chip.className = `nav-chip nav-activity-notice${kind ? ` activity-peak-${kind}` : ''}`;
    chip.append(
      icon(name),
      text('span', message),
      ...(value ? [text('b', value)] : []),
    );
    while (stack.children.length >= NOTICE_STACK)
      stack.firstElementChild!.remove();
    stack.append(chip);
    const timer = window.setTimeout(() => {
      noticeTimers.delete(timer);
      chip.remove();
    }, NOTICE_MS);
    noticeTimers.add(timer);
  }
  const showSkipped = (stop: Stop) =>
    activityNotice(
      'pause',
      `Stop of ${Math.max(1, Math.round((stop.to - stop.from) / 60_000))} min skipped`,
    );
  /**
   * Announces the highest values the replay passed between two times, in
   * the order it passed them (several at once at a high rate).
   */
  function passPeaks(a: Activity, from: number, to: number) {
    const passed = a.peaks
      .filter((p) => p.time > from && p.time <= to)
      .sort((x, y) => x.time - y.time);
    for (const peak of passed) announcePeak(peak);
  }
  function announcePeak(peak: Peak) {
    // As the peak's label on the planner map.
    const shown = peakLabel(peak, deps.locale());
    activityNotice(
      PEAK_ICONS[peak.kind],
      PEAK_TEXT[peak.kind],
      shown,
      peak.kind,
    );
  }
  /** Playback speeds: a route replay's, or real time × for an activity. */
  function setRates(rates: number[], chosen: number) {
    replayRate.replaceChildren(
      ...rates.map((rate) => {
        const option = document.createElement('option');
        option.value = String(rate);
        option.textContent = `${rate}×`;
        option.selected = rate === chosen;
        return option;
      }),
    );
  }
  function endActivity() {
    activity = null;
    activityBack = null;
    for (const timer of noticeTimers) clearTimeout(timer);
    noticeTimers.clear();
    $('nav-activity-notices').replaceChildren();
    values.end();
    setRates(ROUTE_RATES, 1);
  }
  function setReplayPlaying(playing: boolean) {
    cancelAnimationFrame(replayFrame);
    replayFrame = 0;
    const name = playing ? 'Pause' : 'Play';
    replayToggle.replaceChildren(icon(playing ? 'pause' : 'play'));
    replayToggle.setAttribute('aria-label', name);
    replayToggle.title = name;
    replayToggle.setAttribute('aria-pressed', String(playing));
    if (!playing || !replayIndex) return;
    if (activity) {
      if (activityTime >= activity.end) activityTime = activity.start;
    } else if (replayDistance >= replayIndex.total) replayDistance = 0;
    replayLast = performance.now();
    replayFrame = requestAnimationFrame(replayTick);
  }
  function replayTick(time: number) {
    if (!replayIndex || !replaying) return;
    if (activity) {
      const step = activityAdvance(
        activity,
        activityTime,
        time - replayLast,
        Number(replayRate.value),
      );
      replayLast = time;
      replayFrame = requestAnimationFrame(replayTick);
      const from = activityTime;
      activityAt(step.time);
      passPeaks(activity, from, step.time);
      if (step.skipped) showSkipped(step.skipped);
      if (step.time >= activity.end) setReplayPlaying(false);
      return;
    }
    const next = replayAdvance(
      replayDistance,
      time - replayLast,
      Number(replayRate.value),
      replayIndex.total,
    );
    replayLast = time;
    replayFrame = requestAnimationFrame(replayTick);
    replayAt(next);
    if (next >= replayIndex.total) setReplayPlaying(false);
  }
  replayToggle.onclick = () => setReplayPlaying(!replayFrame);
  replayRange.oninput = () => {
    if (!replayIndex) return;
    setReplayPlaying(false);
    const share = Number(replayRange.value) / REPLAY_STEPS;
    if (activity)
      activityAt(timeAtPlayed(activity, share * playedLength(activity)));
    else replayAt(share * replayIndex.total);
  };
  setReplayPlaying(false);
  /** Replays the route on this screen, paused at the start. */
  travel.onclick = () => {
    const planned = deps.route();
    if (!planned) return;
    replayIndex = indexTrack(planned.segments);
    if (!replayIndex.edges.length) {
      replayIndex = null;
      return;
    }
    const leaving = Date.parse(departureOf(deps.state()) ?? '');
    replayDeparture = Number.isFinite(leaving) ? leaving : Date.now();
    replayDistance = 0;
    start(false, true);
    setReplayPlaying(false);
  };

  return {
    /**
     * Replays a recorded activity at its own pace (#156): its track, times
     * and values, paused at the start; `back` gets the focus at the end.
     */
    replayActivity(recorded: Activity, back: HTMLElement) {
      const index = indexTrack(recorded.segments);
      if (!index.edges.length) return;
      replayIndex = index;
      activity = recorded;
      activityBack = back;
      activityTime = recorded.start;
      replayDistance = 0;
      setRates(ACTIVITY_RATES, 60);
      values.build(recorded);
      start(false, true, 0, {
        segments: recorded.segments,
        steps: [],
        distance: recorded.distance,
        duration: null,
        provider: 'Recorded activity',
      });
      setReplayPlaying(false);
    },
    /** Offers to continue the navigation a reload interrupted (#138). */
    offerResume(progress: number) {
      resumeAt = progress;
      resumeNotice.showModal();
    },
    /** Settings opened: show the stored notice choice. */
    syncSetting() {
      setting.checked = noticeWanted();
    },
  };
}
