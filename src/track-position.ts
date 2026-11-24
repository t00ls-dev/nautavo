import { meters, type Coord } from './core';
import { bearingBetween } from './weather-wind';

/**
 * Relates a position to the full-resolution route track, locally and without
 * network access: nearest point on the track (point to edge, not only to
 * vertices), distance travelled and remaining, distance off the route and the
 * local bearing. Edges exist only inside GPX segments, so nothing is projected
 * across a segment gap. Used by resuming, navigation and arrival estimates.
 */

interface Edge {
  a: Coord;
  b: Coord;
  /** Along-track distance at `a`, in meters. */
  from: number;
  length: number;
  segment: number;
}
export interface TrackIndex {
  edges: Edge[];
  /** Total along-track length in meters (segment gaps excluded). */
  total: number;
}
export interface TrackPosition {
  /** Projected point on the track. */
  coord: Coord;
  /** Along-track distance from the start, in meters. */
  distance: number;
  remaining: number;
  /** Distance from the position to the track, in meters. */
  offTrack: number;
  /** Direction of travel of the edge, degrees from north, or null if unknown. */
  bearing: number | null;
  segment: number;
}
export interface LocateOptions {
  /**
   * Last known along-track distance. Among passes about as close as the
   * nearest one, the first one ahead of it wins, so loops and out-and-back
   * tracks do not jump to the other pass.
   */
  progress?: number;
  /** How far behind the progress a candidate may be (GPS jitter), meters. */
  backtrack?: number;
}

/** Extra distance a farther pass may have and still count as "as close". */
export const PASS_SLACK = 30;
/**
 * Closer than this along the track (meters), nearby candidates are one pass:
 * the bends of a hairpin road, not a road travelled twice.
 */
const PASS_GAP = 500;
const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;
const longitudeDelta = (from: number, to: number) =>
  ((to - from + 540) % 360) - 180;

export function indexTrack(segments: Coord[][]): TrackIndex {
  const edges: Edge[] = [];
  let total = 0;
  segments.forEach((segment, s) => {
    for (let i = 1; i < segment.length; i++) {
      const length = meters(segment[i - 1], segment[i]);
      if (length <= 0) continue;
      edges.push({
        a: segment[i - 1],
        b: segment[i],
        from: total,
        length,
        segment: s,
      });
      total += length;
    }
  });
  return { edges, total };
}

/** Meters per degree of latitude (and of longitude at the equator). */
export const METERS_PER_DEGREE = EARTH_RADIUS * RAD;
/**
 * Projection of a position on segment a–b in a local planar frame centered
 * on it: the fraction along the segment and the distance to it, in meters.
 */
export function toSegment([lat, lon]: Coord, a: Coord, b: Coord) {
  const scale = Math.cos(lat * RAD) * METERS_PER_DEGREE;
  const x = (c: Coord) => longitudeDelta(lon, c[1]) * scale,
    y = (c: Coord) => (c[0] - lat) * METERS_PER_DEGREE;
  const ax = x(a),
    ay = y(a),
    dx = x(b) - ax,
    dy = y(b) - ay;
  const squared = dx * dx + dy * dy;
  const t = squared
    ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared))
    : 0;
  const px = ax + t * dx,
    py = ay + t * dy;
  return { t, offTrack: Math.hypot(px, py) };
}
const project = (edge: Edge, position: Coord) =>
  toSegment(position, edge.a, edge.b);
/** A position projected on every edge, with the along-track distance. */
function projectAll(index: TrackIndex, coord: Coord) {
  return index.edges.map((edge) => {
    const { t, offTrack } = project(edge, coord);
    return { edge, t, offTrack, at: edge.from + t * edge.length };
  });
}
/**
 * Projections grouped into passes (closer than `PASS_GAP` along the track
 * are one), each by its point nearest the position, in track order.
 */
function nearestPerPass<P extends { at: number; offTrack: number }>(
  projections: P[],
): P[] {
  const passes: P[][] = [];
  for (const p of [...projections].sort((a, b) => a.at - b.at)) {
    const pass = passes.at(-1);
    if (pass && p.at - pass[pass.length - 1].at < PASS_GAP) pass.push(p);
    else passes.push([p]);
  }
  return passes.map((pass) =>
    pass.reduce((nearest, p) => (p.offTrack < nearest.offTrack ? p : nearest)),
  );
}

export function locateOnTrack(
  index: TrackIndex,
  coord: Coord,
  options: LocateOptions = {},
): TrackPosition | null {
  if (!index.edges.length) return null;
  const projections = projectAll(index, coord);
  let best = projections[0];
  for (const p of projections) if (p.offTrack < best.offTrack) best = p;
  let chosen = best;
  if (options.progress !== undefined) {
    // The first pass ahead among those about as close as the nearest, at
    // its point nearest the position (not the vertex just behind it).
    const floor = options.progress - (options.backtrack ?? 100);
    const ahead = nearestPerPass(
      projections.filter(
        (p) => p.offTrack <= best.offTrack + PASS_SLACK && p.at >= floor,
      ),
    )[0];
    if (ahead) chosen = ahead;
  }
  const { edge, t, offTrack, at: distance } = chosen;
  return {
    coord: [
      edge.a[0] + (edge.b[0] - edge.a[0]) * t,
      ((edge.a[1] + longitudeDelta(edge.a[1], edge.b[1]) * t + 540) % 360) -
        180,
    ],
    distance,
    remaining: Math.max(0, index.total - distance),
    offTrack,
    bearing: bearingBetween(edge.a, edge.b),
    segment: edge.segment,
  };
}

/** One pass of the track near a position (#191). */
export interface TrackPass {
  /** Along-track distance of the pass's point nearest the position, meters. */
  at: number;
  /** Distance from the position to that point, meters. */
  offTrack: number;
  /** Direction of travel there, degrees from north, or null if unknown. */
  bearing: number | null;
}
/**
 * The passes of the track about as close to a position as the nearest one
 * (within `slack` meters of it), nearest first: two or more where the track
 * uses the same road more than once (an out-and-back, a lollipop stem, the
 * crossing of a figure eight). Candidates closer than `PASS_GAP` along the
 * track count as one pass.
 */
export function passesNear(
  index: TrackIndex,
  coord: Coord,
  slack: number,
): TrackPass[] {
  if (!index.edges.length) return [];
  const projections = projectAll(index, coord);
  // A loop, not Math.min(...): a long imported track has too many edges to
  // spread as arguments.
  let nearest = Infinity;
  for (const p of projections) nearest = Math.min(nearest, p.offTrack);
  return nearestPerPass(
    projections.filter((p) => p.offTrack <= nearest + slack),
  )
    .map((p) => ({
      at: p.at,
      offTrack: p.offTrack,
      bearing: bearingBetween(p.edge.a, p.edge.b),
    }))
    .sort((a, b) => a.offTrack - b.offTrack);
}
/** The smaller angle between two directions, degrees (0 to 180). */
export const headingGap = (a: number, b: number) =>
  Math.abs(longitudeDelta(a, b));

export interface TrackPoint {
  coord: Coord;
  bearing: number | null;
  segment: number;
}
/**
 * The point at an along-track distance (clamped to the track). At the end of a
 * GPX segment the next distance continues at the start of the next segment,
 * so a gap is crossed without inventing a path through it.
 */
export function pointAtDistance(
  index: TrackIndex,
  distance: number,
): TrackPoint | null {
  const { edges } = index;
  if (!edges.length) return null;
  const target = Math.max(0, Math.min(index.total, distance));
  // Binary search for the last edge starting at or before the target.
  let low = 0,
    high = edges.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (edges[middle].from <= target) low = middle;
    else high = middle - 1;
  }
  const edge = edges[low];
  const t = edge.length ? Math.min(1, (target - edge.from) / edge.length) : 0;
  return {
    coord: [
      edge.a[0] + (edge.b[0] - edge.a[0]) * t,
      ((edge.a[1] + longitudeDelta(edge.a[1], edge.b[1]) * t + 540) % 360) -
        180,
    ],
    bearing: bearingBetween(edge.a, edge.b),
    segment: edge.segment,
  };
}

/**
 * Track between two along-track distances, split at GPX segment gaps, for
 * highlighting a stretch (for example a climb) on the map.
 */
export function trackSlice(
  index: TrackIndex,
  from: number,
  to: number,
): Coord[][] {
  const start = pointAtDistance(index, from),
    end = pointAtDistance(index, to);
  if (!start || !end || to <= from) return [];
  const out: Coord[][] = [[start.coord]];
  let segment = start.segment;
  for (const edge of index.edges) {
    if (edge.from + edge.length <= from || edge.from >= to) continue;
    if (edge.segment !== segment) {
      out.push([edge.a]);
      segment = edge.segment;
    }
    if (edge.from + edge.length < to) out.at(-1)!.push(edge.b);
  }
  out.at(-1)!.push(end.coord);
  return out.filter((part) => part.length >= 2);
}

/** A track point with its along-track distance, in meters. */
export interface AlongPoint {
  coord: Coord;
  d: number;
}
/**
 * Track between two along-track distances, split at GPX segment gaps,
 * keeping every recorded point exactly: only the points at the two cuts are
 * interpolated, so geometry kept around an edit or a repair exports byte for
 * byte as it was imported.
 */
/** Overlaps shorter than this (meters) are left out of a slice. */
const SLICE_EPSILON = 0.001;
export function exactSlice(
  index: TrackIndex,
  from: number,
  to: number,
): AlongPoint[][] {
  const out: AlongPoint[][] = [];
  let segment = -1;
  const between = (
    edge: TrackIndex['edges'][number],
    d: number,
  ): AlongPoint => {
    const f = (d - edge.from) / edge.length;
    return {
      coord: [
        edge.a[0] + (edge.b[0] - edge.a[0]) * f,
        edge.a[1] + (edge.b[1] - edge.a[1]) * f,
      ],
      d,
    };
  };
  for (const edge of index.edges) {
    const end = edge.from + edge.length;
    // An overlap under a millimeter is rounding between sums, not track.
    if (end <= from + SLICE_EPSILON || edge.from >= to - SLICE_EPSILON)
      continue;
    if (edge.segment !== segment) {
      out.push([
        edge.from >= from
          ? { coord: edge.a, d: edge.from }
          : between(edge, from),
      ]);
      segment = edge.segment;
    }
    out.at(-1)!.push(end <= to ? { coord: edge.b, d: end } : between(edge, to));
  }
  return out.filter((part) => part.length >= 2);
}

/**
 * Along-track distance of each route point, in order, or null for a point
 * farther than 200 m from the track.
 */
export function legPositions(
  segments: Coord[][],
  points: Coord[],
): (number | null)[] {
  const index = indexTrack(segments);
  let progress = 0;
  return points.map((coord) => {
    const position = locateOnTrack(index, coord, { progress, backtrack: 0 });
    if (!position || position.offTrack > 200) return null;
    progress = position.distance;
    return position.distance;
  });
}
/**
 * Along-track distance of each route point on the track, in order. Sampling
 * that restarts at these points keeps the samples of unchanged legs
 * identical after an edit.
 */
export const legDistances = (segments: Coord[][], points: Coord[]): number[] =>
  legPositions(segments, points).filter((d): d is number => d !== null);

/** Roads are about this much longer than the straight line (circuity). */
const ROAD_DETOUR = 1.4;
/** How far ahead of the progress a rejoin point is looked for, meters. */
const REJOIN_LOOKAHEAD = 10000;

export interface RejoinPoint {
  coord: Coord;
  /** Along-track distance of the point, meters (never behind the progress). */
  at: number;
  /** Straight-line distance from the position, meters. */
  straight: number;
  /** Direction from the position to the point, degrees from north. */
  bearing: number;
}
/**
 * Where to rejoin the route from a position off it: the point on the track
 * ahead of the progress (never behind it, nor past `limit`) that makes the
 * trip shortest,
 * counting the way back as the straight line times `ROAD_DETOUR` plus the
 * route left from there. It does not know the roads; it is a hint.
 */
export function rejoinPoint(
  index: TrackIndex,
  coord: Coord,
  progress: number,
  /** Along-track distance it may not pass (the next route point). */
  limit = Infinity,
): RejoinPoint | null {
  const last = Math.min(limit, progress + REJOIN_LOOKAHEAD);
  let best: {
    coord: Coord;
    at: number;
    straight: number;
    cost: number;
  } | null = null;
  const consider = (point: Coord, at: number) => {
    const straight = meters(coord, point);
    const cost = ROAD_DETOUR * straight + (index.total - at);
    if (!best || cost < best.cost) best = { coord: point, at, straight, cost };
  };
  const along = (edge: Edge, t: number): Coord => [
    edge.a[0] + (edge.b[0] - edge.a[0]) * t,
    ((edge.a[1] + longitudeDelta(edge.a[1], edge.b[1]) * t + 540) % 360) - 180,
  ];
  for (const edge of index.edges) {
    const end = edge.from + edge.length;
    if (end < progress) continue;
    if (edge.from > last) break;
    // The part of the edge at or ahead of the progress, up to the limit.
    const t0 = Math.max(0, (progress - edge.from) / edge.length),
      t1 = Math.min(1, (last - edge.from) / edge.length);
    if (t1 < t0) continue;
    const t = Math.max(t0, Math.min(t1, project(edge, coord).t));
    consider(along(edge, t0), edge.from + t0 * edge.length);
    if (t > t0) consider(along(edge, t), edge.from + t * edge.length);
    consider(along(edge, t1), edge.from + t1 * edge.length);
  }
  if (!best) return null;
  const chosen = best as { coord: Coord; at: number; straight: number };
  return {
    coord: chosen.coord,
    at: chosen.at,
    straight: chosen.straight,
    bearing: bearingBetween(coord, chosen.coord) ?? 0,
  };
}
