import {
  deflateSync,
  gunzipSync,
  inflateSync,
  strFromU8,
  strToU8,
  unzipSync,
} from 'fflate';
import { decodeFit, isFit } from './fit';
export type Coord = [number, number]; // latitude, longitude
export interface Point {
  name: string;
  coord: Coord | null;
}
export interface State {
  departure?: string;
  language?: 'en' | 'pt';
  version: 1;
  points: Point[];
  prefer: boolean;
  name: string;
  osrm: string;
  valhalla: string;
  nominatim: string;
}
/** Normalized turn directions shared by the routing adapters (OSRM's set). */
const MODIFIERS = [
  'uturn',
  'sharp right',
  'right',
  'slight right',
  'straight',
  'slight left',
  'left',
  'sharp left',
] as const;
export type Modifier = (typeof MODIFIERS)[number];
export const isModifier = (value: unknown): value is Modifier =>
  (MODIFIERS as readonly unknown[]).includes(value);
/** Roundabout exit numbers kept from routers. */
export const isExit = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 20;
/** Longest sign text kept from a router (#135), characters. */
const SIGN_LENGTH = 200;
/** Text from a sign at a maneuver: a short line, no control characters. */
export const isSignText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim() === value &&
  value.length > 0 &&
  value.length <= SIGN_LENGTH &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value);
export interface Step {
  name: string;
  ref: string;
  distance: number;
  duration: number;
  /** Maneuver type in OSRM's vocabulary (depart, turn, roundabout, on ramp…). */
  kind?: string;
  roadClass?: string;
  /** Turn direction of the maneuver that starts this step. */
  modifier?: Modifier;
  /** Roundabout exit to take. */
  exit?: number;
  /** Maneuver location on the route. */
  at?: Coord;
  /**
   * The sign at the maneuver (#135): its destinations as written, comma
   * separated (the first is shown), the route numbers it names (RJ-071) and
   * the exit number (7, 12A).
   */
  toward?: string;
  branch?: string;
  exitNumber?: string;
}
export interface Route {
  segments: Coord[][];
  steps: Step[];
  distance: number;
  duration: number | null;
  provider: string;
  snapped?: Coord[];
}
export const defaults = (): State => ({
  version: 1,
  points: [
    { name: 'Start', coord: null },
    { name: 'Destination', coord: null },
  ],
  prefer: true,
  name: '',
  osrm: 'https://router.project-osrm.org',
  valhalla: 'https://valhalla1.openstreetmap.de',
  nominatim: 'https://nominatim.openstreetmap.org',
});
export function validCoord(v: unknown): v is Coord {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const pair: unknown[] = v;
  const [lat, lon] = pair;
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}
const validAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
/** Shape check for routes from routers and backups before they are drawn, saved or exported. */
export function validRoute(value: unknown): value is Route {
  const route = value as Route | null;
  return (
    !!route &&
    typeof route === 'object' &&
    Array.isArray(route.segments) &&
    route.segments.length > 0 &&
    route.segments.every(
      (s) => Array.isArray(s) && s.length >= 2 && s.every(validCoord),
    ) &&
    validAmount(route.distance) &&
    (route.duration === null || validAmount(route.duration)) &&
    typeof route.provider === 'string' &&
    Array.isArray(route.steps) &&
    route.steps.every(
      (s) =>
        !!s &&
        typeof s.name === 'string' &&
        typeof s.ref === 'string' &&
        validAmount(s.distance) &&
        validAmount(s.duration) &&
        (s.kind === undefined || typeof s.kind === 'string') &&
        (s.modifier === undefined || isModifier(s.modifier)) &&
        (s.exit === undefined || isExit(s.exit)) &&
        (s.at === undefined || validCoord(s.at)) &&
        (s.toward === undefined || isSignText(s.toward)) &&
        (s.branch === undefined || isSignText(s.branch)) &&
        (s.exitNumber === undefined || isSignText(s.exitNumber)),
    ) &&
    (route.snapped === undefined ||
      (Array.isArray(route.snapped) && route.snapped.every(validCoord)))
  );
}
export function parseCoordinates(text: string): Coord | null {
  const match = text
    .trim()
    .match(/^\(?\s*([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)\s*\)?$/);
  if (!match) return null;
  const c: Coord = [Number(match[1]), Number(match[2])];
  return validCoord(c) ? c : null;
}
export function serverUrl(text: string): string {
  const u = new URL(text);
  if (
    !['https:', 'http:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw new Error(
      'Use an HTTP(S) server URL without credentials, query or hash.',
    );
  if (
    typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    u.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  )
    throw new Error('Use HTTPS for a server accessed from this site.');
  return u.href.replace(/\/$/, '');
}
/** Hosts the development server's policy lets the app reach over http. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
/**
 * A server URL typed in Settings, which this page can actually reach: the
 * published security policy (src/security-headers.ts) allows only https, and
 * the development one also http on this machine, so plain http is accepted
 * only for a local server while the app itself runs locally over http.
 * Links, saved routes and backups keep `serverUrl`, so stored data with an
 * http server still opens.
 */
export function settingsServerUrl(text: string): string {
  const url = serverUrl(text);
  const { protocol, hostname } = new URL(url);
  if (
    protocol === 'http:' &&
    typeof location !== 'undefined' &&
    !(
      location.protocol === 'http:' &&
      LOCAL_HOSTS.includes(location.hostname) &&
      LOCAL_HOSTS.includes(hostname)
    )
  )
    throw new Error('Use HTTPS for a server accessed from this site.');
  return url;
}
const toBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
const SERVER_KEYS = ['osrm', 'valhalla', 'nominatim'] as const;
const MAX_V1_LINK = 60000;
const MAX_V2_LINK = 8000;
const MAX_V2_JSON_BYTES = 256 * 1024;
const roundCoordinate = (n: number) => Math.round(n * 1e6) / 1e6;
const INVALID_LINK = 'This route link is invalid or too large.';
/** Legacy `#v1=` writer: base64url JSON of the complete State. Links in this format stay readable. */
export function encodeStateV1(state: State): string {
  return '#v1=' + toBase64Url(new TextEncoder().encode(JSON.stringify(state)));
}
/**
 * `#v2=` link: base64url raw DEFLATE of a positional JSON array
 * `[points, prefer, name, units, language, speed, departure, servers]`; the
 * units and speed slots are kept as 0 (both are now device preferences).
 * Points are `[name, lat, lon]` (6 decimals) or `[name]`; absent options are 0
 * and trailing ones are dropped; servers are omitted when all are defaults and
 * otherwise use "" for each default. Decoding reuses `validateState`.
 */
export function encodeState(state: State): string {
  const initial = defaults();
  const servers = SERVER_KEYS.map((key) =>
    state[key] === initial[key] ? '' : state[key],
  );
  const payload: unknown[] = [
    state.points.map((p) =>
      p.coord
        ? [p.name, roundCoordinate(p.coord[0]), roundCoordinate(p.coord[1])]
        : [p.name],
    ),
    state.prefer === true ? 1 : state.prefer === false ? 0 : state.prefer,
    state.name,
    0, // Former distance units slot, kept so positions stay compatible.
    state.language ?? 0,
    0, // Former average speed slot, kept so positions stay compatible.
    state.departure ?? 0,
    servers.some(Boolean) ? servers : 0,
  ];
  while (payload.at(-1) === 0) payload.pop();
  return (
    '#v2=' +
    toBase64Url(deflateSync(strToU8(JSON.stringify(payload)), { level: 9 }))
  );
}
/** Maps a `#v2=` payload back to the State shape; anything unexpected is left for `validateState` to reject. */
function decodeV2(text: string): unknown {
  // fflate truncates to the output buffer, so one spare byte detects oversized payloads.
  const out = new Uint8Array(MAX_V2_JSON_BYTES + 1);
  const bytes = inflateSync(fromBase64Url(text), { out });
  if (bytes.length > MAX_V2_JSON_BYTES) throw new Error(INVALID_LINK);
  const x: unknown = JSON.parse(strFromU8(bytes));
  if (!Array.isArray(x) || !Array.isArray(x[0])) throw new Error(INVALID_LINK);
  // Indexes 3 and 5 held the distance units and average speed, now device
  // preferences that links ignore.
  const [points, prefer, name, , language, , departure, servers] =
    x as unknown[];
  if (servers !== undefined && servers !== 0 && !Array.isArray(servers))
    throw new Error(INVALID_LINK);
  const optional = (value: unknown) =>
    value === 0 || value === undefined ? undefined : value;
  const initial = defaults();
  const list: unknown[] | null = Array.isArray(servers) ? servers : null;
  const server = (index: number): unknown =>
    list && list[index] !== '' ? list[index] : initial[SERVER_KEYS[index]];
  return {
    version: 1,
    points: (points as unknown[]).map((p) => {
      if (!Array.isArray(p)) return p;
      const fields: unknown[] = p;
      return {
        name: fields[0],
        coord: fields.length === 1 ? null : fields.slice(1),
      };
    }),
    prefer: prefer === 1 ? true : prefer === 0 ? false : prefer,
    name,
    language: optional(language),
    departure: optional(departure),
    osrm: server(0),
    valhalla: server(1),
    nominatim: server(2),
  };
}
export type ServerUrls = Pick<State, (typeof SERVER_KEYS)[number]>;
/** All three servers when any differs from the defaults, or null when a state uses only defaults. */
export function linkServerOverrides(state: State): ServerUrls | null {
  const initial = defaults();
  return SERVER_KEYS.some((key) => state[key] !== initial[key])
    ? { osrm: state.osrm, valhalla: state.valhalla, nominatim: state.nominatim }
    : null;
}
export function decodeState(hash: string): State {
  if (!hash || hash === '#') return defaults();
  if (hash.startsWith('#v2=') && hash.length <= MAX_V2_LINK)
    return validateState(decodeV2(hash.slice(4)));
  if (!hash.startsWith('#v1=') || hash.length > MAX_V1_LINK)
    throw new Error(INVALID_LINK);
  return validateState(
    JSON.parse(new TextDecoder().decode(fromBase64Url(hash.slice(4)))),
  );
}
/**
 * Validates untrusted state from links, the JSON editor or backups. Legacy
 * `averageSpeedKmh` and `units` (any value) are ignored: the speed and the
 * units are device preferences.
 */
export function validateState(raw: unknown): State {
  if (!raw || typeof raw !== 'object')
    throw new Error('This route link contains invalid points or options.');
  const x = { ...raw } as State;
  if (
    (x.language !== undefined && !['en', 'pt'].includes(x.language)) ||
    (x.departure !== undefined &&
      (typeof x.departure !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x.departure) ||
        !Number.isFinite(Date.parse(x.departure)) ||
        new Date(x.departure).toISOString() !== x.departure)) ||
    x.version !== 1 ||
    !Array.isArray(x.points) ||
    x.points.length < 2 ||
    x.points.length > 50 ||
    !x.points.every(
      (p) =>
        typeof p.name === 'string' &&
        p.name.length <= 240 &&
        (p.coord === null || validCoord(p.coord)),
    ) ||
    typeof x.prefer !== 'boolean' ||
    typeof x.name !== 'string' ||
    x.name.length > 160
  )
    throw new Error('This route link contains invalid points or options.');
  return {
    version: 1,
    points: x.points.map((p) => ({ name: p.name, coord: p.coord })),
    prefer: x.prefer,
    name: x.name,
    ...(x.language !== undefined ? { language: x.language } : {}),
    ...(x.departure !== undefined ? { departure: x.departure } : {}),
    osrm: serverUrl(x.osrm),
    valhalla: serverUrl(x.valhalla),
    nominatim: serverUrl(x.nominatim),
  };
}
export function highways(steps: Step[]): string[] {
  return [
    ...new Set(
      steps.flatMap((s) =>
        Array.from(
          s.ref.matchAll(/\b([A-Z]{1,3})[ -]?(\d{1,4}[A-Za-z]?)\b/g),
          (m) => `${m[1]}-${m[2]}`,
        ),
      ),
    ),
  ];
}
export function localSections(steps: Step[], threshold = 500): Step[] {
  return steps.filter(
    (s) =>
      s.distance >= threshold &&
      !s.ref &&
      !/motorway|trunk|ramp/.test(s.roadClass ?? s.kind ?? '') &&
      !/rodovia|highway|motorway|freeway/i.test(s.name),
  );
}
function escapeXml(s: string): string {
  return s
    .replace(
      /[<>&"']/g,
      (c) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[c]!,
    )
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 || '\t\n\r'.includes(c))
    .join('');
}
export function generateGpx(
  route: Route,
  points: Point[],
  name: string,
  date = new Date(),
): string {
  if (
    !route.segments.length ||
    route.segments.some((s) => s.length < 2 || s.some((p) => !validCoord(p)))
  )
    throw new Error('No valid route geometry to export.');
  const tag = (s: string) => escapeXml(s);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Nautavo"><metadata><name>${tag(name)}</name><time>${date.toISOString()}</time><keywords>Nautavo</keywords></metadata>${points
    .filter((p) => p.coord)
    .map(
      (p) =>
        `<wpt lat="${p.coord![0]}" lon="${p.coord![1]}"><name>${tag(p.name)}</name></wpt>`,
    )
    .join(
      '',
    )}<trk><name>${tag(name)}</name>${route.segments.map((s) => `<trkseg>${s.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg>`).join('')}</trk></gpx>\n`;
}
export function filename(points: Point[], customName = ''): string {
  const clean = (s: string, limit = 48) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, limit) || 'point';
  if (customName.trim())
    return `${clean(customName.trim().replace(/\.gpx$/i, ''), 160)}.gpx`;
  return `${clean(points[0].name)}-to-${clean(points.at(-1)!.name)}.gpx`;
}
export function meters(a: Coord, b: Coord): number {
  const rad = Math.PI / 180,
    lat = (b[0] - a[0]) * rad,
    lon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/**
 * Interior track indices for control points of an imported track without
 * waypoints. The track is first divided evenly by distance so that no leg is
 * longer than `maxSpacing` (a leg spanning several laps would be replaced
 * wholesale when one of its points is edited); Douglas–Peucker then spends the
 * remaining points on the vertices farthest from the line between neighbours,
 * so loops, out-and-back spurs and large bends get a point and a full reroute
 * follows the original shape. No point is placed within `minSpacing` metres of
 * another, so repeated laps and out-and-back sections do not stack markers.
 */
export function controlIndices(
  flat: Coord[],
  max = 20,
  tolerance = 50,
  maxSpacing = 10_000,
  minSpacing = 150,
): number[] {
  // Short tracks (under 50 points) keep only their endpoints, as before.
  if (flat.length < 50) return [];
  const rad = Math.PI / 180,
    k = Math.cos(flat[0][0] * rad) * 6371000 * rad;
  const xy = flat.map(([lat, lon]) => [lon * k, lat * 6371000 * rad]);
  const deviation = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = dx * dx + dy * dy;
    const t = len
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len),
        )
      : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const keep = [0, flat.length - 1];
  const near = (i: number) =>
    keep.some(
      (j) => Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) < minSpacing,
    );
  const along = [0];
  for (let i = 1; i < flat.length; i++)
    along.push(along[i - 1] + meters(flat[i - 1], flat[i]));
  const total = along.at(-1)!;
  const pieces = Math.min(max + 1, Math.ceil(total / maxSpacing));
  for (let n = 1, m = 0; n < pieces; n++) {
    const target = (total * n) / pieces,
      half = total / pieces / 2;
    while (m < flat.length - 1 && along[m] < target) m++;
    // Closest vertex to the target that keeps the minimum spacing.
    for (let d = 0; ; d++) {
      const up = m + d < flat.length - 1 && along[m + d] - target < half,
        down = m - d > 0 && target - along[m - d] < half;
      if (!up && !down) break;
      const j = up && !near(m + d) ? m + d : down && !near(m - d) ? m - d : -1;
      if (j >= 0) {
        keep.push(j);
        break;
      }
    }
  }
  keep.sort((a, b) => a - b);
  const farthest = (a: number, b: number) => {
    let best = -1,
      distance = 0;
    for (let i = a + 1; i < b; i++) {
      const d = deviation(xy[i], xy[a], xy[b]);
      if (d > distance && !near(i)) [best, distance] = [i, d];
    }
    return { best, distance };
  };
  while (keep.length - 2 < max) {
    let pick = { best: -1, distance: tolerance };
    for (let n = 0; n < keep.length - 1; n++) {
      const f = farthest(keep[n], keep[n + 1]);
      if (f.distance > pick.distance) pick = f;
    }
    if (pick.best < 0) break;
    keep.push(pick.best);
    keep.sort((a, b) => a - b);
  }
  return keep.slice(1, -1);
}
/**
 * Route points of a track without waypoints: its ends and the automatic
 * stops of `controlIndices`, with their flat track indices.
 */
export function trackStops(flat: Coord[]): {
  points: Point[];
  indices: number[];
} {
  const controls = controlIndices(flat);
  return {
    points: [
      { name: 'Start', coord: flat[0] },
      ...controls.map((j, i) => ({ name: `Stop ${i + 1}`, coord: flat[j] })),
      { name: 'Destination', coord: flat.at(-1)! },
    ],
    indices: [0, ...controls, flat.length - 1],
  };
}
/** Result of importing a GPX, TCX or FIT file. */
export interface ImportedTrack {
  route: Route;
  points: Point[];
  name: string;
  /** Flat track index of every point, when the points were placed on the track. */
  indices?: number[];
  /** Recorded elevation per track point, parallel to `route.segments`; only when most points have one. */
  elevations?: (number | null)[][];
}

/**
 * Sensor channels a recording may carry per track point (#156): heart rate
 * (bpm), cadence (rpm), power (W), the left leg's share of it (%, from a
 * two-sided power meter), temperature (°C) and speed (m/s).
 */
export const CHANNELS = [
  'hr',
  'cadence',
  'power',
  'balance',
  'temperature',
  'speed',
] as const;
export type Channel = (typeof CHANNELS)[number];
/** What a recording says about one track point: when, and its sensor values. */
export interface Recorded {
  /** Milliseconds since the epoch, or null when the point has no time. */
  time: number | null;
  values: Partial<Record<Channel, number>>;
}
/** Values outside these bounds are sensor errors and are dropped. */
const CHANNEL_BOUNDS: Record<Channel, [number, number]> = {
  hr: [20, 250],
  cadence: [0, 255],
  power: [0, 3000],
  balance: [0, 100],
  temperature: [-60, 70],
  speed: [0, 100],
};
/** The plausible values of a point's raw readings. */
function channelValues(
  raw: Partial<Record<Channel, number | undefined>>,
): Partial<Record<Channel, number>> {
  const values: Partial<Record<Channel, number>> = {};
  for (const channel of CHANNELS) {
    const value = raw[channel];
    const [low, high] = CHANNEL_BOUNDS[channel];
    if (value !== undefined && Number.isFinite(value))
      if (value >= low && value <= high) values[channel] = value;
  }
  return values;
}
const recordedTime = (text: string | null | undefined): number | null => {
  const time = text ? Date.parse(text.trim()) : NaN;
  return Number.isFinite(time) ? time : null;
};

/**
 * What a file holds, before shared processing: geometry, names, elevation
 * and, per point, the recorded time and sensor values. Planning import
 * (`finishImport`) uses only the geometry, names and elevation; the
 * activity view (#156) also reads the recording, in page memory only.
 */
export interface ParsedTrack {
  format: 'GPX' | 'TCX' | 'FIT';
  name: string;
  segments: Coord[][];
  elevations: (number | null)[][];
  /** Parallel to `segments`. */
  recorded: Recorded[][];
  waypoints: { name: string; coord: Coord }[];
}

const MAX_IMPORT_BYTES = 10_000_000;

const recordedElevation = (value: number): number | null =>
  Number.isFinite(value) && value > -500 && value < 9000 ? value : null;

const xmlAll = (node: Document | Element, tag: string) =>
  Array.from(node.getElementsByTagNameNS('*', tag));

function parseXml(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.querySelector('parsererror') ? null : doc;
}

function parseGpx(doc: Document): ParsedTrack {
  const all = xmlAll;
  const coord = (e: Element): Coord => {
    if (!e.hasAttribute('lat') || !e.hasAttribute('lon'))
      throw new Error('GPX point without coordinates.');
    const c: Coord = [
      Number(e.getAttribute('lat')),
      Number(e.getAttribute('lon')),
    ];
    if (!validCoord(c))
      throw new Error('The GPX contains invalid coordinates.');
    return c;
  };
  let elements = all(doc, 'trkseg')
    .map((seg) => all(seg, 'trkpt'))
    .filter((s) => s.length >= 2);
  if (!elements.length)
    elements = all(doc, 'rte')
      .map((seg) => all(seg, 'rtept'))
      .filter((s) => s.length >= 2);
  const ele = (e: Element): number | null => {
    const text = all(e, 'ele')[0]?.textContent?.trim();
    return text ? recordedElevation(Number(text)) : null;
  };
  // Garmin's TrackPointExtension (v1, v2) and the common `power` element.
  const reading = (e: Element, ...tags: string[]) => {
    for (const tag of tags) {
      const text = all(e, tag)[0]?.textContent?.trim();
      if (text) return Number(text);
    }
    return undefined;
  };
  const recorded = (e: Element): Recorded => ({
    time: recordedTime(all(e, 'time')[0]?.textContent),
    values: channelValues({
      hr: reading(e, 'hr'),
      cadence: reading(e, 'cad'),
      power: reading(e, 'power', 'PowerInWatts'),
      temperature: reading(e, 'atemp', 'wtemp'),
      speed: reading(e, 'speed'),
    }),
  });
  return {
    format: 'GPX',
    name: all(doc, 'name')[0]?.textContent || '',
    segments: elements.map((s) => s.map(coord)),
    elevations: elements.map((s) => s.map(ele)),
    recorded: elements.map((s) => s.map(recorded)),
    waypoints: all(doc, 'wpt').map((w) => ({
      name: all(w, 'name')[0]?.textContent || 'Stop',
      coord: coord(w),
    })),
  };
}

/** TCX: each `Track` is a segment; course points become named points. */
function parseTcx(doc: Document): ParsedTrack {
  const all = xmlAll;
  const child = (e: Element, tag: string) =>
    Array.from(e.children).find((c) => c.localName === tag);
  const position = (e: Element): Coord | null => {
    const p = child(e, 'Position');
    if (!p) return null;
    const c: Coord = [
      Number(child(p, 'LatitudeDegrees')?.textContent),
      Number(child(p, 'LongitudeDegrees')?.textContent),
    ];
    if (!validCoord(c))
      throw new Error('The TCX contains invalid coordinates.');
    return c;
  };
  const reading = (e: Element | undefined, tag: string) => {
    const text = e && all(e, tag)[0]?.textContent?.trim();
    return text ? Number(text) : undefined;
  };
  const segments: Coord[][] = [],
    elevations: (number | null)[][] = [],
    recorded: Recorded[][] = [];
  for (const track of all(doc, 'Track')) {
    const coords: Coord[] = [],
      eles: (number | null)[] = [],
      records: Recorded[] = [];
    for (const point of all(track, 'Trackpoint')) {
      const c = position(point);
      if (!c) continue;
      const text = child(point, 'AltitudeMeters')?.textContent?.trim();
      coords.push(c);
      eles.push(text ? recordedElevation(Number(text)) : null);
      const extensions = child(point, 'Extensions');
      records.push({
        time: recordedTime(child(point, 'Time')?.textContent),
        values: channelValues({
          hr: reading(child(point, 'HeartRateBpm'), 'Value'),
          cadence: reading(point, 'Cadence'),
          power: reading(extensions, 'Watts'),
          speed: reading(extensions, 'Speed'),
        }),
      });
    }
    if (coords.length >= 2) {
      segments.push(coords);
      elevations.push(eles);
      recorded.push(records);
    }
  }
  const course = all(doc, 'Course')[0];
  return {
    format: 'TCX',
    name: (course && child(course, 'Name')?.textContent?.trim()) || '',
    segments,
    elevations,
    recorded,
    waypoints: all(doc, 'CoursePoint').flatMap((p) => {
      const c = position(p);
      return c
        ? [{ name: child(p, 'Name')?.textContent?.trim() || 'Stop', coord: c }]
        : [];
    }),
  };
}

/** Shared processing: endpoints, waypoints, control points and distance. */
function finishImport(parsed: ParsedTrack): ImportedTrack {
  const keep = parsed.segments.flatMap((s, i) => (s.length >= 2 ? [i] : []));
  const segments = keep.map((i) => parsed.segments[i]);
  const elevationRows = keep.map((i) => parsed.elevations[i]);
  if (!segments.length)
    throw new Error(
      `No track or route geometry found in this ${parsed.format}.`,
    );
  const flat = segments.flat();
  const withElevation = elevationRows.flat().filter((v) => v !== null).length;
  const wpts = parsed.waypoints.map((w) => ({
    name: w.name.slice(0, 240),
    coord: w.coord,
  }));
  // Always preserve track endpoints, even if a file has unrelated waypoints.
  const inner = wpts
    .filter(
      (w) =>
        meters(w.coord, flat[0]) > 30 && meters(w.coord, flat.at(-1)!) > 30,
    )
    .slice(0, 23);
  const points: Point[] = [
    { name: 'Start', coord: flat[0] },
    ...inner,
    { name: 'Destination', coord: flat.at(-1)! },
  ];
  // With no waypoints, place control points where the track shape needs them;
  // original geometry stays intact until edited. Their exact track indices
  // let edits keep unchanged legs without locating points on the track.
  let indices: number[] | undefined;
  if (!inner.length) {
    const stops = trackStops(flat);
    points.splice(0, points.length, ...stops.points);
    indices = stops.indices;
  }
  return {
    route: {
      segments,
      steps: [],
      distance: segments.reduce(
        (sum, s) =>
          sum + s.slice(1).reduce((n, p, i) => n + meters(s[i], p), 0),
        0,
      ),
      duration: null,
      provider: `Imported ${parsed.format}`,
    },
    points,
    // Empty when the file has no name; the interface supplies a localized default.
    name: parsed.name.slice(0, 160),
    ...(indices ? { indices } : {}),
    ...(withElevation >= 0.8 * flat.length
      ? { elevations: elevationRows }
      : {}),
  };
}

export function importGpx(xml: string): ImportedTrack {
  if (xml.length > MAX_IMPORT_BYTES)
    throw new Error('Choose a GPX smaller than 10 MB.');
  const doc = parseXml(xml);
  if (!doc || doc.documentElement.localName !== 'gpx')
    throw new Error('This file is not a valid GPX.');
  return finishImport(parseGpx(doc));
}

/**
 * Reads a GPX, TCX or FIT file, detected by content rather than extension:
 * geometry, names, course points, recorded elevation and, per point, the
 * recorded time and sensor values.
 */
export function readTrackFile(input: Uint8Array): ParsedTrack {
  if (input.length > MAX_IMPORT_BYTES)
    throw new Error('Choose a file smaller than 10 MB.');
  const bytes = unpack(input);
  if (isFit(bytes)) {
    const fit = decodeFit(bytes, meters);
    return {
      format: 'FIT',
      ...fit,
      recorded: fit.recorded.map((segment) =>
        segment.map((r) => ({ time: r.time, values: channelValues(r.values) })),
      ),
    };
  }
  // Like File.text(): UTF-8, with invalid bytes replaced. Some exported TCX
  // files start with spaces before the XML declaration, which XML rejects.
  const doc = parseXml(new TextDecoder().decode(bytes).trimStart());
  const root = doc?.documentElement.localName;
  if (doc && root === 'gpx') return parseGpx(doc);
  if (doc && root === 'TrainingCenterDatabase') return parseTcx(doc);
  throw new Error('This file is not a valid GPX, TCX or FIT file.');
}

/**
 * Imports a file as a route: only geometry, names, course points and
 * recorded elevation are kept; times and sensor values are dropped.
 */
export function importTrackFile(input: Uint8Array): ImportedTrack {
  return importParsed(readTrackFile(input));
}
/** A file already read, imported as a route (see `importTrackFile`). */
export const importParsed = (parsed: ParsedTrack): ImportedTrack =>
  finishImport(parsed);

const TRACK_FILE = /\.(gpx|fit|tcx)$/i;

/**
 * Exports often come compressed: Strava's original files as `.fit.gz` or
 * `.gpx.gz`, Garmin Connect as a `.zip` with one file. Unpacks one level,
 * bounded to the same 10 MB as an uncompressed file.
 */
function unpack(bytes: Uint8Array): Uint8Array {
  const tooLarge = () => new Error('Choose a file smaller than 10 MB.');
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    // The gzip trailer holds the uncompressed size (modulo 4 GiB).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    if (
      bytes.length < 18 ||
      view.getUint32(bytes.length - 4, true) > MAX_IMPORT_BYTES
    )
      throw tooLarge();
    let out: Uint8Array;
    try {
      out = gunzipSync(bytes);
    } catch {
      throw new Error('This file is not a valid GPX, TCX or FIT file.');
    }
    if (out.length > MAX_IMPORT_BYTES) throw tooLarge();
    return out;
  }
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    let found = false;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, {
        // Only the first track file, and only when its stated size fits.
        filter: (file) => {
          // Skips macOS metadata entries (`__MACOSX/`, `._name`).
          if (
            found ||
            !TRACK_FILE.test(file.name) ||
            /(^|\/)(__MACOSX\/|\._)/.test(file.name)
          )
            return false;
          if (file.originalSize > MAX_IMPORT_BYTES) throw tooLarge();
          return (found = true);
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('10 MB'))
        throw error;
      throw new Error('This file is not a valid GPX, TCX or FIT file.', {
        cause: error,
      });
    }
    const out = Object.values(files)[0];
    if (!out) throw new Error('This ZIP has no GPX, TCX or FIT file.');
    if (out.length > MAX_IMPORT_BYTES) throw tooLarge();
    return out;
  }
  return bytes;
}

/** True for the provider label of an imported file, possibly with rerouted parts. */
export const importedProvider = (provider: string): string | null =>
  /^Imported (GPX|TCX|FIT)(?= \+ |$)/.exec(provider)?.[0] ?? null;
