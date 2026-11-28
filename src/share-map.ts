import { basemapStyle, fetchStyle, STYLE_URL } from './basemap';
import type { Coord } from './core';
import { loadMapLibre } from './maplibre-loader';

/**
 * The map of a share image (#45): the Standard base map framed on a track,
 * drawn once by a hidden MapLibre map of the image's size and copied to a
 * canvas, and the projection that places the track on it. Only the tiles of
 * that view are asked for, on the explicit choice to make the image; nothing
 * is kept. Without the style (offline) there is no picture and the image draws
 * the track over a plain background with the same projection.
 */

export interface MapShot {
  /** The base map, `width` × `height` pixels, or null when it did not load. */
  image: HTMLCanvasElement | null;
  /** Image pixel of a coordinate. */
  project: (coord: Coord) => [number, number];
}

/** Map tiles are 512 CSS pixels wide in MapLibre. */
const TILE = 512;
/** The highest zoom an image frames a short track at. */
const MAX_ZOOM = 16;
/** How long the base map may take to draw before the image goes without it, ms. */
const LOAD_TIMEOUT = 15_000;

const mercatorX = (lon: number) => (lon + 180) / 360;
const mercatorY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/**
 * The view that fits the coordinates into a `width` × `height` CSS-pixel box
 * with `pad` pixels left free on each side (`pad.top` more where a card sits
 * over the map): Web Mercator center and zoom, as MapLibre computes them.
 */
export function frameView(
  coords: Coord[],
  width: number,
  height: number,
  pad: { top: number; side: number; bottom: number },
): { lon: number; lat: number; zoom: number; x: number; y: number } {
  const xs = coords.map((c) => mercatorX(c[1])),
    ys = coords.map((c) => mercatorY(c[0]));
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const room = {
    w: Math.max(1, width - 2 * pad.side),
    h: Math.max(1, height - pad.top - pad.bottom),
  };
  const zoom = Math.min(
    MAX_ZOOM,
    Math.log2(
      Math.min(
        room.w / TILE / Math.max(maxX - minX, 1e-9),
        room.h / TILE / Math.max(maxY - minY, 1e-9),
      ),
    ),
  );
  const scale = TILE * 2 ** zoom;
  // The track's middle sits in the middle of the free box, which the larger
  // top padding moves down.
  const x = (minX + maxX) / 2,
    y = (minY + maxY) / 2 - (pad.top - pad.bottom) / 2 / scale;
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return { lon, lat, zoom, x, y };
}

/**
 * Draws the base map for `coords` into a `width` × `height` pixel image whose
 * map text reads at `scale` times the screen's size (the image is seen
 * smaller than it is drawn), framed with `pad` CSS pixels.
 */
export async function mapShot(
  coords: Coord[],
  width: number,
  height: number,
  scale: number,
  pad: { top: number; side: number; bottom: number },
): Promise<MapShot> {
  const cssW = width / scale,
    cssH = height / scale;
  const view = frameView(coords, cssW, cssH, pad);
  const worldPx = TILE * 2 ** view.zoom * scale;
  const project = (c: Coord): [number, number] => [
    (mercatorX(c[1]) - view.x) * worldPx + width / 2,
    (mercatorY(c[0]) - view.y) * worldPx + height / 2,
  ];
  const [ml, base] = await Promise.all([
    loadMapLibre().catch(() => null),
    fetchStyle(STYLE_URL),
  ]);
  if (!ml || !base) return { image: null, project };
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:fixed;left:-${cssW + 100}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none`;
  document.body.append(box);
  let map: import('maplibre-gl').Map | null = null;
  try {
    map = new ml.Map({
      container: box,
      style: basemapStyle(base, 'standard'),
      center: [view.lon, view.lat],
      zoom: view.zoom,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: scale,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      // MapLibre's default 'same-origin' credentials send nothing cross-origin.
    });
    const drawn = map;
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), LOAD_TIMEOUT);
      drawn.once('idle', () => {
        clearTimeout(timer);
        resolve(true);
      });
      drawn.on('error', () => undefined);
    });
    if (!loaded && !drawn.isStyleLoaded()) return { image: null, project };
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    image.getContext('2d')!.drawImage(drawn.getCanvas(), 0, 0, width, height);
    return { image, project };
  } catch {
    return { image: null, project };
  } finally {
    map?.remove();
    box.remove();
  }
}
