import { WeatherCache, weatherCoordinateKey } from './weather-cache';
import {
  HOUR,
  MAX_WEATHER_POINTS,
  type WeatherForecast,
  type WeatherHour,
  type WeatherPoint,
} from './weather';
import { type Coord, serverUrl, validCoord } from './core';
import { RequestQueue, request } from './http';
// Weather stays in page memory. Never use HTTP/storage caches for route samples.
// Serialized starts plus rolling per-location budgets bound both short and long intervals.
const weatherQueue = new RequestQueue(6000);
const weatherCache = new WeatherCache();
const weatherUsage: { time: number; cost: number }[] = [];
/**
 * Open-Meteo counts each location as one call (600 per minute and larger
 * hourly, daily and monthly budgets), and weather and elevation share this
 * page budget. Reserves `cost` coordinates in it: returns 0 when reserved,
 * otherwise the milliseconds until enough of the budget frees up, reserving
 * nothing.
 */
function reserveOpenMeteo(cost: number): number {
  const now = Date.now();
  let wait = 0;
  for (const [window, limit] of [
    [60000, 599],
    [HOUR, 4999],
    [24 * HOUR, 9999],
    [31 * 24 * HOUR, 299999],
  ]) {
    const recent = weatherUsage.filter((u) => now - u.time < window);
    let used = recent.reduce((n, u) => n + u.cost, cost);
    if (used <= limit) continue;
    // Oldest first: wait until enough entries leave this window.
    for (const u of recent) {
      used -= u.cost;
      if (used <= limit) {
        wait = Math.max(wait, u.time + window - now);
        break;
      }
    }
    if (used > limit) wait = Math.max(wait, window);
  }
  if (wait) return wait;
  weatherUsage.push({ time: now, cost });
  while (weatherUsage.length && now - weatherUsage[0].time >= 31 * 24 * HOUR)
    weatherUsage.shift();
  return 0;
}
/** The server's Retry-After in milliseconds, or null when absent or odd. */
function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers?.get('Retry-After'));
  return seconds > 0 && seconds < 86400 ? seconds * 1000 : null;
}
/** Wait after HTTP 429 when the server does not expose Retry-After. */
const DEFAULT_LIMIT_WAIT = 60_000;
/**
 * The Open-Meteo usage limit (the shared budget or HTTP 429), with the
 * milliseconds until it frees up. The interface counts down and retries once.
 */
export class UsageLimitError extends Error {
  constructor(
    readonly service: 'Weather' | 'Elevation',
    readonly wait: number,
  ) {
    super(`${service} usage limit reached. ${retryIn(wait)}`);
    this.name = 'UsageLimitError';
  }
}
/**
 * Calls `tick` with the seconds left, once a second, then `done`. Counted by
 * timer ticks, not the clock. Returns a function that cancels it.
 */
export function countdown(
  wait: number,
  tick: (seconds: number) => void,
  done: () => void,
): () => void {
  let left = Math.max(1, Math.ceil(wait / 1000));
  let timer: ReturnType<typeof setTimeout>;
  const step = () => {
    if (left <= 0) return done();
    tick(left--);
    timer = setTimeout(step, 1000);
  };
  step();
  return () => clearTimeout(timer);
}
/** "Try again in 30s." (or minutes, hours) for a usage-limit message. */
export function retryIn(ms: number): string {
  if (ms < 120_000)
    return `Try again in ${Math.max(1, Math.ceil(ms / 1000))}s.`;
  if (ms < HOUR) return `Try again in ${Math.ceil(ms / 60000)} min.`;
  return `Try again in ${Math.ceil(ms / HOUR)} h.`;
}
export const WEATHER_VARIABLES = {
  temperature: 'temperature_2m',
  probability: 'precipitation_probability',
  precipitation: 'precipitation',
  code: 'weather_code',
  wind: 'wind_speed_10m',
  windDirection: 'wind_direction_10m',
  gusts: 'wind_gusts_10m',
  visibility: 'visibility',
  uv: 'uv_index',
} as const;
/** Variables that may be missing (e.g. for some past dates) without failing the forecast. */
const OPTIONAL_WEATHER_VARIABLES: ReadonlySet<string> = new Set(['uv_index']);
export function weatherUrl(
  base: string,
  points: WeatherPoint[],
  start: number,
  end: number,
): string {
  if (
    !points.length ||
    points.length > MAX_WEATHER_POINTS ||
    points.some((p) => !validCoord(p.coord)) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    start % HOUR !== 0 ||
    end % HOUR !== 0
  )
    throw new Error('Weather service returned an invalid response.');
  const url = new URL(`${serverUrl(base)}/v1/forecast`);
  const hour = (time: number) =>
    new Date(time).toISOString().slice(0, 13) + ':00';
  url.search = new URLSearchParams({
    latitude: points.map((p) => p.coord[0].toFixed(3)).join(','),
    longitude: points.map((p) => p.coord[1].toFixed(3)).join(','),
    hourly: Object.values(WEATHER_VARIABLES).join(','),
    start_hour: hour(start),
    end_hour: hour(end),
    timezone: 'GMT',
    timeformat: 'unixtime',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  }).toString();
  return url.href;
}
export function parseWeather(
  data: unknown,
  count: number,
  start: number,
  end: number,
): WeatherForecast {
  const rows = Array.isArray(data) ? data : [data];
  const invalid = () =>
    new Error('Weather service returned an invalid response.');
  if (rows.length !== count) throw invalid();
  const hours = rows.map(
    (row: {
      hourly?: Record<string, unknown>;
      utc_offset_seconds?: number;
    }) => {
      if (!row || row.utc_offset_seconds !== 0 || !row.hourly) throw invalid();
      const h = row.hourly,
        times = h.time;
      if (
        !Array.isArray(times) ||
        times.length !== Math.round((end - start) / HOUR) + 1 ||
        times.some(
          (v, i) => typeof v !== 'number' || v * 1000 !== start + i * HOUR,
        )
      )
        throw invalid();
      for (const variable of Object.values(WEATHER_VARIABLES)) {
        if (
          h[variable] === undefined &&
          OPTIONAL_WEATHER_VARIABLES.has(variable)
        )
          h[variable] = times.map(() => null);
        const values = h[variable];
        if (
          !Array.isArray(values) ||
          values.length !== times.length ||
          values.some(
            (v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v)),
          )
        )
          throw invalid();
      }
      return times.map((time, i) => {
        const value = Object.fromEntries(
          Object.entries(WEATHER_VARIABLES).map(([key, variable]) => [
            key,
            (h[variable] as (number | null)[])[i],
          ]),
        ) as Omit<WeatherHour, 'time'>;
        if (
          (value.probability !== null &&
            (value.probability < 0 || value.probability > 100)) ||
          [
            value.precipitation,
            value.wind,
            value.gusts,
            value.visibility,
            value.uv,
          ].some((v) => v !== null && v < 0) ||
          (value.windDirection !== null &&
            (value.windDirection < 0 || value.windDirection > 360)) ||
          (value.code !== null &&
            (!Number.isInteger(value.code) ||
              value.code < 0 ||
              value.code > 99))
        )
          throw invalid();
        return { time: time * 1000, ...value };
      });
    },
  );
  return { hours, start, end };
}
export async function weatherForecast(
  base: string,
  points: WeatherPoint[],
  start: number,
  end: number,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<WeatherForecast> {
  signal.throwIfAborted();
  if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
  weatherUrl(base, points, start, end); // Validate before cache lookup.
  const cached = () =>
    points.map((point) => weatherCache.get(base, point, start, end));
  const hit = cached();
  if (hit.every((hours) => hours !== undefined))
    return { hours: hit, start, end };
  return weatherQueue.run(
    async () => {
      signal.throwIfAborted();
      if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
      const hours = cached();
      const missing = new Map<string, WeatherPoint>();
      points.forEach((point, i) => {
        if (!hours[i]) missing.set(weatherCoordinateKey(point), point);
      });
      if (!missing.size) return { hours: hours as WeatherHour[][], start, end };
      const needed = [...missing.values()];
      const url = weatherUrl(base, needed, start, end);
      // Conservative whole-call accounting per location, including >14-day ranges.
      const cost =
        needed.length * Math.ceil((end - start + HOUR) / (14 * 24 * HOUR));
      const wait = reserveOpenMeteo(cost);
      if (wait) throw new UsageLimitError('Weather', wait);
      try {
        const response = await request(url, 20000, { signal, noStore: true });
        if (response.status === 429)
          throw new UsageLimitError(
            'Weather',
            retryAfterMs(response) ?? DEFAULT_LIMIT_WAIT,
          );
        if (!response.ok) throw new Error('Weather unavailable. Try again.');
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new Error('Weather service returned an invalid response.');
        }
        const forecast = parseWeather(data, needed.length, start, end);
        signal.throwIfAborted();
        if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
        needed.forEach((point, i) =>
          weatherCache.set(base, point, forecast.hours[i]),
        );
        const fresh = new Map(
          needed.map((point, i) => [
            weatherCoordinateKey(point),
            forecast.hours[i],
          ]),
        );
        return {
          hours: points.map(
            (point, i) => hours[i] ?? fresh.get(weatherCoordinateKey(point))!,
          ),
          start,
          end,
        };
      } catch (error) {
        if (signal.aborted) throw error;
        if (
          error instanceof DOMException &&
          ['TimeoutError', 'AbortError'].includes(error.name)
        )
          throw new Error('Weather request timed out. Try again.', {
            cause: error,
          });
        if (error instanceof TypeError)
          throw new Error(
            'Weather network error. Check your connection and try again.',
            { cause: error },
          );
        throw error;
      }
    },
    () => !signal.aborted && isCurrent(),
  );
}

/**
 * Elevation (Open-Meteo `/v1/elevation`, Copernicus DEM GLO-90): requested
 * only when the user opens Elevation, in chunks of 100 coordinates,
 * serialized, without retries. Values stay in a bounded page-memory cache.
 */
const ELEVATION_CHUNK = 100,
  ELEVATION_CACHE = 5000,
  ELEVATION_TTL = 10 * 60 * 1000;
const elevationQueue = new RequestQueue(1100);
const elevationCache = new Map<string, { value: number | null; at: number }>();
const elevationKey = ([lat, lon]: Coord) =>
  `${lat.toFixed(4)},${lon.toFixed(4)}`;
export function elevationUrl(base: string, coords: Coord[]): string {
  if (
    !coords.length ||
    coords.length > ELEVATION_CHUNK ||
    coords.some((c) => !validCoord(c))
  )
    throw new Error('Elevation unavailable. Try again.');
  const url = new URL(`${serverUrl(base)}/v1/elevation`);
  url.search = new URLSearchParams({
    latitude: coords.map((c) => c[0].toFixed(4)).join(','),
    longitude: coords.map((c) => c[1].toFixed(4)).join(','),
  }).toString();
  return url.href;
}
export function parseElevation(
  data: unknown,
  count: number,
): (number | null)[] {
  const values = (data as { elevation?: unknown })?.elevation;
  if (
    !Array.isArray(values) ||
    values.length !== count ||
    values.some(
      (v) =>
        v !== null &&
        (typeof v !== 'number' || !Number.isFinite(v) || v < -500 || v > 9000),
    )
  )
    throw new Error('Elevation service returned an invalid response.');
  return values as (number | null)[];
}
export async function fetchElevations(
  base: string,
  coords: Coord[],
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<(number | null)[]> {
  const now = () => Date.now();
  const fresh = (key: string) => {
    const hit = elevationCache.get(key);
    return hit && now() - hit.at < ELEVATION_TTL ? hit : undefined;
  };
  const missing = [
    ...new Map(
      coords
        .filter((c) => !fresh(elevationKey(c)))
        .map((c) => [elevationKey(c), c]),
    ).values(),
  ];
  for (let i = 0; i < missing.length; i += ELEVATION_CHUNK) {
    const chunk = missing.slice(i, i + ELEVATION_CHUNK);
    const url = elevationUrl(base, chunk);
    const values = await elevationQueue.run(
      async () => {
        signal.throwIfAborted();
        // Each coordinate counts against the shared Open-Meteo budget.
        const wait = reserveOpenMeteo(chunk.length);
        if (wait) throw new UsageLimitError('Elevation', wait);
        let response: Response;
        try {
          response = await request(url, 20000, { signal, noStore: true });
        } catch (error) {
          if ((error as Error).name === 'AbortError' && signal.aborted)
            throw error;
          throw new Error('Elevation unavailable. Try again.', {
            cause: error,
          });
        }
        if (response.status === 429)
          throw new UsageLimitError(
            'Elevation',
            retryAfterMs(response) ?? DEFAULT_LIMIT_WAIT,
          );
        if (!response.ok) throw new Error('Elevation unavailable. Try again.');
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new Error('Elevation service returned an invalid response.');
        }
        return parseElevation(data, chunk.length);
      },
      () => !signal.aborted && isCurrent(),
    );
    chunk.forEach((c, j) =>
      elevationCache.set(elevationKey(c), { value: values[j], at: now() }),
    );
    // Bounded: drop the oldest entries first.
    while (elevationCache.size > ELEVATION_CACHE)
      elevationCache.delete(elevationCache.keys().next().value!);
  }
  return coords.map((c) => fresh(elevationKey(c))?.value ?? null);
}
