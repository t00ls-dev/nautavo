import { pointAtDistance, type TrackIndex } from './track-position';
import { bearingBetween } from './weather-wind';
import { travelTimeSeconds } from './travel-time';
import type { Coord } from './core';

/**
 * Replay on the navigation screen (#154): simulated positions along the
 * track at the traveler's average speed, fed to the same tracker as live
 * navigation. Local only: no location, compass or request.
 */

/**
 * Meters travelled per second at 1× (10× covers 2.5 km per second), as the
 * earlier Travel the route moved.
 */
export const METERS_PER_SECOND = 250;
/**
 * The replay turns the map toward the track this far ahead, so the small
 * bends of a road do not swing it as the replay crosses many of them a
 * second; the arrow keeps the road's own direction.
 */
const REPLAY_HEADING_AHEAD = 60;

export interface ReplayFix {
  coord: Coord;
  /** Where the map turns: toward the track a little ahead, degrees from north. */
  heading: number | null;
  /** Direction of the track's own segment here, for the arrow, or null. */
  bearing: number | null;
  /** The traveler's speed, m/s (the trip's, not the replay's). */
  speed: number;
  /** When the traveler would be here, ms since the epoch. */
  time: number;
}

/**
 * The simulated position at an along-track distance: where the traveler
 * would be, heading and when, leaving at `departure` (ms) at `speedKmh`.
 */
export function replayFix(
  index: TrackIndex,
  distance: number,
  speedKmh: number,
  departure: number,
): ReplayFix | null {
  const point = pointAtDistance(index, distance);
  if (!point) return null;
  const travelled = Math.max(0, Math.min(index.total, distance));
  const ahead = pointAtDistance(
    index,
    Math.min(index.total, travelled + REPLAY_HEADING_AHEAD),
  );
  const far =
    ahead &&
    ahead.segment === point.segment &&
    (ahead.coord[0] !== point.coord[0] || ahead.coord[1] !== point.coord[1]);
  return {
    coord: point.coord,
    bearing: point.bearing,
    heading:
      (far ? bearingBetween(point.coord, ahead.coord) : null) ?? point.bearing,
    speed: speedKmh / 3.6,
    time: departure + travelTimeSeconds(travelled, speedKmh) * 1000,
  };
}

/** Distance after `elapsedMs` of replay at `rate` × `METERS_PER_SECOND`. */
export function replayAdvance(
  distance: number,
  elapsedMs: number,
  rate: number,
  total: number,
): number {
  const step = METERS_PER_SECOND * rate * (Math.max(0, elapsedMs) / 1000);
  return Math.min(total, Math.max(0, distance + step));
}
