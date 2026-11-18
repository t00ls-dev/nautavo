// The approximate region for the first map view (AGENTS.md, Network behavior
// and privacy): the site's own Worker answers it from the location Cloudflare
// derives from the request's IP address, so no third party sees the visitor.
import type { Coord } from './core';
import type { View } from './default-view';

/** Same-origin endpoint served by the Worker (src/worker.ts). */
export const REGION_PATH = '/api/region';

/** What the Worker sends: a coarse position and the place names it rests on. */
export interface RegionAnswer {
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
}

/**
 * The fields that place a visitor: Cloudflare's `request.cf` in the Worker,
 * the answer in the app (untrusted there, like any response).
 */
export interface RegionFields {
  latitude?: unknown;
  longitude?: unknown;
  city?: unknown;
  region?: unknown;
}

const name = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const tenth = (value: number) => Math.round(value * 10) / 10;
const coordinate = (value: unknown, limit: number) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' &&
    Number.isFinite(number) &&
    Math.abs(number) <= limit
    ? number
    : null;
};

/**
 * The answer for some region fields, rounded to 0.1° (about 11 km), or null
 * when they name no city or region (a country-wide position would place the
 * map badly).
 */
export function regionAnswer(
  fields: RegionFields | undefined,
): RegionAnswer | null {
  const latitude = coordinate(fields?.latitude, 90);
  const longitude = coordinate(fields?.longitude, 180);
  const city = name(fields?.city);
  const region = name(fields?.region);
  if (latitude === null || longitude === null || (!city && !region))
    return null;
  return {
    latitude: tenth(latitude),
    longitude: tenth(longitude),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
  };
}

/** The map view for an answer, which is untrusted like any response. */
export function regionView(data: unknown): View | null {
  if (!data || typeof data !== 'object') return null;
  const answer = regionAnswer(data);
  return answer
    ? {
        center: [answer.latitude, answer.longitude] as Coord,
        zoom: 9,
      }
    : null;
}
