import type { View } from './default-view';
import { REGION_PATH, regionView } from './region';
import { type Coord, serverUrl, validCoord } from './core';
import {
  PREFERENCE,
  readPreference,
  readSession,
  SESSION,
  writePreference,
  writeSession,
} from './preferences';
import { pause, RequestQueue, request, json } from './http';
const searching = new RequestQueue(1100);
export interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}
const cache = new Map<string, SearchResult[]>();
export async function searchAddress(
  query: string,
  base: string,
): Promise<SearchResult[]> {
  const key = `${base}:${query.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;
  return searching.run(async () => {
    const request = async () => {
      // Coordinate tabs where Web Locks is available. No location data stored.
      const last = Number(readPreference(PREFERENCE.lastSearch) || 0);
      await pause(Math.max(0, 1100 - (Date.now() - last)));
      writePreference(PREFERENCE.lastSearch, String(Date.now()));
      if (cache.has(key)) return cache.get(key)!;
      const u = new URL(`${serverUrl(base)}/search`);
      u.search = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '5',
        'accept-language': 'en',
      }).toString();
      const d = (await json(u.href)) as SearchResult[];
      if (!Array.isArray(d))
        throw new Error('The search server returned an invalid response.');
      cache.set(key, d);
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      return d;
    };
    return navigator.locks
      ? navigator.locks.request('nautavo-nominatim', request)
      : request();
  });
}

// One attempt per tab session, including failures. Only the coarse result lives in memory.
let regionAttempt: Promise<View | null> | undefined;
/** The approximate region from the site's own Worker (src/region.ts). */
export function approximateRegion(enabled: boolean): Promise<View | null> {
  if (!enabled) return Promise.resolve(null);
  if (regionAttempt) return regionAttempt;
  regionAttempt = (async () => {
    // Memory still limits attempts if storage is blocked.
    if (readSession(SESSION.regionAttempted)) return null;
    writeSession(SESSION.regionAttempted, 'true');
    try {
      const response = await request(REGION_PATH, 3000, { noStore: true });
      if (response.status !== 200) return null;
      return regionView(await response.json());
    } catch {
      return null;
    }
  })();
  return regionAttempt;
}

export const defaultPhotonUrl = 'https://photon.komoot.io';
const photonQueue = new RequestQueue(1000);
const photonCache = new Map<string, SearchResult[]>();
/** Photon's GeoJSON answer, untrusted: every field is checked before use. */
interface PhotonResponse {
  features?: ({
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: Record<string, unknown>;
  } | null)[];
}
/** Serialized, cancellable search-as-you-type. Bias is deliberately city-scale. */
export async function photonSearch(
  query: string,
  base: string,
  center: Coord,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const bias = center.map((n) => Math.round(n * 10) / 10);
  const key = JSON.stringify([base, query.trim().toLowerCase(), bias]);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (photonCache.has(key)) return photonCache.get(key)!;
  return photonQueue.run(async () => {
    signal.throwIfAborted();
    if (photonCache.has(key)) return photonCache.get(key)!;
    const url = new URL(`${serverUrl(base)}/api/`);
    url.search = new URLSearchParams({
      q: query.trim(),
      limit: '5',
      lat: String(bias[0]),
      lon: String(bias[1]),
    }).toString();
    const response = await request(url, 8000, { signal });
    if (!response.ok) throw new Error('Photon unavailable');
    const data = (await response.json()) as PhotonResponse | null;
    if (!Array.isArray(data?.features))
      throw new Error('Invalid Photon response');
    const results: SearchResult[] = [];
    for (const feature of data.features.slice(0, 5)) {
      const coords: unknown = feature?.geometry?.coordinates;
      const lonLat: unknown[] = Array.isArray(coords) ? coords : [];
      const at: unknown = [lonLat[1], lonLat[0]];
      const p = feature?.properties;
      if (
        feature?.geometry?.type !== 'Point' ||
        !validCoord(at) ||
        !p ||
        typeof p.name !== 'string'
      )
        continue;
      const name = [
        ...new Set(
          [p.name, p.street, p.city, p.state, p.country].filter(
            (v): v is string => typeof v === 'string' && v !== '',
          ),
        ),
      ].join(', ');
      results.push({
        display_name: name,
        lat: String(at[0]),
        lon: String(at[1]),
      });
    }
    signal.throwIfAborted();
    photonCache.set(key, results);
    if (photonCache.size > 100)
      photonCache.delete(photonCache.keys().next().value!);
    return results;
  });
}
