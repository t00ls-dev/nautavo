import type { State } from './core';
import { departureError, nextDepartureSlot } from './weather';
import { PREFERENCE, readPreference, writePreference } from './preferences';

/**
 * Automatic departure: while the route has no departure of its own, it leaves
 * at the next local :00/:30 slot, which moves forward as time passes. It lives
 * in page memory only: links, saved routes, backups and the JSON editor carry
 * only a departure the user chose (`state.departure`). Clearing the field
 * turns it off until the page reloads; a device preference turns it off.
 */

let enabled = readPreference(PREFERENCE.autoDeparture) !== 'off';
let declined = false;

/** The current automatic departure (ISO), or undefined when off or invalid. */
function automatic(now = Date.now()): string | undefined {
  if (!enabled || declined) return undefined;
  const iso = new Date(nextDepartureSlot(now)).toISOString();
  return departureError(iso, now) ? undefined : iso;
}

/** Departure used for weather, daylight, arrival and playback. */
export function departureOf(
  state: State,
  now = Date.now(),
): string | undefined {
  return state.departure ?? automatic(now);
}

/** True when the departure in use is the automatic one. */
export function isAutomaticDeparture(state: State, now = Date.now()): boolean {
  return !state.departure && automatic(now) !== undefined;
}

/** Milliseconds until the automatic departure moves to the next slot. */
export function untilNextSlot(now = Date.now()): number {
  return nextDepartureSlot(now) - now + 1;
}

/** The user cleared the field: no automatic departure until reload. */
export function declineAutomaticDeparture() {
  declined = true;
}

/** Device preference; turning it on also resumes after a decline. */
export function setAutomaticDeparture(value: boolean) {
  enabled = value;
  if (value) declined = false;
  writePreference(PREFERENCE.autoDeparture, value ? null : 'off');
}
