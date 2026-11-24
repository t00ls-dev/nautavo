import type { Coord, Route } from './core';
import {
  RANK,
  lineFeature,
  type MapMarker,
  type PlannerMap,
  type Pixel,
} from './planner-map';
import {
  indexTrack,
  legPositions,
  locateOnTrack,
  type TrackIndex,
} from './track-position';
import { t } from './i18n';
import { routeLineColor } from './map-layers';
import { gpsPoint as round } from './location';

/**
 * Dragging the route line to add a stop (#285): a handle on the line (under
 * the mouse, or where a finger tapped it) inserts a stop between the two
 * route points of that leg, where it is dropped or, on a click or tap, where
 * it is. Local only: nothing is requested until the new stop changes the
 * route, as any point edit does.
 */

/** How close to the line the pointer shows the handle, in CSS pixels. */
const HANDLE_REACH = { mouse: 10, touch: 22 } as const;
/** No handle this close to a route point (its marker is there), in pixels. */
const MARKER_CLEARANCE = 18;

/**
 * Index at which a stop at along-track distance `at` goes into `points`:
 * after the last point at or before it, never before the start nor after
 * the destination. Points the track does not pass are skipped.
 */
export function insertionIndex(
  positions: (number | null)[],
  at: number,
): number {
  let index = 1;
  positions.forEach((position, i) => {
    if (position !== null && position <= at) index = i + 1;
  });
  return Math.min(Math.max(index, 1), positions.length - 1);
}

interface Options {
  /** The route shown, or null while it cannot take a new stop. */
  route: () => Route | null;
  /** The route points, in order. */
  points: () => Coord[];
  /** A stop at `coord`, inserted at `index` (drop or click). */
  insert: (index: number, coord: Coord) => void;
  /**
   * A tap on the handle with the crosshair placement preference: the stop is
   * placed with the crosshair from `coord`. Returns false to insert at once.
   */
  place: (index: number, coord: Coord) => boolean;
  /** The loupe shown while the handle is dragged by touch. */
  loupe: { move: (coord: Coord) => void; hide: () => void };
}

export function setupRouteDrag(map: PlannerMap, options: Options) {
  const setGuide = map.overlay('rg-route-drag', RANK.highlight, () => [
    {
      id: 'rg-route-drag-casing',
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': 5, 'line-opacity': 0.9 },
    },
    {
      id: 'rg-route-drag-line',
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeLineColor(),
        'line-width': 2.5,
        'line-dasharray': [2, 1.5],
      },
    },
  ]);
  let indexed: { route: Route; index: TrackIndex } | null = null;
  const trackIndex = (route: Route) => {
    if (indexed?.route !== route)
      indexed = { route, index: indexTrack(route.segments) };
    return indexed.index;
  };
  /** Where the handle is: along-track distance and position on the line. */
  let at: { distance: number; coord: Coord } | null = null;
  let handle: MapMarker | null = null;
  let dragging = false;
  let touchDrag = false;

  const element = document.createElement('span');
  element.className = 'route-handle-dot';

  /** The nearest point of the line within `reach` pixels of `pixel`. */
  const near = (pixel: Pixel, reach: number) => {
    const route = options.route();
    const coord = map.unproject(pixel);
    if (!route || !coord) return null;
    const position = locateOnTrack(trackIndex(route), coord);
    const onLine = position && map.project(position.coord);
    if (!position || !onLine) return null;
    if (Math.hypot(onLine.x - pixel.x, onLine.y - pixel.y) > reach) return null;
    // A route point's marker stands there; the handle would hide under it.
    const clear = options.points().every((p) => {
      const marker = map.project(p);
      return (
        !marker ||
        Math.hypot(marker.x - onLine.x, marker.y - onLine.y) > MARKER_CLEARANCE
      );
    });
    return clear
      ? { distance: position.distance, coord: position.coord }
      : null;
  };
  const index = () => {
    const route = options.route();
    if (!route || !at) return null;
    return insertionIndex(
      legPositions(route.segments, options.points()),
      at.distance,
    );
  };
  const hide = () => {
    if (dragging) return;
    at = null;
    handle?.remove();
    handle = null;
    setGuide([]);
  };
  const show = (spot: { distance: number; coord: Coord }) => {
    at = spot;
    if (handle) {
      handle.setCoord(spot.coord);
      return;
    }
    handle = map.marker(spot.coord, {
      className: 'route-handle',
      html: element,
      size: [44, 44],
      anchor: [22, 22],
      draggable: true,
      interactive: true,
      z: 5,
    });
    const own = handle;
    // The route's own color on this base map.
    element.style.borderColor = routeLineColor();
    own.element.title = t('Drag to add a stop');
    own.element.setAttribute('aria-label', t('Add a stop here'));
    own.element.addEventListener('pointerdown', (event) => {
      touchDrag = event.pointerType !== 'mouse';
    });
    // A click ends a drag too; only a click without one adds the stop here.
    let dragged = false;
    own.element.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dragged) {
        dragged = false;
        return;
      }
      const i = index();
      const spot = at;
      if (i === null || !spot) return;
      hide();
      if (!(touchDrag && options.place(i, spot.coord)))
        options.insert(i, round(spot.coord));
    });
    own.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      own.element.click();
    });
    own.on('dragstart', () => {
      dragged = dragging = true;
      own.element.classList.add('dragging');
      if (touchDrag) options.loupe.move(own.getCoord());
    });
    own.on('drag', () => {
      const i = index();
      const points = options.points();
      if (i !== null)
        setGuide([lineFeature([points[i - 1], own.getCoord(), points[i]])]);
      if (touchDrag) options.loupe.move(own.getCoord());
    });
    own.on('dragend', () => {
      const i = index();
      const coord = own.getCoord();
      dragging = false;
      options.loupe.hide();
      hide();
      if (i !== null) options.insert(i, round(coord));
      // The click that may follow a mouse drag comes at once, if at all.
      setTimeout(() => (dragged = false), 0);
    });
  };

  // The mouse shows the handle where it nears the line.
  let frame = 0;
  map.container.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || event.buttons || dragging) return;
    cancelAnimationFrame(frame);
    const target = event.target as Element;
    if (target.closest('.route-handle')) return;
    const box = map.container.getBoundingClientRect();
    const pixel = { x: event.clientX - box.left, y: event.clientY - box.top };
    frame = requestAnimationFrame(() => {
      const spot =
        !target.closest('.maplibregl-marker,.map-control') &&
        near(pixel, HANDLE_REACH.mouse);
      if (spot) show(spot);
      else hide();
    });
  });
  map.container.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') hide();
  });
  // A finger cannot hover: a tap on the line shows the handle, any other tap
  // takes it away.
  map.on('click', (event: { point: Pixel; originalEvent: Event }) => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    if ((event.originalEvent.target as Element).closest('.maplibregl-marker'))
      return;
    const spot = near(event.point, HANDLE_REACH.touch);
    if (spot) show(spot);
    else hide();
  });
  return {
    /** The route or its points changed: the handle belongs to the old one. */
    reset: hide,
  };
}
