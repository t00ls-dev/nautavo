import { type Route, serverUrl } from './core';
import {
  EDGE_ATTRIBUTES,
  encodePolyline,
  parseTraceAttributes,
  validPiece,
  type AttributePiece,
  type TraceAttributes,
} from './road-attributes';
import { request } from './http';
import { routingQueue, type ValhallaResponse, tripRoute } from './routing';
/**
 * Valhalla requests over the pieces of `attributePlan` (at most 190 km and
 * about 4,000 points): one POST per piece, serialized on the routing queue,
 * without retries. A piece the server cannot match (HTTP 400) is null; a
 * failed piece is 'failed' and does not stop the others; a usage limit
 * (HTTP 429) stops the rest. Answers stay in a bounded page-memory cache per
 * endpoint; failures are not cached, so asking again can work.
 */
const PIECE_CACHE = 100,
  PIECE_FRESH = 15 * 60_000;
/** What a road data usage limit (HTTP 429) says, wherever it shows. */
export const ROAD_DATA_LIMIT =
  'Road data usage limit reached. Try again later.';
export class ValhallaLimitError extends Error {
  constructor() {
    super(ROAD_DATA_LIMIT);
    this.name = 'ValhallaLimitError';
  }
}
async function valhallaPieces<T>(
  base: string,
  endpoint: string,
  pieces: AttributePiece[],
  cache: Map<string, { value: T | null; at: number }>,
  options: object,
  parse: (data: unknown, piece: AttributePiece) => T | null,
  isCurrent: () => boolean,
): Promise<(T | null | 'failed')[]> {
  const out: (T | null | 'failed')[] = [];
  for (const piece of pieces) {
    const shape = encodePolyline(piece.coords);
    const key = `${serverUrl(base)}|${JSON.stringify(options)}|${shape}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < PIECE_FRESH) {
      out.push(hit.value);
      continue;
    }
    if (!validPiece(piece)) {
      out.push(null);
      continue;
    }
    const body = JSON.stringify({
      encoded_polyline: shape,
      costing: 'auto',
      shape_match: 'map_snap',
      ...options,
    });
    const value = await routingQueue.run(async () => {
      let r: Response;
      try {
        r = await request(`${serverUrl(base)}/${endpoint}`, 30000, {
          sendOrigin: true,
          body,
        });
      } catch {
        return undefined;
      }
      if (r.status === 429) throw new ValhallaLimitError();
      // A trace the server cannot match is a valid answer: nothing there.
      if (!r.ok) return r.status === 400 ? null : undefined;
      try {
        return parse(await r.json(), piece);
      } catch {
        return undefined;
      }
    }, isCurrent);
    if (value !== undefined) {
      cache.set(key, { value, at: Date.now() });
      while (cache.size > PIECE_CACHE) cache.delete(cache.keys().next().value!);
    }
    out.push(value === undefined ? 'failed' : value);
  }
  return out;
}

/**
 * Road attributes along the route (Valhalla `/trace_attributes`), asked only
 * on an explicit choice.
 */
const attributeCache = new Map<
  string,
  { value: TraceAttributes | null; at: number }
>();
export function valhallaAttributes(
  base: string,
  pieces: AttributePiece[],
  isCurrent: () => boolean = () => true,
): Promise<(TraceAttributes | null | 'failed')[]> {
  return valhallaPieces(
    base,
    'trace_attributes',
    pieces,
    attributeCache,
    { filters: { attributes: EDGE_ATTRIBUTES, action: 'include' } },
    (data, piece) => parseTraceAttributes(data, piece.coords.length),
    isCurrent,
  );
}

/**
 * Map matching of an imported track (Valhalla `/trace_route`): the road the
 * track follows, with its maneuvers, checked like a route. Cached, so
 * Calculate route right after an import asks nothing.
 */
const traceCache = new Map<string, { value: Route | null; at: number }>();
export function valhallaTrace(
  base: string,
  pieces: AttributePiece[],
  isCurrent: () => boolean = () => true,
  /** `bicycle` for roads closed to cars, after `auto` left a piece short. */
  costing: 'auto' | 'bicycle' = 'auto',
): Promise<(Route | null | 'failed')[]> {
  return valhallaPieces(
    base,
    'trace_route',
    pieces,
    traceCache,
    { costing, units: 'kilometers', language: 'en-US' },
    (data) => {
      const d = data as ValhallaResponse;
      return d.trip && d.trip.status === 0
        ? tripRoute(d.trip, 'Valhalla map matching')
        : null;
    },
    isCurrent,
  );
}
