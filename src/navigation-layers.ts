import type { ExpressionSpecification, Map as VectorMap } from 'maplibre-gl';
import type { Coord } from './core';

/**
 * What the navigation map draws over the base map: the route, the part
 * already travelled, the part still ahead (above it, so a road used both
 * ways never hides the way on), the accuracy ring of a weak fix and, off the
 * route, the dashed straight line back to it. All GeoJSON built from page
 * memory.
 */

const lonLat = ([lat, lon]: Coord) => [lon, lat];

/** Track segments as one feature; empty for none. */
export const lines = (segments: Coord[][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'MultiLineString' as const,
    coordinates: segments.map((part) => part.map(lonLat)),
  },
});

/**
 * Route pieces (`routePieces`) as features, each flagged where the route
 * uses the same road in the other direction too.
 */
export const passLines = (
  pieces: { repeated: boolean; coords: Coord[] }[],
) => ({
  type: 'FeatureCollection' as const,
  features: pieces.map(({ repeated, coords }) => ({
    type: 'Feature' as const,
    properties: { repeated },
    geometry: {
      type: 'LineString' as const,
      coordinates: coords.map(lonLat),
    },
  })),
});

/**
 * Close up, the two passes of a road used both ways draw side by side, each
 * `PASS_SHIFT` px right of its direction, as the planner draws them; from
 * `SIDE_BY_SIDE` down to `ONE_LINE` the shift shrinks to nothing and the
 * lines thin, so the whole route reads as one line, the way ahead above the
 * lighter way travelled.
 */
const PASS_SHIFT = 5;
const ONE_LINE = 13;
const SIDE_BY_SIDE = 15;
const passShift: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  ONE_LINE,
  0,
  SIDE_BY_SIDE,
  ['case', ['get', 'repeated'], PASS_SHIFT, 0],
];
const byZoom = (
  far: number,
  middle: number,
  near: number,
): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  far,
  ONE_LINE,
  middle,
  SIDE_BY_SIDE,
  near,
];
const ROUTE_COLOR = '#12796e';
const ROUTE_WIDTH = byZoom(4, 5, 8);

/** A circle of `radius` meters around `center`, for the accuracy ring. */
export function circleAround(center: Coord, radius: number) {
  const [lat, lon] = center,
    dLat = radius / 111320,
    dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  };
}

/** The dashed way back from the position to the rejoin point. */
export function rejoinLine(from: Coord, to: Coord) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [lonLat(from), lonLat(to)],
        },
      },
      {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: lonLat(to) },
      },
    ],
  };
}

/**
 * The sources (`route`, `travelled`, `ahead`, `accuracy`, `rejoin`) and their
 * layers.
 */
export function addNavigationLayers(m: VectorMap) {
  m.addSource('travelled', { type: 'geojson', data: lines([]) });
  m.addSource('route', { type: 'geojson', data: lines([]) });
  m.addSource('ahead', { type: 'geojson', data: lines([]) });
  m.addSource('accuracy', { type: 'geojson', data: lines([]) });
  m.addSource('rejoin', { type: 'geojson', data: lines([]) });
  const line = { 'line-cap': 'round', 'line-join': 'round' } as const;
  m.addLayer({
    id: 'nav-accuracy',
    type: 'fill',
    source: 'accuracy',
    paint: {
      'fill-color': '#0b72c6',
      'fill-opacity': 0.18,
      'fill-outline-color': '#0b72c6',
    },
  });
  m.addLayer({
    id: 'nav-route',
    type: 'line',
    source: 'route',
    layout: line,
    paint: {
      'line-color': ROUTE_COLOR,
      'line-width': ROUTE_WIDTH,
      'line-offset': passShift,
    },
  });
  m.addLayer({
    id: 'nav-travelled',
    type: 'line',
    source: 'travelled',
    layout: line,
    paint: {
      'line-color': [
        'interpolate',
        ['linear'],
        ['zoom'],
        ONE_LINE,
        '#a9b4bd',
        SIDE_BY_SIDE,
        '#8795a1',
      ],
      'line-width': byZoom(3, 4, 8),
      'line-offset': passShift,
    },
  });
  m.addLayer({
    id: 'nav-ahead',
    type: 'line',
    source: 'ahead',
    layout: line,
    paint: {
      'line-color': ROUTE_COLOR,
      'line-width': ROUTE_WIDTH,
      'line-offset': passShift,
    },
  });
  // Off the route: a dashed straight line to the rejoin point, and a ring
  // there. Dashes say it is not a road.
  m.addLayer({
    id: 'nav-rejoin',
    type: 'line',
    source: 'rejoin',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': '#74420b',
      'line-width': 4,
      'line-dasharray': [0.5, 2],
    },
  });
  m.addLayer({
    id: 'nav-rejoin-point',
    type: 'circle',
    source: 'rejoin',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 9,
      'circle-color': '#ffffff',
      'circle-stroke-color': '#74420b',
      'circle-stroke-width': 4,
    },
  });
}
