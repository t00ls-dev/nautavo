import { meters, type Coord } from './core';
import {
  exactSlice,
  indexTrack,
  METERS_PER_DEGREE,
  pointAtDistance,
  toSegment,
  type TrackIndex,
} from './track-position';

/**
 * Compares a recorded track with the road a map matcher found for it
 * (Valhalla `/trace_route`) and rebuilds the geometry from both, locally.
 *
 * The recorded track is walked in order, sampled every few meters, and each
 * sample is located on the matched road near a cursor that moves with it, so
 * out-and-back and looping tracks stay on the right pass and long tracks stay
 * fast. Runs of samples on the road are "same"; a run off it is a GPS
 * "glitch" when the road explains it (a spike that leaves and comes back, a
 * zigzag while stopped, a straight jump across a signal gap) and "off"
 * otherwise (an unmapped path, off-road, a stretch the matcher lost), which
 * the app keeps as recorded and flags. Stretches whose matching failed are
 * "unknown": kept as recorded, not flagged.
 */

type RunKind = 'same' | 'glitch' | 'off' | 'unknown' | 'aligned';
export interface MatchRun {
  kind: RunKind;
  /** Along the recorded track, meters (segment gaps excluded). */
  from: number;
  to: number;
  /**
   * Along the matched road, for glitches and aligned pieces: the road that
   * replaces them.
   */
  mFrom?: number;
  mTo?: number;
}
/** Matching outcome of each requested piece, by recorded along-track range. */
export interface PieceStatus {
  from: number;
  to: number;
  status: 'matched' | 'unmatched' | 'failed';
}

/** Thresholds, in meters; documented so tests and the help can name them. */
export const MATCH_THRESHOLDS = {
  /** Samples this close to the matched road are on it. */
  onRoad: 30,
  /** Passes of the road this much farther than the nearest still count. */
  passSlack: 15,
  /** How far behind the cursor the current pass may still be. */
  backtrack: 100,
  /**
   * A glitch goes away from the road and back: shorter than this, it is a
   * wobble of the comparison, not a GPS glitch.
   */
  glitchLength: 40,
  /** A stretch passing this close to a route point is never a glitch. */
  nearStop: 50,
  /** Sampling step along the recorded track. */
  step: 20,
  /** Off-road wobbles this small and short are noise, not a stretch. */
  noiseOff: 80,
  noiseLength: 150,
  /** GPS drift: beside the road, its length within this share of the road's. */
  driftShare: 0.2,
  /** Stretches off the road shorter than this are not worth a warning. */
  flagLength: 100,
  /** A spike: at most this many recorded points, returning near where it left. */
  spikePoints: 4,
  spikeRoad: 150,
  /** A zigzag while stopped: stays this close and covers little road. */
  zigzagOff: 80,
  zigzagRoad: 150,
  /**
   * ...and doubles back at least this many times on edges this long: a ride
   * up a side entrance and back turns around once, GPS jitter many times.
   */
  zigzagTurns: 2,
  zigzagEdge: 15,
  /** A signal gap: a straight recorded jump at least this long, near the road. */
  gapEdge: 100,
  gapOff: 150,
  /** ...and the road across it at most this many times as long, plus 100 m. */
  gapRoad: 2,
} as const;

interface Sample {
  d: number;
  coord: Coord;
  vertex: boolean;
  /** Distance to the matched road and along-road position, or null if unknown. */
  off: number | null;
  m: number;
}

/**
 * Nearest matched-road position to `p` among edges overlapping [lo, hi].
 * Where the road passes the same place twice (an out-and-back on one road),
 * both passes are about as close: the first one at or ahead of `ahead`, less
 * a short backtrack, wins,
 * so the cursor keeps moving forward with the track, as `locateOnTrack` does
 * with its progress.
 */
function nearest(
  index: TrackIndex,
  p: Coord,
  lo: number,
  hi: number,
  ahead: number,
) {
  const { edges } = index;
  let low = 0,
    high = edges.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (edges[mid].from + edges[mid].length < lo) low = mid + 1;
    else high = mid;
  }
  const found: { off: number; m: number }[] = [];
  for (let i = low; i < edges.length && edges[i].from <= hi; i++) {
    const e = edges[i];
    const { t, offTrack: off } = toSegment(p, e.a, e.b);
    found.push({ off, m: e.from + t * e.length });
  }
  if (!found.length) return null;
  const best = Math.min(...found.map((f) => f.off));
  const close = found.filter((f) => f.off <= best + MATCH_THRESHOLDS.passSlack);
  // A pass a little behind still counts (GPS noise, a spike coming back
  // from the side), as `locateOnTrack`'s backtrack does. The distance is
  // always the nearest one; only the position comes from the chosen pass.
  const pass =
    close.find((f) => f.m >= ahead - MATCH_THRESHOLDS.backtrack) ??
    close.reduce((a, b) => (b.off < a.off ? b : a));
  return { off: best, m: pass.m };
}

/** Recorded samples: every vertex plus points every `step` meters between. */
function samples(
  index: TrackIndex,
): { d: number; coord: Coord; seg: number; vertex: boolean }[] {
  const out: { d: number; coord: Coord; seg: number; vertex: boolean }[] = [];
  let seg = -1;
  for (const e of index.edges) {
    if (e.segment !== seg) {
      out.push({ d: e.from, coord: e.a, seg: e.segment, vertex: true });
      seg = e.segment;
    }
    const n = Math.floor(e.length / MATCH_THRESHOLDS.step);
    for (let k = 1; k <= n; k++) {
      const f = (k * MATCH_THRESHOLDS.step) / e.length;
      if (f >= 1) break;
      out.push({
        d: e.from + f * e.length,
        coord: [e.a[0] + (e.b[0] - e.a[0]) * f, e.a[1] + (e.b[1] - e.a[1]) * f],
        seg: e.segment,
        vertex: false,
      });
    }
    out.push({
      d: e.from + e.length,
      coord: e.b,
      seg: e.segment,
      vertex: true,
    });
  }
  return out;
}

/**
 * Runs covering the whole recorded track, in order, never crossing a GPX
 * segment gap. `pieces` gives the outcome of each matched piece; without it
 * the whole track counts as matched.
 */
export function compareTrack(
  recorded: Coord[][],
  matched: Coord[][],
  pieces?: PieceStatus[],
  /** Route points: a stretch passing near one is the traveler's own way. */
  stops: Coord[] = [],
): MatchRun[] {
  const T = MATCH_THRESHOLDS;
  const rIndex = indexTrack(recorded),
    mIndex = indexTrack(matched);
  const status = (d: number) =>
    pieces?.find((p) => d >= p.from - 0.5 && d <= p.to + 0.5)?.status ??
    'matched';
  const all = samples(rIndex);
  // Locate every sample near a cursor along the matched road.
  let cursor = 0,
    lastOn = 0;
  // Distance to any pass of the matched road, whatever the order: a sample
  // near it is on the road even where the matcher folded the order away.
  const toMatched = mIndex.edges.length ? distanceTo(matched) : null;
  const located: (Sample & {
    seg: number;
    status: string;
    near: boolean;
  })[] = all.map((s) => {
    const st = status(s.d);
    if (st !== 'matched' || !toMatched)
      return { ...s, off: null, m: cursor, status: st, near: false };
    const reach = 500 + 2 * (s.d - lastOn);
    const hit = nearest(mIndex, s.coord, cursor - 200, cursor + reach, cursor);
    const near = (off: number) =>
      off <= T.onRoad || toMatched(s.coord) <= T.onRoad;
    if (!hit)
      return {
        ...s,
        off: Infinity,
        m: cursor,
        status: st,
        near: near(Infinity),
      };
    if (hit.off <= T.onRoad) {
      // The cursor only moves forward, like navigation's progress: a pass a
      // little behind can match a point but never pulls the cursor back.
      cursor = Math.max(cursor, hit.m);
      lastOn = s.d;
    }
    return { ...s, off: hit.off, m: hit.m, status: st, near: near(hit.off) };
  });
  // Where the route points sit along the recorded track.
  const stopsAt = stops.flatMap((c) => {
    const near = nearest(rIndex, c, 0, rIndex.total, 0);
    return near && near.off <= T.nearStop ? [near.m] : [];
  });
  // Recorded edge lengths, for signal gaps.
  const longestEdge = (from: number, to: number) => {
    let max = 0;
    for (const e of rIndex.edges)
      if (e.from < to && e.from + e.length > from)
        max = Math.max(max, e.length);
    return max;
  };
  const vertices = (from: number, to: number) =>
    rIndex.edges.filter((e) => e.from > from && e.from < to).length;
  /** Times the recording doubles back (over 120°) between long edges. */
  const turnsBack = (from: number, to: number) => {
    let turns = 0,
      last: [number, number] | null = null;
    for (const e of rIndex.edges) {
      if (e.from + e.length <= from || e.from >= to) continue;
      if (e.length < T.zigzagEdge) continue;
      const k = Math.cos((e.a[0] * Math.PI) / 180);
      const dx = (e.b[1] - e.a[1]) * k,
        dy = e.b[0] - e.a[0],
        d = Math.hypot(dx, dy);
      const dir: [number, number] = [dx / d, dy / d];
      if (last && last[0] * dir[0] + last[1] * dir[1] < -0.5) turns++;
      last = dir;
    }
    return turns;
  };

  const runs: MatchRun[] = [];
  const push = (run: MatchRun) => {
    const last = runs.at(-1);
    if (
      last &&
      last.kind === run.kind &&
      last.to === run.from &&
      run.kind === 'same'
    )
      last.to = run.to;
    else runs.push(run);
  };
  let i = 0;
  while (i < located.length) {
    const seg = located[i].seg;
    let j = i;
    while (j < located.length && located[j].seg === seg) j++;
    const part = located.slice(i, j);
    i = j;
    // Classify sample states, then group.
    // "On" also counts a sample near the road elsewhere than the cursor
    // expects, as where the matcher folded part of the track away.
    const state = part.map((s) =>
      s.off === null ? 'unknown' : s.off <= T.onRoad || s.near ? 'on' : 'off',
    );
    // A stretch off the road starts and ends at recorded points: samples
    // between a recorded point and the stretch belong to it, so the part of
    // a spike or jump still near the road is not kept as road.
    for (let n = 0; n < part.length; n++) {
      if (state[n] !== 'off' || (n > 0 && state[n - 1] === 'off')) continue;
      for (let b = n - 1; b > 0 && state[b] === 'on' && !part[b].vertex; b--)
        state[b] = 'off';
      let e = n;
      while (e + 1 < part.length && state[e + 1] === 'off') e++;
      for (
        let f = e + 1;
        f < part.length - 1 && state[f] === 'on' && !part[f].vertex;
        f++
      )
        state[f] = 'off';
      n = e;
    }
    let k = 0;
    while (k < part.length) {
      const kind = state[k];
      let e = k;
      while (e + 1 < part.length && state[e + 1] === kind) e++;
      if (kind === 'on') {
        push({ kind: 'same', from: part[k].d, to: part[e].d });
      } else if (kind === 'unknown') {
        runs.push({
          kind: 'unknown',
          from: k ? part[k - 1].d : part[k].d,
          to: e + 1 < part.length ? part[e + 1].d : part[e].d,
        });
      } else {
        // A glitch is anchored on samples on the road where the cursor is.
        const anchor = (n: number) =>
          n >= 0 &&
          n < part.length &&
          state[n] === 'on' &&
          part[n].off! <= T.onRoad
            ? part[n]
            : null;
        const before = anchor(k - 1),
          after = anchor(e + 1);
        // The stretch reaches the samples on the road around it, anchors or
        // not, so no recorded point between them is left out.
        const from = k > 0 ? part[k - 1].d : part[k].d,
          to = e + 1 < part.length ? part[e + 1].d : part[e].d;
        const maxOff = Math.max(...part.slice(k, e + 1).map((s) => s.off ?? 0));
        const unmatched = part
          .slice(k, e + 1)
          .some((s) => s.status === 'unmatched');
        let run: MatchRun = { kind: 'off', from, to };
        if (before && after && !unmatched) {
          const road = after.m - before.m,
            length = to - from;
          // Route points, and the start and end of the recording (where the
          // traveler really was, often reached in a straight line while the
          // GPS was still finding itself), are never corrected away.
          const visited =
            stopsAt.some((d) => d > from && d < to) ||
            from <= T.onRoad ||
            to >= rIndex.total - T.onRoad;
          const spike =
            vertices(from, to) <= T.spikePoints &&
            road > -T.onRoad &&
            road < T.spikeRoad;
          const zigzag =
            maxOff <= T.zigzagOff &&
            road > -T.onRoad &&
            road < T.zigzagRoad &&
            length >= 2 * road + 40 &&
            turnsBack(from, to) >= T.zigzagTurns;
          const gap =
            longestEdge(from, to) >= T.gapEdge &&
            maxOff <= T.gapOff &&
            road > 0 &&
            road <= T.gapRoad * length + 100;
          const glitch =
            !visited && length >= T.glitchLength && (spike || zigzag || gap);
          // Not a glitch, and small (a cut corner, a wobble) or running beside
          // the road for about its length (GPS drift): still the road.
          const drift =
            road > 0 && Math.abs(length - road) <= T.driftShare * length;
          if (
            !glitch &&
            maxOff < T.noiseOff &&
            (length < T.noiseLength || drift)
          ) {
            push({ kind: 'same', from, to });
            k = e + 1;
            continue;
          }
          run = {
            kind: glitch ? 'glitch' : 'off',
            from,
            to,
            mFrom: before.m,
            mTo: after.m,
          };
        }
        runs.push(run);
      }
      k = e + 1;
    }
  }
  // Same runs that ended where an off run starts share its anchor sample.
  return runs.filter((r) => r.to > r.from || r.kind !== 'same');
}

/** Recorded elevation at an along distance, interpolated, or null. */
function elevationAt(
  recorded: Coord[][],
  elevations: (number | null)[][],
): (d: number) => number | null {
  // Vertex along distances per segment, parallel to `elevations`.
  const along: number[][] = recorded.map(() => []);
  let total = 0;
  recorded.forEach((s, n) => {
    along[n].push(total);
    for (let i = 1; i < s.length; i++) {
      total += meters(s[i - 1], s[i]);
      along[n].push(total);
    }
  });
  return (d) => {
    for (let n = 0; n < along.length; n++) {
      const a = along[n];
      if (d < a[0] - 0.5 || d > a.at(-1)! + 0.5) continue;
      let i = 1;
      while (i < a.length - 1 && a[i] < d) i++;
      const e0 = elevations[n]?.[i - 1] ?? null,
        e1 = elevations[n]?.[i] ?? null;
      if (e0 === null || e1 === null) return e0 ?? e1;
      const span = a[i] - a[i - 1];
      const f = span ? Math.max(0, Math.min(1, (d - a[i - 1]) / span)) : 0;
      return e0 + (e1 - e0) * f;
    }
    return null;
  };
}

export interface Rebuilt {
  segments: Coord[][];
  elevations?: (number | null)[][];
}
/**
 * Geometry from the runs: the recorded track, with the matched road only in
 * place of glitches. The road never stands in for the rest: drawn a few
 * meters beside the recording, and with the detours one-way streets force on
 * a car, it would add length the traveler never rode. Recorded elevation
 * follows the recorded points and is interpolated across replaced stretches.
 */
export function rebuildTrack(
  recorded: Coord[][],
  matched: Coord[][],
  runs: MatchRun[],
  elevations?: (number | null)[][],
): Rebuilt {
  const rIndex = indexTrack(recorded),
    mIndex = indexTrack(matched);
  const height = elevations && elevationAt(recorded, elevations);
  const segments: Coord[][] = [];
  const heights: (number | null)[][] = [];
  let open = false;
  let lastSeg = -1;
  const segmentOf = (d: number) =>
    rIndex.edges.find((e) => d >= e.from && d <= e.from + e.length)?.segment ??
    -1;
  const add = (points: Coord[], hs: (number | null)[], newSegment: boolean) => {
    if (!points.length) return;
    if (newSegment || !open) {
      segments.push([]);
      heights.push([]);
      open = true;
    }
    const s = segments.at(-1)!,
      h = heights.at(-1)!;
    points.forEach((c, n) => {
      const last = s.at(-1);
      if (last && last[0] === c[0] && last[1] === c[1]) return;
      s.push(c);
      h.push(hs[n]);
    });
  };
  for (const run of runs) {
    const seg = segmentOf((run.from + run.to) / 2);
    const fresh = seg !== lastSeg;
    lastSeg = seg;
    // A glitch that stays at one place of the road (a zigzag while stopped)
    // is dropped: its two ends join directly.
    if (
      run.kind === 'glitch' &&
      run.mFrom !== undefined &&
      run.mTo !== undefined &&
      run.mTo <= run.mFrom
    )
      continue;
    const useRoad =
      (run.kind === 'glitch' || run.kind === 'aligned') &&
      run.mFrom !== undefined &&
      run.mTo !== undefined &&
      run.mTo > run.mFrom;
    if (useRoad) {
      // Recorded elevation follows the road in proportion along the run.
      const pts = exactSlice(mIndex, run.mFrom!, run.mTo!).flat();
      const scale = (run.to - run.from) / (run.mTo! - run.mFrom!);
      add(
        pts.map((p) => p.coord),
        pts.map((p) => height?.(run.from + (p.d - run.mFrom!) * scale) ?? null),
        fresh,
      );
    } else {
      const pts = exactSlice(rIndex, run.from, run.to).flat();
      add(
        pts.map((p) => p.coord),
        pts.map((p) => height?.(p.d) ?? null),
        fresh,
      );
    }
  }
  const keep = segments.map((s) => s.length >= 2);
  return {
    segments: segments.filter((_, n) => keep[n]),
    ...(elevations ? { elevations: heights.filter((_, n) => keep[n]) } : {}),
  };
}

/** Limits of `safeResult`, in meters (and a share of the track's length). */
const SAFETY = {
  /** A route point near the recorded track stays this near the result. */
  stop: 60,
  /** The recorded track is checked every `step`, within `cover` of the result. */
  step: 100,
  cover: 60,
  /**
   * The result may be this much longer than the recording, plus 200 m: only
   * a corrected glitch, the road across a signal gap, adds length.
   */
  longer: 0.02,
} as const;

/**
 * Distance from any point to a track, with the track's edges kept in a grid
 * of cells about `cell` meters wide, so each query looks at a few edges only.
 */
/**
 * Share of the points within `SAFETY.cover` of the matched road. Points
 * stand for time on a recording, so a GPS glitch (a few points over a long
 * distance) weighs little, while a matcher that stopped early leaves out
 * most of them.
 */
export function coveredShare(points: Coord[], matched: Coord[][]) {
  if (!points.length || !matched.length) return 0;
  const toMatched = distanceTo(matched);
  return (
    points.filter((p) => toMatched(p) <= SAFETY.cover).length / points.length
  );
}

function distanceTo(segments: Coord[][], cell = 100) {
  const k = (lat: number) =>
    Math.cos((lat * Math.PI) / 180) * METERS_PER_DEGREE;
  const lat0 = segments[0]?.[0]?.[0] ?? 0;
  const xOf = (c: Coord) => c[1] * k(lat0),
    yOf = (c: Coord) => c[0] * METERS_PER_DEGREE;
  const grid = new Map<string, [Coord, Coord][]>();
  const key = (x: number, y: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const s of segments)
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1],
        b = s[i];
      const n = Math.max(1, Math.ceil(meters(a, b) / (cell / 2)));
      const cells = new Set<string>();
      for (let j = 0; j <= n; j++) {
        const f = j / n;
        const c: Coord = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        cells.add(key(xOf(c), yOf(c)));
      }
      for (const c of cells) {
        const list = grid.get(c);
        if (list) list.push([a, b]);
        else grid.set(c, [[a, b]]);
      }
    }
  return (p: Coord): number => {
    const cx = Math.floor(xOf(p) / cell),
      cy = Math.floor(yOf(p) / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [a, b] of grid.get(`${cx + dx},${cy + dy}`) ?? [])
          best = Math.min(best, toSegment(p, a, b).offTrack);
    return best;
  };
}

/** When a matched piece can stand for its whole recording (`alignedPiece`). */
export const ALIGNED = {
  /** It agrees in length with what was ridden within this share... */
  length: 0.03,
  /** ...is continuous: its parts join within this many meters... */
  join: 30,
  /** ...and may leave out off-road ends of the route up to this long. */
  ends: 300,
} as const;

/**
 * Whether the matched road of one piece can stand for its whole recording:
 * it is continuous (a matcher that lost the track starts a new part
 * elsewhere), about as long as what was ridden (no detour, nothing folded
 * away),
 * passes near every route point and covers the recording every 100 m. Its
 * GPS glitches and, at the route's own start and end, the stretch off the
 * road (reached in a straight line while the GPS found itself) are exempt.
 * Returns those end stretches, in meters, or null when the piece keeps its
 * recording.
 */
export function alignedPiece(
  recorded: Coord[][],
  matched: Coord[][],
  stops: Coord[],
  glitches: MatchRun[],
  ends: { start: boolean; end: boolean },
): { head: number; tail: number } | null {
  const rIndex = indexTrack(recorded),
    length = indexTrack(matched).total;
  if (!length) return null;
  for (let n = 1; n < matched.length; n++)
    if (meters(matched[n - 1].at(-1)!, matched[n][0]) > ALIGNED.join)
      return null;
  const toMatched = distanceTo(matched);
  const offFor = (at: (d: number) => number) => {
    for (let d = 0; d < ALIGNED.ends; d += 10) {
      const p = pointAtDistance(rIndex, at(d))?.coord;
      if (p && toMatched(p) <= SAFETY.cover) return d;
    }
    return ALIGNED.ends;
  };
  const head = ends.start ? offFor((d) => d) : 0,
    tail = ends.end ? offFor((d) => rIndex.total - d) : 0;
  const exempt = [
    ...glitches,
    { from: 0, to: head },
    { from: rIndex.total - tail, to: rIndex.total },
  ];
  const ridden =
    rIndex.total -
    head -
    tail +
    glitches.reduce(
      (n, g) =>
        n - (g.to - g.from) + Math.max(0, (g.mTo ?? 0) - (g.mFrom ?? 0)),
      0,
    );
  if (Math.abs(length - ridden) > ALIGNED.length * ridden + 20) return null;
  return unsafeReason(recorded, matched, stops, exempt) === null
    ? { head, tail }
    : null;
}

/**
 * Whether a rebuilt track can replace the recorded one: every route point
 * that was near the recording is near the result, the recording is covered
 * all along (except stretches replaced as GPS glitches) and the result is no
 * detour. A failed check means the comparison went wrong somewhere: the
 * caller keeps the recorded track rather than show a route that skips part
 * of it.
 */
export function safeResult(
  recorded: Coord[][],
  result: Coord[][],
  stops: Coord[],
  replaced: { from: number; to: number }[] = [],
): boolean {
  return unsafeReason(recorded, result, stops, replaced) === null;
}
/** Why `safeResult` refuses a result, for tests and diagnosis; null if safe. */
function unsafeReason(
  recorded: Coord[][],
  result: Coord[][],
  stops: Coord[],
  replaced: { from: number; to: number }[] = [],
): string | null {
  const rIndex = indexTrack(recorded),
    resultIndex = indexTrack(result);
  if (!resultIndex.total) return 'empty';
  if (resultIndex.total > rIndex.total * (1 + SAFETY.longer) + 200)
    return `longer: ${Math.round(resultIndex.total)} m for ${Math.round(rIndex.total)} m`;
  const toResult = distanceTo(result),
    toRecorded = distanceTo(recorded);
  for (const [n, stop] of stops.entries())
    if (toRecorded(stop) <= SAFETY.stop && toResult(stop) > SAFETY.stop)
      return `stop ${n + 1} is ${Math.round(toResult(stop))} m away`;
  for (const e of rIndex.edges)
    for (let d = 0; d < e.length; d += SAFETY.step) {
      const along = e.from + d;
      if (replaced.some((r) => along >= r.from && along < r.to)) continue;
      const f = d / e.length;
      const p: Coord = [
        e.a[0] + (e.b[0] - e.a[0]) * f,
        e.a[1] + (e.b[1] - e.a[1]) * f,
      ];
      const away = toResult(p);
      if (away > SAFETY.cover)
        return `uncovered at ${Math.round(along)} m, ${Math.round(away)} m away`;
    }
  return null;
}

/**
 * Along-track distances where the track turns back on itself (the end of an
 * out-and-back): 200 m before and after the point are within 60 m of each
 * other while the point is more than 150 m from them. A map matcher folds
 * such a U-turn away, so matching pieces end there. A zigzag while stopped
 * is too small to count.
 */
export function turnarounds(segments: Coord[][]): number[] {
  const index = indexTrack(segments);
  const at = (d: number) => pointAtDistance(index, d)?.coord;
  const found: { d: number; reach: number }[] = [];
  for (const e of index.edges) {
    const d = e.from;
    if (d < 200 || d > index.total - 200) continue;
    const before = at(d - 200),
      after = at(d + 200);
    if (!before || !after || meters(before, after) > 60) continue;
    const reach = Math.min(meters(before, e.a), meters(after, e.a));
    if (reach < 150) continue;
    const last = found.at(-1);
    if (last && d - last.d < 300) {
      if (reach > last.reach) found[found.length - 1] = { d, reach };
    } else found.push({ d, reach });
  }
  return found.map((f) => f.d);
}
