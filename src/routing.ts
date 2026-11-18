import {
  type Coord,
  type Modifier,
  type Route,
  type State,
  type Step,
  isExit,
  isModifier,
  serverUrl,
  validCoord,
  validRoute,
} from './core';
import { pause, RequestQueue, json } from './http';
/** Routing servers allow about one request a second: starts at least 1.5 s apart. */
export const routingQueue = new RequestQueue(1500);
export interface OsrmResponse {
  code: string;
  message?: string;
  waypoints: { location: [number, number]; distance: number }[];
  routes: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs: {
      steps: {
        name?: string;
        ref?: string;
        distance: number;
        duration: number;
        maneuver?: {
          type?: string;
          modifier?: string;
          exit?: number;
          location?: [number, number];
        };
      }[];
    }[];
  }[];
}
/** Allowed difference from the start heading, degrees either way. */
const START_HEADING_RANGE = 60;
/**
 * The OSRM route URL. A start heading (navigation recalculation, degrees
 * from north) keeps the route from starting against the direction of travel.
 */
export function osrmUrl(state: State, startHeading?: number | null): string {
  const pts = state.points
    .map((p) => `${p.coord![1]},${p.coord![0]}`)
    .join(';');
  const bearings =
    typeof startHeading === 'number' && Number.isFinite(startHeading)
      ? `&bearings=${Math.round(((startHeading % 360) + 360) % 360)},${START_HEADING_RANGE}${';'.repeat(state.points.length - 1)}`
      : '';
  return `${serverUrl(state.osrm)}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true&continue_straight=true${bearings}`;
}
export async function osrmRoute(
  state: State,
  startHeading?: number | null,
  provider = 'OSRM',
): Promise<Route> {
  const d = (await json(osrmUrl(state, startHeading))) as OsrmResponse;
  if (d.code !== 'Ok' || !d.routes?.length)
    throw new Error(
      d.code === 'NoRoute'
        ? 'No driving route connects these points.'
        : `OSRM: ${d.code || 'invalid response'}`,
    );
  return checkedRoute('OSRM', () => {
    const r = d.routes[0];
    if (d.waypoints.length !== state.points.length) throw new Error();
    return {
      segments: [r.geometry.coordinates.map(([lon, lat]) => [lat, lon])],
      steps: r.legs.flatMap((l) => l.steps.map(osrmStep)),
      distance: r.distance,
      duration: r.duration,
      provider,
      snapped: d.waypoints.map((w) => [w.location[1], w.location[0]]),
    };
  });
}
/**
 * Optional maneuver fields from untrusted router data: values outside the
 * shared vocabulary are omitted rather than failing the route.
 */
function maneuverDetails(
  modifier: unknown,
  exit: unknown,
  at: Coord | undefined,
): Pick<Step, 'modifier' | 'exit' | 'at'> {
  return {
    ...(isModifier(modifier) ? { modifier } : {}),
    ...(isExit(exit) ? { exit } : {}),
    ...(at && validCoord(at) ? { at } : {}),
  };
}
/** Valhalla maneuver types in the shared vocabulary (OSRM kinds and modifiers). */
const VALHALLA_TYPES: Record<number, [kind: string, modifier?: Modifier]> = {
  1: ['depart'],
  2: ['depart', 'right'],
  3: ['depart', 'left'],
  4: ['arrive'],
  5: ['arrive', 'right'],
  6: ['arrive', 'left'],
  7: ['new name'],
  8: ['continue', 'straight'],
  9: ['turn', 'slight right'],
  10: ['turn', 'right'],
  11: ['turn', 'sharp right'],
  12: ['turn', 'uturn'],
  13: ['turn', 'uturn'],
  14: ['turn', 'sharp left'],
  15: ['turn', 'left'],
  16: ['turn', 'slight left'],
  17: ['on ramp', 'straight'],
  18: ['on ramp', 'right'],
  19: ['on ramp', 'left'],
  20: ['off ramp', 'right'],
  21: ['off ramp', 'left'],
  22: ['fork', 'straight'],
  23: ['fork', 'right'],
  24: ['fork', 'left'],
  25: ['merge'],
  26: ['roundabout'],
  27: ['exit roundabout'],
  37: ['merge', 'right'],
  38: ['merge', 'left'],
};
/** Builds a route from untrusted router JSON; malformed shapes and values become one clear error. */
function checkedRoute(
  server: 'OSRM' | 'Valhalla',
  build: () => unknown,
): Route {
  let route: unknown;
  try {
    route = build();
  } catch {
    route = undefined;
  }
  if (!validRoute(route))
    throw new Error(`${server} returned an invalid route.`);
  return route;
}
export function decodePolyline(str: string): Coord[] {
  let i = 0,
    lat = 0,
    lon = 0;
  const out: Coord[] = [];
  const next = () => {
    let result = 0,
      shift = 0,
      b: number;
    do {
      if (i >= str.length || shift > 30)
        throw new Error('Invalid route geometry.');
      b = str.charCodeAt(i++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}
export interface ValhallaResponse {
  error?: string;
  trip?: {
    status: number;
    summary: { length: number; time: number };
    legs: {
      shape: string;
      maneuvers: {
        street_names?: string[];
        length: number;
        time: number;
        type: number;
        begin_shape_index?: number;
        roundabout_exit_count?: number;
      }[];
    }[];
  };
}
export async function valhallaRoute(
  state: State,
  startHeading?: number | null,
  provider = 'Valhalla',
): Promise<Route> {
  const heading =
    typeof startHeading === 'number' && Number.isFinite(startHeading)
      ? Math.round(((startHeading % 360) + 360) % 360)
      : null;
  const body = {
    locations: state.points.map((p, i) => ({
      lat: p.coord![0],
      lon: p.coord![1],
      type: 'break',
      ...(i === 0 && heading !== null
        ? { heading, heading_tolerance: START_HEADING_RANGE }
        : {}),
    })),
    costing: 'auto',
    costing_options: { auto: { use_highways: state.prefer ? 1 : 0.5 } },
    units: 'kilometers',
    language: 'en-US',
  };
  const d = (await json(
    `${serverUrl(state.valhalla)}/route?json=${encodeURIComponent(JSON.stringify(body))}`,
  )) as ValhallaResponse;
  if (!d.trip || d.trip.status !== 0)
    throw new Error(d.error || 'Valhalla could not find a route.');
  const route = tripRoute(d.trip, provider);
  // Each leg starts and ends where Valhalla placed the route points on the
  // road, as OSRM's waypoints say.
  route.snapped = [
    route.segments[0][0],
    ...route.segments.map((segment) => segment.at(-1)!),
  ];
  return route;
}
/**
 * A route from a Valhalla trip (`/route` or `/trace_route`): legs, maneuvers
 * in the shared vocabulary and totals, checked like every router answer.
 */
export function tripRoute(
  t: NonNullable<ValhallaResponse['trip']>,
  provider: string,
): Route {
  return checkedRoute('Valhalla', () => {
    const segments = t.legs.map((l) => decodePolyline(l.shape));
    const steps: Step[] = t.legs.flatMap((l, leg) =>
      l.maneuvers.map((m) => {
        const [kind, modifier] = VALHALLA_TYPES[m.type] ?? [];
        return {
          name: m.street_names?.join(' / ') || 'Unnamed road',
          ref: (m.street_names ?? [])
            .filter((n) => /\b[A-Z]{1,3}[ -]?\d{1,4}\b/.test(n))
            .join(';'),
          distance: m.length * 1000,
          duration: m.time,
          ...(kind ? { kind } : {}),
          ...maneuverDetails(
            modifier,
            m.type === 26 ? m.roundabout_exit_count : undefined,
            Number.isInteger(m.begin_shape_index)
              ? segments[leg][m.begin_shape_index!]
              : undefined,
          ),
        };
      }),
    );
    return {
      segments,
      steps,
      distance: t.summary.length * 1000,
      duration: t.summary.time,
      provider,
    };
  });
}
/** The router asked first; the other one is the fallback. */
export type Router = 'osrm' | 'valhalla';
const ROUTERS = {
  osrm: [osrmRoute, 'OSRM'],
  valhalla: [valhallaRoute, 'Valhalla'],
} as const;
/**
 * One route on the routing queue: the primary router, then the other one
 * once after a pause, with no retries. Prefer main roads asks Valhalla first,
 * since only its costing can favor highways (`use_highways`); otherwise OSRM
 * is the primary.
 */
export async function calculate(
  state: State,
  isCurrent: () => boolean = () => true,
  startHeading?: number | null,
  primary: Router = state.prefer ? 'valhalla' : 'osrm',
): Promise<Route> {
  const [first, firstName] = ROUTERS[primary],
    [second, secondName] = ROUTERS[primary === 'osrm' ? 'valhalla' : 'osrm'];
  return routingQueue.run(async () => {
    if (!isCurrent()) throw new Error('Superseded route');
    try {
      return await first(state, startHeading, firstName);
    } catch (e) {
      if (!isCurrent()) throw e;
      await pause(1500);
      if (!isCurrent()) throw e;
      try {
        return await second(state, startHeading, `${secondName} (fallback)`);
      } catch {
        // Plain words for the traveler (#210), with no router name or HTTP
        // code; why the primary router failed stays on the error's cause.
        throw new Error(
          'Could not calculate the route right now. Check the points or try again.',
          { cause: e },
        );
      }
    }
  });
}

/** One OSRM step in the shared vocabulary (as in `osrmRoute`). */
export function osrmStep(
  s: OsrmResponse['routes'][number]['legs'][number]['steps'][number],
): Step {
  return {
    name: s.name || 'Unnamed road',
    ref: s.ref || '',
    distance: s.distance,
    duration: s.duration,
    ...(s.maneuver?.type === undefined ? {} : { kind: s.maneuver.type }),
    ...maneuverDetails(
      s.maneuver?.modifier,
      s.maneuver?.exit,
      s.maneuver?.location &&
        ([s.maneuver.location[1], s.maneuver.location[0]] as Coord),
    ),
  };
}

/**
 * A navigation recalculation (#31): one route from the traveler's position
 * (from `gpsPoint`) to a point on the planned route,
 * with the route's servers and options, on the routing queue with the
 * OSRM → Valhalla fallback and no retries, whatever Prefer main roads says:
 * the way back is short and needed fast. The caller limits how often.
 */
export function navigationRoute(
  state: State,
  from: Coord,
  to: Coord,
  heading: number | null,
  isCurrent: () => boolean,
): Promise<Route> {
  return calculate(
    {
      ...state,
      points: [
        { name: 'Position', coord: from },
        { name: 'Route', coord: to },
      ],
    },
    isCurrent,
    heading,
    'osrm',
  );
}
