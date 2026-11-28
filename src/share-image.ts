import type { Coord } from './core';
import { icon, type IconName } from './icons';
import type { MapShot } from './share-map';

/**
 * Drawing of the share images (#45) on a canvas: the route as a boarding
 * pass (an invitation with the departure, the weather on the way and the
 * climbs) and a recorded activity with its zones. Every text comes already
 * translated and formatted; every line keeps to one row, shrinking and then
 * shortening with an ellipsis rather than wrapping or overflowing.
 */

export type ShareFormat = 'feed' | 'story';
/** Instagram's feed (4:5) and story (9:16) sizes, pixels. */
export const SHARE_SIZE: Record<ShareFormat, [number, number]> = {
  feed: [1080, 1350],
  story: [1080, 1920],
};
/** A story's top and bottom bands, covered by Instagram's own controls. */
const STORY_SAFE = { top: 250, bottom: 1670 };
/** Map text is drawn this many times larger than on screen. */
export const MAP_SCALE = 2.5;

/**
 * The interface's colors, read from the stylesheet's tokens when an image is
 * drawn (docs/BRAND.md); navy and signal are brand colors without a token,
 * and the plain background stands in for a map that did not load.
 */
const COLOR = {
  primary: '',
  primaryStrong: '',
  text: '',
  muted: '',
  border: '',
  soft: '',
  subtle: '',
  white: '#ffffff',
  navy: '#102a43',
  signal: '#e8603c',
  plain: '#e9ece4',
};
const TOKENS: [keyof typeof COLOR, string][] = [
  ['primary', '--color-primary'],
  ['primaryStrong', '--color-primary-strong'],
  ['text', '--color-text'],
  ['muted', '--color-text-muted'],
  ['border', '--color-border'],
  ['soft', '--color-soft'],
  ['subtle', '--color-subtle'],
];
/** A color token of the stylesheet, such as `--color-speed`. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
function readTokens() {
  for (const [key, name] of TOKENS) COLOR[key] = token(name);
}
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** The brand mark and wordmark, loaded once as images. */
export interface Brand {
  mark: HTMLImageElement;
  wordmark: HTMLImageElement;
}

interface Place {
  label: string;
  time: string;
  /** The point's name, or null when it is hidden or only generated. */
  place: string | null;
}
export interface InviteImage {
  /** "INVITE": the small label above the title. */
  kicker: string;
  title: string;
  date: string | null;
  depart: Place | null;
  arrive: Place | null;
  /** Distance, ascent (with a loaded profile) and travel time, as cards. */
  stats: { icon: IconName; label: string; value: string }[];
  weather: {
    title: string;
    summary: string;
    strip: { time: string; icon: IconName; temperature: string }[];
  } | null;
  climbs: {
    title: string;
    /** Along-track meters and elevation; `gap` starts a new GPX segment. */
    profile: { at: number; ele: number; gap?: boolean }[];
    marks: { start: number; end: number; text: string }[];
  } | null;
  footer: string;
  track: Coord[][];
  /** Route points shown on the map, numbered from 1, or none. */
  points: Coord[];
  credit: string;
}

export interface ActivityImage {
  title: string;
  date: string;
  stats: { icon: IconName; label: string; value: string }[];
  values: { icon: IconName; label: string; value: string }[];
  /** Time in each zone: speed, then heart rate, cadence and power when recorded. */
  zones: {
    title: string;
    note: string;
    colors: string[];
    shares: number[];
    labels: string[];
  }[];
  /** The track in pieces of one color each. */
  pieces: { coords: Coord[]; color: string }[];
  peaks: { coord: Coord; icon: IconName; text: string; color: string }[];
  footer: string;
  credit: string;
}

const font = (size: number, weight = 400) =>
  `${weight} ${Math.round(size)}px ${FONT}`;

/**
 * Sets the font at `size`, or smaller down to 60 % so the text fits
 * `width`; still too wide, the text loses its end to an ellipsis. Returns
 * the text to draw.
 */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  size: number,
  weight = 400,
): string {
  for (let s = size; s >= size * 0.6; s -= 1) {
    ctx.font = font(s, weight);
    if (ctx.measureText(text).width <= width) return text;
  }
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function line(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  options: { weight?: number; color?: string; align?: CanvasTextAlign } = {},
) {
  const shown = fit(ctx, text, width, size, options.weight);
  ctx.fillStyle = options.color ?? COLOR.text;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(shown, x, y);
}

/** Letter-spaced capitals, as the section labels of the pass. */
function kicker(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
) {
  ctx.font = font(size, 700);
  ctx.fillStyle = COLOR.primaryStrong;
  ctx.textAlign = 'left';
  let at = x;
  for (const ch of text.toUpperCase()) {
    ctx.fillText(ch, at, y);
    at += ctx.measureText(ch).width + size * 0.14;
  }
}

/**
 * A value with its unit smaller beside it ("62,8 km"), on one line within
 * `width`; the unit is what follows the no-break space of `withUnit`.
 */
function value(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  align: 'left' | 'right' | 'center' = 'left',
  color = COLOR.text,
) {
  let s = size;
  const measure = () => measureValue(ctx, text, s);
  let m = measure();
  while (m.n + m.u > width && s > size * 0.6) {
    s -= 1;
    m = measure();
  }
  const total = m.n + m.u;
  const start =
    align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.font = font(s, 700);
  ctx.fillText(m.number, start, y);
  if (m.unit) {
    ctx.font = font(s * 0.55, 600);
    ctx.fillText(` ${m.unit}`, start + m.n, y);
  }
}

/**
 * A value split at the no-break space of `withUnit` into its number and its
 * unit, with the widths `value` draws them at `size` (the unit smaller).
 */
function measureValue(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
) {
  const at = text.lastIndexOf('\u00a0');
  const number = at < 0 ? text : text.slice(0, at),
    unit = at < 0 ? '' : text.slice(at + 1);
  ctx.font = font(size, 700);
  const n = ctx.measureText(number).width;
  ctx.font = font(size * 0.55, 600);
  const u = unit ? ctx.measureText(` ${unit}`).width : 0;
  return { number, unit, n, u };
}

const iconCache = new Map<string, Promise<HTMLImageElement>>();
/** One of the interface's icons as an image, stroked in `color`. */
function iconImage(name: IconName, color: string): Promise<HTMLImageElement> {
  const key = `${name}${color}`;
  let image = iconCache.get(key);
  if (!image) {
    const svg = icon(name);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('stroke', color);
    svg.setAttribute('width', '96');
    svg.setAttribute('height', '96');
    // Filled parts (dots of rain) follow the stroke color too.
    const markup = new XMLSerializer()
      .serializeToString(svg)
      .replaceAll('currentColor', color);
    image = loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
    );
    iconCache.set(key, image);
  }
  return image;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image not loaded: ${src}`));
    image.src = src;
  });
}

/** Loads the icons the image draws, each in its color. */
async function icons(
  wanted: { name: IconName; color: string }[],
): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    wanted.map(async ({ name, color }) => {
      out.set(`${name}${color}`, await iconImage(name, color));
    }),
  );
  return out;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The base map (or a plain background) and the credit in its corner. */
function drawMap(
  ctx: CanvasRenderingContext2D,
  shot: MapShot,
  x: number,
  y: number,
  w: number,
  h: number,
  credit: string,
) {
  ctx.save();
  ctx.translate(x, y);
  if (shot.image) ctx.drawImage(shot.image, 0, 0, w, h);
  else {
    ctx.fillStyle = COLOR.plain;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
  if (!shot.image) return;
  // The credit stays readable: dark text on a light label.
  ctx.font = font(20, 500);
  const tw = ctx.measureText(credit).width;
  roundRect(ctx, x + w - tw - 40, y + h - 44, tw + 24, 32, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = 'left';
  ctx.fillText(credit, x + w - tw - 28, y + h - 21);
}

function strokeTrack(
  ctx: CanvasRenderingContext2D,
  coords: Coord[],
  project: MapShot['project'],
  x: number,
  y: number,
) {
  ctx.beginPath();
  coords.forEach((c, i) => {
    const [px, py] = project(c);
    if (i) ctx.lineTo(x + px, y + py);
    else ctx.moveTo(x + px, y + py);
  });
  ctx.stroke();
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  pieces: { coords: Coord[]; color: string }[],
  project: MapShot['project'],
  x: number,
  y: number,
  width: number,
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLOR.white;
  ctx.lineWidth = width + 9;
  for (const piece of pieces) strokeTrack(ctx, piece.coords, project, x, y);
  ctx.lineWidth = width;
  for (const piece of pieces) {
    ctx.strokeStyle = piece.color;
    strokeTrack(ctx, piece.coords, project, x, y);
  }
}

function pointMarker(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  label: string,
) {
  ctx.beginPath();
  ctx.arc(px, py, 26, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.primary;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLOR.white;
  ctx.stroke();
  ctx.fillStyle = COLOR.white;
  ctx.font = font(label.length > 1 ? 24 : 30, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, px, py + 1);
  ctx.textBaseline = 'alphabetic';
}

/** The elevation profile with its labeled climbs in the signal color. */
function drawProfile(
  ctx: CanvasRenderingContext2D,
  climbs: NonNullable<InviteImage['climbs']>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const { profile, marks } = climbs;
  const total = profile.at(-1)!.at || 1;
  const eles = profile.map((p) => p.ele);
  const low = Math.min(...eles),
    high = Math.max(...eles, low + 1);
  const labelBand = 40;
  const px = (at: number) => x + (at / total) * w;
  const py = (ele: number) =>
    y + labelBand + (1 - (ele - low) / (high - low)) * (h - labelBand - 4);
  const parts: { at: number; ele: number }[][] = [];
  for (const p of profile)
    if (p.gap || !parts.length) parts.push([p]);
    else parts.at(-1)!.push(p);
  for (const part of parts) {
    ctx.beginPath();
    ctx.moveTo(px(part[0].at), y + h);
    for (const p of part) ctx.lineTo(px(p.at), py(p.ele));
    ctx.lineTo(px(part.at(-1)!.at), y + h);
    ctx.closePath();
    ctx.fillStyle = COLOR.soft;
    ctx.fill();
    ctx.beginPath();
    part.forEach((p, i) =>
      i ? ctx.lineTo(px(p.at), py(p.ele)) : ctx.moveTo(px(p.at), py(p.ele)),
    );
    ctx.strokeStyle = COLOR.primary;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  // Each climb: its stretch of the line, thicker, and its label above it;
  // a label that would cross the one before is left out.
  let freeFrom = x;
  for (const mark of marks) {
    const inside = profile.filter(
      (p) => p.at >= mark.start && p.at <= mark.end,
    );
    if (inside.length < 2) continue;
    ctx.beginPath();
    inside.forEach((p, i) =>
      i ? ctx.lineTo(px(p.at), py(p.ele)) : ctx.moveTo(px(p.at), py(p.ele)),
    );
    ctx.strokeStyle = COLOR.signal;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.font = font(24, 700);
    const tw = ctx.measureText(mark.text).width;
    const center = (px(mark.start) + px(mark.end)) / 2;
    const left = Math.max(x, Math.min(x + w - tw, center - tw / 2));
    if (left < freeFrom) continue;
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'left';
    ctx.fillText(mark.text, left, y + 26);
    freeFrom = left + tw + 24;
  }
}

/** One row of the strip of weather samples, each column from its left edge. */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  strip: NonNullable<InviteImage['weather']>['strip'],
  images: Map<string, HTMLImageElement>,
  x: number,
  y: number,
  w: number,
  s: number,
) {
  // One equal column per sample, each centered in its column, so the
  // strip is as balanced with two samples as with four.
  const col = w / strip.length;
  strip.forEach((sample, i) => {
    const mid = x + (i + 0.5) * col;
    line(ctx, sample.time, mid, y + 24 * s, col - 12, 24 * s, {
      color: COLOR.muted,
      align: 'center',
    });
    const image = images.get(`${sample.icon}${COLOR.primary}`);
    if (image) ctx.drawImage(image, mid - 24 * s, y + 36 * s, 48 * s, 48 * s);
    value(
      ctx,
      sample.temperature,
      mid,
      y + 116 * s,
      col - 12,
      30 * s,
      'center',
    );
  });
}

/** Heights of the parts of the pass below the map, before scaling. */
const PASS = {
  pad: 48,
  top: 40,
  header: 160,
  noDate: 116,
  times: 150,
  tear: 84,
  weather: 250,
  climbs: 220,
  footer: 76,
  bottom: 40,
  mapMin: 220,
  mapMax: 560,
};

/** Draws the boarding pass of a route (#45). */
export async function drawInvite(
  ctx: CanvasRenderingContext2D,
  data: InviteImage,
  format: ShareFormat,
  map: (width: number, height: number) => Promise<MapShot>,
  brand: Brand,
): Promise<void> {
  readTokens();
  const [W, H] = SHARE_SIZE[format];
  const s = format === 'story' ? 1 : 0.86;
  const area =
    format === 'story'
      ? { top: STORY_SAFE.top, bottom: STORY_SAFE.bottom }
      : { top: 40, bottom: H - 40 };
  const tx = 64,
    tw = W - 2 * tx,
    pad = PASS.pad,
    inner = tw - 2 * pad;
  const body =
    (PASS.top +
      (data.date ? PASS.header : PASS.noDate) +
      (data.depart ? PASS.times + CARD.gap : 0) +
      CARD.value +
      (data.weather || data.climbs ? PASS.tear : 0) +
      (data.weather ? PASS.weather + CARD.gap : 0) +
      (data.climbs ? PASS.climbs + CARD.gap : 0) +
      PASS.footer +
      PASS.bottom) *
    s;
  const room = area.bottom - area.top;
  const mapH = Math.round(
    Math.max(PASS.mapMin, Math.min(PASS.mapMax, room - body)),
  );
  const th = Math.min(room, mapH + body);
  const ty = Math.round(area.top + (room - th) / 2);

  ctx.fillStyle = COLOR.navy;
  ctx.fillRect(0, 0, W, H);
  // The pass and its shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, tx, ty, tw, th, 40);
  ctx.fillStyle = COLOR.white;
  ctx.fill();
  ctx.restore();

  const wanted = [
    ...(data.weather?.strip ?? []),
    ...data.stats,
    { icon: 'right' as IconName },
  ].map((w) => ({ name: w.icon, color: COLOR.primary }));
  const [shot, images] = await Promise.all([map(tw, mapH), icons(wanted)]);
  ctx.save();
  roundRect(ctx, tx, ty, tw, mapH, [40, 40, 0, 0]);
  ctx.clip();
  drawMap(ctx, shot, tx, ty, tw, mapH, data.credit);
  drawTrack(
    ctx,
    data.track.map((coords) => ({ coords, color: COLOR.primary })),
    shot.project,
    tx,
    ty,
    11,
  );
  data.points.forEach((point, i) => {
    const [px, py] = shot.project(point);
    pointMarker(ctx, tx + px, ty + py, String(i + 1));
  });
  ctx.restore();

  const x = tx + pad;
  let y = ty + mapH + PASS.top * s;
  kicker(ctx, data.kicker, x, y + 22 * s, 24 * s);
  y += 34 * s;
  line(ctx, data.title, x, y + 58 * s, inner, 60 * s, { weight: 700 });
  y += 70 * s;
  if (data.date) {
    line(ctx, data.date, x, y + 36 * s, inner, 34 * s);
    y += PASS.header * s - 104 * s;
  } else y += PASS.noDate * s - 104 * s;

  // Departure and arrival in two cards joined by an arrow, then the
  // distance, ascent and travel time in a row of cards that fills the width.
  const gap = CARD.gap * s;
  if (data.depart) {
    const half = (inner - gap) / 2,
      h = PASS.times * s;
    const placeCard = (place: Place, cx: number) => {
      card(ctx, cx, y, half, h, s);
      const mid = cx + half / 2,
        room = half - 2 * CARD.pad * s;
      line(ctx, place.label, mid, y + 38 * s, room, 24 * s, {
        color: COLOR.muted,
        align: 'center',
      });
      value(ctx, place.time, mid, y + 98 * s, room, 60 * s, 'center');
      if (place.place)
        line(ctx, place.place, mid, y + 130 * s, room, 24 * s, {
          weight: 700,
          align: 'center',
        });
    };
    placeCard(data.depart, x);
    if (data.arrive) placeCard(data.arrive, x + half + gap);
    // The arrow on a white disc over the gap between the cards.
    const cx = x + inner / 2,
      cy = y + h / 2,
      r = 26 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.white;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLOR.border;
    ctx.stroke();
    const arrow = images.get(`right${COLOR.primary}`);
    if (arrow) ctx.drawImage(arrow, cx - 16 * s, cy - 16 * s, 32 * s, 32 * s);
    y += h + gap;
  }
  {
    const n = data.stats.length,
      w = (inner - (n - 1) * gap) / n;
    data.stats.forEach((item, i) =>
      valueCard(ctx, item, images, x + i * (w + gap), y, w, CARD.value * s, s, {
        label: 22,
        value: 34,
      }),
    );
    y += CARD.value * s;
  }

  if (data.weather || data.climbs) {
    // The tear line with the pass's notches at its ends.
    const ly = y + PASS.tear * s * 0.45;
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(tx + 30, ly);
    ctx.lineTo(tx + tw - 30, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLOR.navy;
    for (const nx of [tx, tx + tw]) {
      ctx.beginPath();
      ctx.arc(nx, ly, 28, 0, Math.PI * 2);
      ctx.fill();
    }
    y += PASS.tear * s;
  }
  // The weather and the climbs, each in a card of the full width.
  const cardPad = 24 * s;
  if (data.weather) {
    const h = PASS.weather * s;
    card(ctx, x, y, inner, h, s);
    const cx = x + cardPad,
      cw = inner - 2 * cardPad;
    kicker(ctx, data.weather.title, cx, y + 44 * s, 24 * s);
    line(ctx, data.weather.summary, cx, y + 90 * s, cw, 30 * s, {
      weight: 700,
    });
    drawStrip(ctx, data.weather.strip, images, cx, y + 104 * s, cw, s);
    y += h + gap;
  }
  if (data.climbs) {
    const h = PASS.climbs * s;
    card(ctx, x, y, inner, h, s);
    const cx = x + cardPad,
      cw = inner - 2 * cardPad;
    kicker(ctx, data.climbs.title, cx, y + 44 * s, 24 * s);
    drawProfile(ctx, data.climbs, cx, y + 56 * s, cw, 140 * s);
    y += h + gap;
  }
  // Footer: the brand and the site's address.
  const fy = Math.max(y, ty + th - (PASS.footer + PASS.bottom) * s);
  const markSize = 52 * s;
  ctx.drawImage(brand.mark, x, fy + 6 * s, markSize, markSize);
  const wmH = 30 * s;
  ctx.drawImage(
    brand.wordmark,
    x + markSize + 12 * s,
    fy + 6 * s + (markSize - wmH) / 2,
    (brand.wordmark.naturalWidth / brand.wordmark.naturalHeight) * wmH,
    wmH,
  );
  line(ctx, data.footer, x + inner, fy + 42 * s, inner / 2, 26 * s, {
    weight: 700,
    color: COLOR.primaryStrong,
    align: 'right',
  });
}

/** A label on the map for a peak, beside its point and inside `box`. */
function placePill(
  ctx: CanvasRenderingContext2D,
  peak: ActivityImage['peaks'][number],
  at: [number, number],
  images: Map<string, HTMLImageElement>,
  box: { x: number; y: number; w: number; h: number },
  taken: { x: number; y: number; w: number; h: number }[],
) {
  ctx.font = font(28, 700);
  const w = ctx.measureText(peak.text).width + 84,
    h = 54;
  const [px, py] = at;
  const options = [
    { x: px - w / 2, y: py - h - 22 },
    { x: px - w / 2, y: py + 22 },
    { x: px + 24, y: py - h / 2 },
    { x: px - w - 24, y: py - h / 2 },
  ];
  const overlaps = (r: { x: number; y: number }) =>
    taken.some(
      (t) =>
        r.x < t.x + t.w && r.x + w > t.x && r.y < t.y + t.h && r.y + h > t.y,
    );
  const inside = (r: { x: number; y: number }) =>
    r.x >= box.x &&
    r.y >= box.y &&
    r.x + w <= box.x + box.w &&
    r.y + h <= box.y + box.h;
  const spot = options.find((r) => inside(r) && !overlaps(r));
  // The point itself, a ring in the peak's color.
  ctx.beginPath();
  ctx.arc(px, py, 13, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.white;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = peak.color;
  ctx.stroke();
  if (!spot) return;
  taken.push({ ...spot, w, h });
  roundRect(ctx, spot.x, spot.y, w, h, 14);
  ctx.fillStyle = COLOR.white;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = peak.color;
  ctx.stroke();
  const image = images.get(`${peak.icon}${peak.color}`);
  if (image) ctx.drawImage(image, spot.x + 16, spot.y + 11, 32, 32);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = 'left';
  ctx.fillText(peak.text, spot.x + 60, spot.y + 37);
}

/**
 * The cards below the activity's map, before scaling: each value and each
 * zone bar in its own card, on one grid of three columns.
 */
const CARD = { gap: 14, pad: 20, radius: 20, stat: 124, value: 96, zone: 142 };

function card(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
) {
  roundRect(ctx, x, y, w, h, CARD.radius * s);
  ctx.fillStyle = COLOR.subtle;
  ctx.fill();
}

/** A card with an icon, a label and a value, the icon centered on its left. */
function valueCard(
  ctx: CanvasRenderingContext2D,
  item: { icon: IconName; label: string; value: string },
  images: Map<string, HTMLImageElement>,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  sizes: { label: number; value: number },
) {
  card(ctx, x, y, w, h, s);
  const pad = CARD.pad * s,
    size = 40 * s,
    space = 14 * s;
  // The icon and its text sit together in the middle of the card, so a
  // card that fills a row alone stays as balanced as a third of one.
  ctx.font = font(sizes.label * s, 400);
  const labelW = ctx.measureText(item.label).width;
  const measured = measureValue(ctx, item.value, sizes.value * s);
  const valueW = measured.n + measured.u;
  const group = size + space + Math.max(labelW, valueW);
  const left = x + Math.max(pad, (w - group) / 2);
  const image = images.get(`${item.icon}${COLOR.primary}`);
  if (image) ctx.drawImage(image, left, y + (h - size) / 2, size, size);
  const tx = left + size + space,
    tw = x + w - pad - tx;
  // Label and value centered together in the card's height.
  const block = (sizes.label + 8 + sizes.value) * s;
  const top = y + (h - block) / 2;
  line(ctx, item.label, tx, top + sizes.label * s * 0.8, tw, sizes.label * s, {
    color: COLOR.muted,
  });
  value(
    ctx,
    item.value,
    tx,
    top + block - sizes.value * s * 0.12,
    tw,
    sizes.value * s,
  );
}

/** One card of the time in each zone: title, bar and the zones' ranges. */
function zoneCard(
  ctx: CanvasRenderingContext2D,
  z: ActivityImage['zones'][number],
  x: number,
  y: number,
  w: number,
  s: number,
) {
  card(ctx, x, y, w, CARD.zone * s, s);
  const px = x + CARD.pad * s,
    pw = w - 2 * CARD.pad * s;
  kicker(ctx, z.title, px, y + 42 * s, 24 * s);
  line(ctx, z.note, px + pw, y + 42 * s, pw / 2, 22 * s, {
    color: COLOR.muted,
    align: 'right',
  });
  const by = y + 56 * s,
    bh = 44 * s;
  ctx.save();
  roundRect(ctx, px, by, pw, bh, 10 * s);
  ctx.clip();
  let bx = px;
  z.shares.forEach((share, i) => {
    const bw = (pw * share) / 100;
    ctx.fillStyle = z.colors[i];
    ctx.fillRect(bx, by, bw + 1, bh);
    ctx.font = font(24 * s, 700);
    const label = `${share}%`;
    if (share && ctx.measureText(label).width + 12 < bw) {
      ctx.fillStyle = COLOR.white;
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 9 * s);
    }
    bx += bw;
  });
  ctx.restore();
  // The range of each zone under it, when it fits.
  bx = px;
  z.shares.forEach((share, i) => {
    const bw = (pw * share) / 100;
    ctx.font = font(22 * s, 400);
    if (share && ctx.measureText(z.labels[i]).width + 8 < bw) {
      ctx.fillStyle = COLOR.muted;
      ctx.textAlign = 'center';
      ctx.fillText(z.labels[i], bx + bw / 2, by + bh + 26 * s);
    }
    bx += bw;
  });
}

/** Draws a recorded activity with its zones and peaks (#45). */
export async function drawActivity(
  ctx: CanvasRenderingContext2D,
  data: ActivityImage,
  format: ShareFormat,
  map: (
    width: number,
    height: number,
    pad: { top: number; side: number; bottom: number },
  ) => Promise<MapShot>,
  brand: Brand,
): Promise<void> {
  readTokens();
  const [W, H] = SHARE_SIZE[format];
  const story = format === 'story';
  const s = story ? 1 : 0.88;
  // The map takes what the numbers and the zone bars leave free.
  const below =
    24 * s +
    CARD.stat * s +
    (data.values.length ? (CARD.gap + CARD.value) * s : 0) +
    data.zones.length * (CARD.gap + CARD.zone) * s +
    (story ? 60 : 90);
  // Fewer values chosen give the map more room, never a blank band.
  const mapH = Math.round(
    Math.max(story ? 600 : 440, (story ? STORY_SAFE.bottom : H) - below),
  );
  const headerY = story ? STORY_SAFE.top + 10 : 20,
    headerH = Math.round(118 * s);
  // The track keeps clear of the title card at the top of the map.
  const top = (headerY + headerH + 90) / MAP_SCALE;
  const [shot, images] = await Promise.all([
    map(W, mapH, { top, side: 60 / MAP_SCALE, bottom: 70 / MAP_SCALE }),
    icons([
      ...data.peaks.map((p) => ({ name: p.icon, color: p.color })),
      ...[...data.stats, ...data.values].map((v) => ({
        name: v.icon,
        color: COLOR.primary,
      })),
    ]),
  ]);
  ctx.fillStyle = COLOR.white;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, mapH);
  ctx.clip();
  drawMap(ctx, shot, 0, 0, W, mapH, data.credit);
  drawTrack(ctx, data.pieces, shot.project, 0, 0, 14);
  // Labels keep clear of the title card and of every peak's point.
  const taken = [
    { x: 0, y: 0, w: W, h: headerY + headerH + 8 },
    ...data.peaks.map((peak) => {
      const [x, y] = shot.project(peak.coord);
      return { x: x - 22, y: y - 22, w: 44, h: 44 };
    }),
  ];
  for (const peak of data.peaks)
    placePill(
      ctx,
      peak,
      shot.project(peak.coord),
      images,
      {
        x: 16,
        y: 0,
        w: W - 32,
        h: mapH - 60,
      },
      taken,
    );
  ctx.restore();

  // Title card over the map.
  const hx = story ? 48 : 32,
    hw = W - 2 * hx;
  ctx.save();
  ctx.shadowColor = 'rgba(27,41,52,0.2)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, hx, headerY, hw, headerH, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.restore();
  const markSize = 64 * s;
  ctx.drawImage(
    brand.mark,
    hx + hw - markSize - 24 * s,
    headerY + (headerH - markSize) / 2,
    markSize,
    markSize,
  );
  const textW = hw - markSize - 72 * s;
  line(ctx, data.title, hx + 24 * s, headerY + 58 * s, textW, 44 * s, {
    weight: 700,
  });
  line(ctx, data.date, hx + 24 * s, headerY + 96 * s, textW, 24 * s, {
    color: COLOR.muted,
  });

  // Below the map, everything in cards of one width: the main numbers in
  // a row of three, the other values in a row that always fills the width
  // (one, two or three cards), then one card per zone bar.
  const px = story ? 56 : 48,
    pw = W - 2 * px;
  const gap = CARD.gap * s;
  const row = (
    items: { icon: IconName; label: string; value: string }[],
    top: number,
    height: number,
    sizes: { label: number; value: number },
  ) => {
    const w = (pw - (items.length - 1) * gap) / items.length;
    items.forEach((item, i) =>
      valueCard(
        ctx,
        item,
        images,
        px + i * (w + gap),
        top,
        w,
        height,
        s,
        sizes,
      ),
    );
  };
  let y = mapH + 24 * s;
  row(data.stats, y, CARD.stat * s, { label: 24, value: 48 });
  y += CARD.stat * s;
  if (data.values.length) {
    y += gap;
    row(data.values, y, CARD.value * s, { label: 22, value: 34 });
    y += CARD.value * s;
  }
  for (const z of data.zones) {
    y += gap;
    zoneCard(ctx, z, px, y, pw, s);
    y += CARD.zone * s;
  }
  const footerY = story ? STORY_SAFE.bottom - 10 : H - 32;
  line(ctx, data.footer, px + pw, footerY, pw / 2, 26 * s, {
    weight: 700,
    color: COLOR.primaryStrong,
    align: 'right',
  });
}
