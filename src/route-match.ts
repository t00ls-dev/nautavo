import {
  type Coord,
  type Route,
  type Step,
  meters,
  serverUrl,
  validRoute,
} from './core';
import { indexTrack, pointAtDistance } from './track-position';
import { request } from './http';
import { routingQueue, type OsrmResponse, osrmStep } from './routing';
/** The public OSRM server accepts at most 10 trace points per match request. */
const MATCH_POINTS = 10,
  /** Smallest trace spacing, meters; larger ones grow by 2^(1/8) (about 9%). */
  MATCH_SPACING = 300,
  /** Requests aimed for one track; a long track spaces its points out. */
  MAX_MATCH_REQUESTS = 40,
  /** Page-memory cache of matched chunks: entries and freshness. */
  MATCH_CACHE = 400,
  MATCH_FRESH = 15 * 60_000;

/**
 * Trace chunks for map matching. Points are evenly spaced within each leg
 * between route points (`legs`, along-track distances) and each GPX segment,
 * restarting at every boundary, with a spacing from a fixed ladder
 * (300 m × 2^(k/8)) chosen for about 40 requests. Chunks of up to 10 points
 * share their end points and never cross a leg or segment boundary, so an
 * edit leaves the chunks of the other legs identical and they come from the
 * cache.
 */
export function matchPlan(segments: Coord[][], legs: number[] = []): Coord[][] {
  const index = indexTrack(segments);
  if (!index.edges.length) return [];
  const starts: number[] = [];
  let total = 0;
  for (const segment of segments) {
    let length = 0;
    for (let i = 1; i < segment.length; i++)
      length += meters(segment[i - 1], segment[i]);
    if (length > 0) starts.push(total);
    total += length;
  }
  const bounds = [
    ...new Set(
      [0, ...legs, ...starts, index.total]
        .filter((d) => d >= 0 && d <= index.total)
        .sort((a, b) => a - b),
    ),
  ];
  const traces = (spacing: number) =>
    bounds.slice(1).flatMap((end, i) => {
      const start = bounds[i];
      if (end - start < 1) return [];
      const trace: Coord[] = [];
      for (let at = start; at < end - 1; at += spacing)
        trace.push(pointAtDistance(index, at)!.coord);
      // Just before a segment start, so the end belongs to this segment.
      trace.push(pointAtDistance(index, end - 1e-6)!.coord);
      const chunks: Coord[][] = [];
      for (let k = 0; k < trace.length - 1; k += MATCH_POINTS - 1)
        chunks.push(trace.slice(k, k + MATCH_POINTS));
      return chunks.filter((c) => c.length >= 2);
    });
  let plan = traces(MATCH_SPACING);
  for (let k = 1; plan.length > MAX_MATCH_REQUESTS && k < 64; k++)
    plan = traces(MATCH_SPACING * 2 ** (k / 8));
  return plan;
}

const matchCache = new Map<string, { steps: Step[] | null; at: number }>();
const matchKey = (base: string, chunk: Coord[]) =>
  `${base}|${chunk.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(';')}`;

interface OsrmMatchResponse {
  code: string;
  matchings?: { legs: OsrmResponse['routes'][number]['legs'] }[];
}

/**
 * Turn directions along an imported track through OSRM map matching, without
 * changing its geometry. Chunks are serialized on the routing queue, with no
 * retries; a chunk the router cannot match (off-road, no road nearby) simply
 * has no steps. Router values are untrusted: steps are validated.
 */
export async function osrmMatch(
  base: string,
  segments: Coord[][],
  legs: number[] = [],
  isCurrent: () => boolean = () => true,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Step[]> {
  const chunks = matchPlan(segments, legs);
  const now = Date.now();
  const cached = (chunk: Coord[]) => {
    const hit = matchCache.get(matchKey(base, chunk));
    return hit && now - hit.at < MATCH_FRESH ? hit : undefined;
  };
  // Progress counts only the requests still needed.
  const needed = chunks.filter((c) => !cached(c)).length;
  let done = 0;
  const steps: Step[] = [];
  let matched = 0;
  for (const chunk of chunks) {
    let part = cached(chunk)?.steps;
    if (part === undefined) {
      const pts = chunk.map(([lat, lon]) => `${lon},${lat}`).join(';');
      // Only the chunk ends are waypoints, so inner trace points add no
      // depart/arrive pairs.
      const url = `${serverUrl(base)}/match/v1/driving/${pts}?steps=true&overview=false&waypoints=0;${chunk.length - 1}`;
      const data = await routingQueue.run(async () => {
        const r = await request(url, 30000, { sendOrigin: true });
        const body = (await r
          .json()
          .catch(() => null)) as OsrmMatchResponse | null;
        if (body?.code === 'NoMatch' || body?.code === 'NoSegment') return null;
        if (!r.ok || body?.code !== 'Ok')
          throw new Error('Directions unavailable for this track.');
        return body;
      }, isCurrent);
      part = data ? matchedSteps(data) : null;
      matchCache.set(matchKey(base, chunk), { steps: part, at: Date.now() });
      // Bounded: drop the oldest entries first.
      while (matchCache.size > MATCH_CACHE)
        matchCache.delete(matchCache.keys().next().value!);
      onProgress(++done, needed);
    }
    if (!part?.length) continue;
    matched++;
    // Joining edits the steps; the cached copy stays as received.
    join(steps, structuredClone(part));
  }
  if (!matched) throw new Error('Directions unavailable for this track.');
  return steps;
}

/**
 * The steps of an OSRM match answer, which is untrusted: a body of another
 * shape yields no steps for its chunk, never an error.
 */
function matchedSteps(data: OsrmMatchResponse): Route['steps'] | null {
  const list = <T>(value: T[] | undefined): T[] =>
    Array.isArray(value) ? value : [];
  try {
    return checkedSteps(
      list(data.matchings).flatMap((m) =>
        list(m?.legs).flatMap((l) => list(l?.steps).map(osrmStep)),
      ),
    );
  } catch {
    return null;
  }
}

/** Validates untrusted steps through `validRoute`; malformed ones fail all. */
function checkedSteps(steps: Step[]): Step[] {
  const route = {
    segments: [
      [
        [0, 0],
        [0, 0],
      ],
    ],
    steps,
    distance: 0,
    duration: null,
    provider: 'OSRM',
  };
  if (!validRoute(route)) throw new Error('OSRM returned an invalid route.');
  return steps;
}

/**
 * Appends a chunk's steps: the previous chunk's arrival is dropped, and the
 * next chunk's departure continues the previous road (merged when the name
 * is the same, otherwise a plain continue without a direction).
 */
function join(steps: Step[], part: Step[]) {
  const previous = steps.at(-1);
  if (previous?.kind === 'arrive') steps.pop();
  part.forEach((step, i) => {
    const last = steps.at(-1);
    const continues = step.kind === 'depart' && (steps.length > 0 || i > 0);
    if (continues && last && last.name === step.name && last.ref === step.ref) {
      last.distance += step.distance;
      last.duration += step.duration;
      return;
    }
    if (continues) {
      const { modifier: _modifier, ...rest } = step;
      void _modifier;
      steps.push({ ...rest, kind: 'continue' });
      return;
    }
    // An arrival inside a chunk (between matchings) is not the end.
    if (step.kind === 'arrive' && i < part.length - 1) return;
    steps.push(step);
  });
}
