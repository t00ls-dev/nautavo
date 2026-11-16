import { validRoute, type Route } from './core';
import { readSession, SESSION, writeSession } from './preferences';

/**
 * Continuing guided navigation after a reload (#138): iOS discards hidden
 * tabs, a pull-to-refresh or a browser restart reloads the page. While
 * navigating, this tab's sessionStorage keeps the planned route's geometry
 * and the distance travelled along it, never a position, so the same route
 * resumes on the right pass, offline too. A reloaded link would recalculate
 * its route instead, and an imported track would come back different.
 * Cleared on exit, arrival, Not now, after `RESUME_LIMIT`, or with the tab.
 */
export const RESUME_LIMIT = 30 * 60 * 1000;
/** Progress is written at most this often, or after this many meters. */
export const RESUME_EVERY = { time: 15_000, distance: 200 } as const;

interface Remembered {
  v: 1;
  /** The address hash when navigation started: the route's identity. */
  hash: string;
  route: Route;
  /** Meters travelled along the route. */
  progress: number;
  /** When the record was last written, in milliseconds. */
  at: number;
}

let record: Remembered | null = null;
let written = { at: 0, progress: 0 };

const save = () => writeSession(SESSION.navigation, JSON.stringify(record));

export function rememberNavigation(
  route: Route,
  hash: string,
  now: number,
  progress = 0,
) {
  record = { v: 1, hash, route, progress, at: now };
  written = { at: now, progress };
  save();
}
/** Records progress, at most `RESUME_EVERY` unless `force` (page hidden). */
export function rememberProgress(progress: number, now: number, force = false) {
  if (!record) return;
  record.progress = progress;
  record.at = now;
  if (
    !force &&
    now - written.at < RESUME_EVERY.time &&
    Math.abs(progress - written.progress) < RESUME_EVERY.distance
  )
    return;
  written = { at: now, progress };
  save();
}
export function forgetNavigation() {
  record = null;
  writeSession(SESSION.navigation, null);
}
/** The navigation this tab can continue on `hash`, or null (then cleared). */
export function resumableNavigation(
  hash: string,
  now: number,
): { route: Route; progress: number } | null {
  const text = readSession(SESSION.navigation);
  if (!text) return null;
  let found: Partial<Remembered> | null;
  try {
    found = JSON.parse(text) as Partial<Remembered>;
  } catch {
    found = null;
  }
  const valid =
    !!found &&
    found.v === 1 &&
    found.hash === hash &&
    typeof found.at === 'number' &&
    now - found.at >= 0 &&
    now - found.at <= RESUME_LIMIT &&
    typeof found.progress === 'number' &&
    Number.isFinite(found.progress) &&
    found.progress >= 0 &&
    validRoute(found.route);
  if (!valid) {
    forgetNavigation();
    return null;
  }
  return { route: found!.route!, progress: found!.progress! };
}
