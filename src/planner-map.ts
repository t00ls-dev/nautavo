import type {
  GeoJSONSource,
  LayerSpecification,
  Map as GLMap,
  MapOptions,
  Marker as GLMarker,
  StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { Coord } from './core';
import { refetchTilesOnline } from './basemap';
import { optionalById } from './dom';

/**
 * The planner map (#133): one MapLibre map, created after the first painted
 * frame, when MapLibre has loaded. Until then the view is kept here, so the
 * rest of the app can move it, add markers and overlays at any time; they
 * are drawn once the map exists. Without WebGL it is never created and the
 * panel works on its own.
 *
 * Zoom levels are MapLibre's (512 px tiles), one less than the 256 px levels
 * of the former Leaflet map.
 */

export interface Pixel {
  x: number;
  y: number;
}
const lngLat = (c: Coord): [number, number] => [c[1], c[0]];
export const toCoord = (ll: { lat: number; lng: number }): Coord => [
  ll.lat,
  ll.lng,
];

const MIN_ZOOM = 0;
const MAX_ZOOM = 18;
/** Pixels a marker moves under the pointer before it is dragged. */
const DRAG_THRESHOLD = 3;
/** Web Mercator world width in pixels at zoom 0 (MapLibre's tile size). */
const TILE = 512;

/** Bounds of coordinates as [[west, south], [east, north]]. */
function boundsOf(
  coords: Coord[],
): [[number, number], [number, number]] | null {
  if (!coords.length) return null;
  let south = 90,
    north = -90,
    west = 180,
    east = -180;
  for (const [lat, lon] of coords) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** Meters per screen pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** zoom);
}

/** Pixels from each edge of a box. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
/** A box in page pixels, as `getBoundingClientRect` gives it. */
type Box = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;
const EDGES = ['top', 'right', 'bottom', 'left'] as const;
/** The larger of two insets on each side. */
export const widestInsets = (a: Insets, b: Insets): Insets => ({
  top: Math.max(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
  left: Math.max(a.left, b.left),
});
export const sameInsets = (a: Insets, b: Insets): boolean =>
  EDGES.every((edge) => a[edge] === b[edge]);

/**
 * The insets of `map` that keep clear of the boxes drawn over it (the bottom
 * sheet, the header, the map tools): larger boxes first, each is avoided
 * from the edge that takes the least extra share of the map, so a box beside
 * one already avoided reuses that edge.
 */
export function clearInsets(map: Box, covers: Box[]): Insets {
  const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const width = map.right - map.left,
    height = map.bottom - map.top;
  const inside = covers
    .map((c) => ({
      top: Math.max(c.top, map.top),
      right: Math.min(c.right, map.right),
      bottom: Math.min(c.bottom, map.bottom),
      left: Math.max(c.left, map.left),
    }))
    .filter((c) => c.right > c.left && c.bottom > c.top)
    .sort(
      (a, b) =>
        (b.right - b.left) * (b.bottom - b.top) -
        (a.right - a.left) * (a.bottom - a.top),
    );
  for (const c of inside) {
    const needs: Insets = {
      top: c.bottom - map.top,
      right: map.right - c.left,
      bottom: map.bottom - c.top,
      left: c.right - map.left,
    };
    const cost = (edge: keyof Insets) =>
      Math.max(0, needs[edge] - insets[edge]) /
      (edge === 'top' || edge === 'bottom' ? height : width);
    const edge = EDGES.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    insets[edge] = Math.max(insets[edge], needs[edge]);
  }
  return insets;
}

export interface FitOptions {
  padding?: number | Insets;
  maxZoom?: number;
}

/** One overlay: a GeoJSON source and its layers, drawn above the base map. */
interface Overlay {
  id: string;
  rank: number;
  layers: () => LayerSpecification[];
  data: FeatureCollection;
}

const empty = (): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

export interface MarkerOptions {
  className: string;
  /** Element content: HTML text or a node. */
  html?: string | Node;
  /** Box size in CSS pixels. */
  size: [number, number];
  /** Point of the box on the coordinate, from its top left corner. */
  anchor: [number, number];
  draggable?: boolean;
  /** Focusable and announced as a button, as the former map markers were. */
  interactive?: boolean;
  /** CSS z-index of the marker on the map; higher draws above. */
  z?: number;
  /** Kept whole inside the view when the route is fitted (`markerReach`). */
  framed?: boolean;
  /**
   * How far a framed marker reaches past its coordinate, when its content
   * draws outside its size and anchor (a label placed by CSS).
   */
  reach?: Insets;
  /** Shown while `solo` keeps this group (the activity view, #156). */
  group?: string;
}

/** A DOM marker on the map, kept while the map loads. */
export class MapMarker {
  readonly element: HTMLDivElement;
  private gl: GLMarker | null = null;
  private listeners: ['dragstart' | 'drag' | 'dragend', () => void][] = [];
  constructor(
    private owner: PlannerMap,
    private coord: Coord,
    readonly options: MarkerOptions,
  ) {
    const element = document.createElement('div');
    element.className = options.className;
    const [w, h] = options.size;
    element.style.width = `${w}px`;
    element.style.height = `${h}px`;
    if (options.z !== undefined) element.style.zIndex = String(options.z);
    if (typeof options.html === 'string') element.innerHTML = options.html;
    else if (options.html) element.append(options.html);
    if (options.draggable) this.draggable(element);
    if (options.interactive) {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
    } else element.style.pointerEvents = 'none';
    this.element = element;
  }
  /** Called by the map once it exists. */
  attach(ml: typeof import('maplibre-gl'), map: GLMap) {
    if (this.gl) return;
    const [ax, ay] = this.options.anchor;
    this.gl = new ml.Marker({
      element: this.element,
      anchor: 'top-left',
      offset: [-ax, -ay],

      // Markers stay upright on a turned map.
      rotationAlignment: 'viewport',
      pitchAlignment: 'viewport',
    })
      .setLngLat(lngLat(this.coord))
      .addTo(map);
  }
  /**
   * Dragging with pointer capture, so the drag follows the finger or mouse
   * over the map's controls too and always ends where it is released.
   */
  private draggable(element: HTMLElement) {
    element.classList.add('map-marker-draggable');
    element.style.touchAction = 'none';
    // The map must not pan from a press on the marker.
    for (const type of ['mousedown', 'touchstart'])
      element.addEventListener(type, (event) => event.stopPropagation(), {
        passive: true,
      });
    element.addEventListener('pointerdown', (down) => {
      const map = this.owner.gl();
      if (!map || (down.pointerType === 'mouse' && down.button !== 0)) return;
      const box = this.owner.container.getBoundingClientRect();
      const tip = map.project(lngLat(this.coord));
      // Where the marker was taken, relative to its coordinate.
      const grab = {
        x: down.clientX - box.left - tip.x,
        y: down.clientY - box.top - tip.y,
      };
      let dragging = false;
      element.setPointerCapture(down.pointerId);
      const move = (event: PointerEvent) => {
        if (event.pointerId !== down.pointerId) return;
        if (
          !dragging &&
          Math.hypot(
            event.clientX - down.clientX,
            event.clientY - down.clientY,
          ) < DRAG_THRESHOLD
        )
          return;
        if (!dragging) {
          dragging = true;
          this.fire('dragstart');
        }
        this.setCoord(
          toCoord(
            map.unproject([
              event.clientX - box.left - grab.x,
              event.clientY - box.top - grab.y,
            ]),
          ),
        );
        this.fire('drag');
      };
      const end = (event: PointerEvent) => {
        if (event.pointerId !== down.pointerId) return;
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', end);
        element.removeEventListener('pointercancel', end);
        if (dragging) this.fire('dragend');
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', end);
      element.addEventListener('pointercancel', end);
    });
  }
  private fire(type: 'dragstart' | 'drag' | 'dragend') {
    for (const [name, fn] of this.listeners) if (name === type) fn();
  }
  getCoord(): Coord {
    return this.gl ? toCoord(this.gl.getLngLat()) : this.coord;
  }
  setCoord(coord: Coord) {
    this.coord = coord;
    this.gl?.setLngLat(lngLat(coord));
    return this;
  }
  /** Marker events: dragstart, drag, dragend. */
  on(type: 'dragstart' | 'drag' | 'dragend', fn: () => void) {
    this.listeners.push([type, fn]);
    return this;
  }
  remove() {
    this.gl?.remove();
    this.gl = null;
    this.element.remove();
    this.owner.forget(this);
  }
}

export class PlannerMap {
  readonly container: HTMLElement;
  private map: GLMap | null = null;
  private ml: typeof import('maplibre-gl') | null = null;
  /** The view; `below` px of the map's bottom are covered (the sheet). */
  private view: { center: Coord; zoom: number; below?: number };
  private waiting: ((map: GLMap) => void)[] = [];
  private overlays: Overlay[] = [];
  private images = new Map<string, () => HTMLImageElement | ImageData>();
  private markers = new Set<MapMarker>();
  private framedListeners: (() => void)[] = [];
  private framedPending = false;
  private styleReady = false;
  /** A fit asked before the map existed, done exactly once it does. */
  private pendingFit: { coords: Coord[]; options: FitOptions } | null = null;
  /** While set, only these overlays and marker groups show (`solo`). */
  private soloIds: Set<string> | null = null;

  constructor(container: HTMLElement, center: Coord, zoom: number) {
    this.container = container;
    this.view = { center, zoom };
  }

  /** The MapLibre map, or null before it loads (or without WebGL). */
  gl(): GLMap | null {
    return this.map;
  }
  /** Runs `fn` with the map now, or once it exists. */
  ready(fn: (map: GLMap) => void) {
    if (this.map) fn(this.map);
    else this.waiting.push(fn);
  }
  /** Map events, attached once the map exists. */
  on(type: string, fn: (event: never) => void) {
    this.ready((map) =>
      (map.on as (type: string, fn: () => void) => void)(
        type,
        fn as () => void,
      ),
    );
  }

  create(
    ml: typeof import('maplibre-gl'),
    style: StyleSpecification,
    options: Partial<MapOptions> = {},
  ): GLMap {
    this.ml = ml;
    const map = new ml.Map({
      container: this.container,
      style,
      center: lngLat(this.view.center),
      zoom: this.view.zoom,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      // Two fingers turn the map past MapLibre's rotation threshold, so a
      // pinch with a small twist only zooms; on a desktop, a right or Ctrl
      // drag turns it. It never tilts.
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      boxZoom: false,
      fadeDuration: 0,
      // MapLibre's default 'same-origin' credentials send nothing cross-origin.
      ...options,
    });
    this.map = map;
    map.on('style.load', () => this.restore());
    // Tiles that failed offline are asked again when the connection returns.
    refetchTilesOnline(map);
    for (const marker of this.markers) marker.attach(ml, map);
    if (this.view.below)
      map.panBy([0, this.view.below / 2], { animate: false });
    if (this.pendingFit) {
      const { coords, options } = this.pendingFit;
      this.pendingFit = null;
      this.fit(coords, options);
    }
    const waiting = this.waiting;
    this.waiting = [];
    for (const fn of waiting) fn(map);
    return map;
  }

  /** Changes the base map; overlays are put back once it loads. */
  setStyle(style: StyleSpecification) {
    this.styleReady = false;
    this.map?.setStyle(style, { diff: false });
  }

  /** Re-adds every overlay above the base map, in rank order. */
  private restore() {
    const map = this.map;
    if (!map) return;
    this.styleReady = true;
    // Images the overlays use (direction arrows), before their layers.
    for (const [id, make] of this.images)
      if (!map.hasImage(id)) map.addImage(id, make(), { pixelRatio: 2 });
    for (const overlay of [...this.overlays].sort((a, b) => a.rank - b.rank))
      this.addOverlay(map, overlay);
  }
  private addOverlay(map: GLMap, overlay: Overlay) {
    if (!map.getSource(overlay.id))
      map.addSource(overlay.id, { type: 'geojson', data: overlay.data });
    // Below the first layer of a higher-ranked overlay already drawn.
    const above = this.overlays
      .filter((o) => o.rank > overlay.rank && map.getSource(o.id))
      .sort((a, b) => a.rank - b.rank)
      .flatMap((o) => o.layers().map((l) => l.id))
      .find((id) => map.getLayer(id));
    for (const layer of overlay.layers())
      if (!map.getLayer(layer.id))
        map.addLayer(
          {
            ...layer,
            source: overlay.id,
            ...(this.hidden(overlay.id)
              ? { layout: { ...layer.layout, visibility: 'none' } }
              : {}),
          } as LayerSpecification,
          above,
        );
  }

  /**
   * Registers an overlay drawn from GeoJSON: `layers` (without `source`) is
   * called again after every base-map change, so paint can follow the base
   * map. Returns a setter for its data.
   */
  overlay(
    id: string,
    rank: number,
    layers: () => Omit<LayerSpecification, 'source'>[],
  ): (data: FeatureCollection | Feature[]) => void {
    const overlay: Overlay = {
      id,
      rank,
      layers: layers as () => LayerSpecification[],
      data: empty(),
    };
    this.overlays.push(overlay);
    if (this.map && this.styleReady) this.addOverlay(this.map, overlay);
    return (data) => {
      overlay.data = Array.isArray(data)
        ? { type: 'FeatureCollection', features: data }
        : data;
      const source = this.map?.getSource<GeoJSONSource>(id);
      void source?.setData(overlay.data);
    };
  }
  /** Repaints one overlay's layers (after a base-map change of colors). */
  repaint(id: string) {
    const map = this.map;
    const overlay = this.overlays.find((o) => o.id === id);
    if (!map || !overlay || !this.styleReady) return;
    for (const layer of overlay.layers()) {
      if (!map.getLayer(layer.id)) continue;
      const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
      for (const [key, value] of Object.entries(paint))
        map.setPaintProperty(
          layer.id,
          key as Parameters<GLMap['setPaintProperty']>[1],
          value as Parameters<GLMap['setPaintProperty']>[2],
        );
    }
  }
  /** An image for symbol layers (drawn at 2× pixels), added when a layer needs it. */
  image(id: string, make: () => HTMLImageElement | ImageData) {
    this.images.set(id, make);
    const map = this.map;
    if (map && this.styleReady && !map.hasImage(id))
      map.addImage(id, make(), { pixelRatio: 2 });
  }

  /**
   * Shows only the overlays and marker groups named, hiding the rest without
   * changing their data; null shows everything again. The activity view uses
   * it so the planned route, its points and weather step aside (#156).
   */
  solo(ids: string[] | null) {
    this.soloIds = ids && new Set(ids);
    for (const marker of this.markers) this.showMarker(marker);
    const map = this.map;
    if (map && this.styleReady)
      for (const overlay of this.overlays)
        for (const layer of overlay.layers())
          if (map.getLayer(layer.id))
            map.setLayoutProperty(
              layer.id,
              'visibility',
              this.hidden(overlay.id) ? 'none' : 'visible',
            );
    this.framedChanged();
  }
  private hidden(id: string | undefined): boolean {
    return !!this.soloIds && !(id && this.soloIds.has(id));
  }
  private showMarker(marker: MapMarker) {
    marker.element.classList.toggle(
      'solo-hidden',
      this.hidden(marker.options.group),
    );
  }

  marker(coord: Coord, options: MarkerOptions): MapMarker {
    const marker = new MapMarker(this, coord, options);
    this.markers.add(marker);
    this.showMarker(marker);
    if (this.ml && this.map) marker.attach(this.ml, this.map);
    if (options.framed) this.framedChanged();
    return marker;
  }
  /** @internal */
  forget(marker: MapMarker) {
    this.markers.delete(marker);
    if (marker.options.framed) this.framedChanged();
  }
  /**
   * How far the shown framed markers reach past their coordinate on each
   * side, in pixels: a fit adds it to its padding so they stay whole.
   */
  markerReach(): Insets {
    const reach: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const { options, element } of this.markers) {
      // Hidden by a switch (Weather on the map) once on the page.
      if (!options.framed || (element.isConnected && !element.offsetParent))
        continue;
      const [w, h] = options.size,
        [ax, ay] = options.anchor;
      const own = options.reach ?? {
        top: ay,
        right: w - ax,
        bottom: h - ay,
        left: ax,
      };
      reach.top = Math.max(reach.top, own.top);
      reach.right = Math.max(reach.right, own.right);
      reach.bottom = Math.max(reach.bottom, own.bottom);
      reach.left = Math.max(reach.left, own.left);
    }
    return reach;
  }
  /** Calls `fn` once after framed markers are added or removed. */
  onFramedChange(fn: () => void) {
    this.framedListeners.push(fn);
  }
  private framedChanged() {
    if (this.framedPending) return;
    this.framedPending = true;
    // Markers come and go in batches (a weather render): one call per batch.
    queueMicrotask(() => {
      this.framedPending = false;
      for (const fn of this.framedListeners) fn();
    });
  }

  // The view, kept here while the map loads.
  getCenter(): Coord {
    return this.map ? toCoord(this.map.getCenter()) : this.view.center;
  }
  getZoom(): number {
    return this.map ? this.map.getZoom() : this.view.zoom;
  }
  getBearing(): number {
    return this.map?.getBearing() ?? 0;
  }
  /**
   * Centers `center`; with `below`, in the part of the map above that many
   * pixels at the bottom (a sheet covering the map).
   */
  setView(center: Coord, zoom = this.getZoom(), below = 0) {
    this.pendingFit = null;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.view = { center, zoom, below };
    if (!this.map) return;
    this.map.jumpTo({ center: lngLat(center), zoom });
    if (below) this.map.panBy([0, below / 2], { animate: false });
  }
  panTo(center: Coord) {
    if (this.map) this.map.easeTo({ center: lngLat(center) });
    else {
      this.pendingFit = null;
      this.view = { ...this.view, center, below: 0 };
    }
  }
  stop() {
    this.map?.stop();
  }
  /** Fits coordinates in the view, keeping the map's bearing. */
  fit(coords: Coord[], { padding = 40, maxZoom = MAX_ZOOM }: FitOptions = {}) {
    const bounds = boundsOf(coords);
    if (!bounds) return;
    if (this.map) {
      const camera = this.map.cameraForBounds(bounds, {
        padding,
        maxZoom,
        bearing: this.map.getBearing(),
      });
      if (camera) this.map.jumpTo(camera);
      return;
    }
    // Before the map exists: the bounds' center, at a zoom that fits them,
    // until the map does the exact fit.
    const box = this.container.getBoundingClientRect();
    const pad =
      typeof padding === 'number'
        ? { top: padding, bottom: padding, left: padding, right: padding }
        : padding;
    const width = Math.max(1, box.width - pad.left - pad.right),
      height = Math.max(1, box.height - pad.top - pad.bottom);
    const x = (lon: number) => (lon + 180) / 360,
      y = (lat: number) => {
        const s = Math.sin((lat * Math.PI) / 180);
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
      };
    const [[west, south], [east, north]] = bounds;
    const dx = Math.max(1e-9, x(east) - x(west)),
      dy = Math.max(1e-9, y(south) - y(north));
    const zoom = Math.min(
      maxZoom,
      Math.log2(Math.min(width / dx, height / dy) / TILE),
    );
    this.setView([(south + north) / 2, (west + east) / 2], zoom);
    this.pendingFit = { coords, options: { padding, maxZoom } };
  }
  zoomIn() {
    this.map?.zoomIn();
  }
  zoomOut() {
    this.map?.zoomOut();
  }
  resize() {
    this.map?.resize();
  }
  /** Focuses the map surface (its canvas), for keyboard users. */
  focus() {
    this.map?.getCanvas().focus();
  }
  /** Container pixel of a coordinate (null before the map exists). */
  project(coord: Coord): Pixel | null {
    if (!this.map) return null;
    const p = this.map.project(lngLat(coord));
    return { x: p.x, y: p.y };
  }
  unproject(point: Pixel): Coord | null {
    return this.map ? toCoord(this.map.unproject([point.x, point.y])) : null;
  }
  size(): Pixel {
    return { x: this.container.clientWidth, y: this.container.clientHeight };
  }
}

/** A line feature from [lat, lon] coordinates. */
export function lineFeature(
  coords: Coord[],
  properties: Record<string, unknown> = {},
): Feature<LineString> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: coords.map(lngLat) },
  };
}
/**
 * Draw order of the overlays above the base map, low to high, as the former
 * Leaflet panes: route, coloring, marks, highlighted stretches, cursors.
 */
export const RANK = {
  accuracy: 10,
  route: 20,
  coloring: 30,
  marks: 40,
  highlight: 50,
} as const;

/**
 * Keeps clicks, drags and wheel on a control from reaching the map. Pointer
 * events still bubble, so menus close on a press outside them.
 */
export function isolate(element: HTMLElement) {
  for (const type of [
    'mousedown',
    'touchstart',
    'dblclick',
    'wheel',
    'contextmenu',
    'click',
  ])
    element.addEventListener(type, (event) => event.stopPropagation(), {
      passive: type !== 'contextmenu' && type !== 'click',
    });
}

/** A chosen stretch (climb or unpaved section): wide amber, as before. */
export function highlightLayers(
  id: string,
): Omit<LayerSpecification, 'source'>[] {
  return [
    {
      id,
      type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#be812b', 'line-width': 7, 'line-opacity': 0.85 },
    },
  ];
}

/**
 * A popup above a map point: a box with a tip, kept inside the map by
 * panning it into view when it opens.
 */
export class MapPopup {
  private marker: MapMarker | null = null;
  readonly element: HTMLDivElement;
  private body: HTMLDivElement;
  onClose: () => void = () => {};
  constructor(
    private map: PlannerMap,
    className: string,
  ) {
    this.element = document.createElement('div');
    this.element.className = `map-popup ${className}`;
    this.body = document.createElement('div');
    this.body.className = 'map-popup-content';
    const tip = document.createElement('div');
    tip.className = 'map-popup-tip';
    this.element.append(this.body, tip);
    isolate(this.element);
  }
  get open(): boolean {
    return this.marker !== null;
  }
  setContent(node: Node) {
    this.body.replaceChildren(node);
    // New content may be larger: keep it all in view.
    if (this.marker) requestAnimationFrame(() => this.inView());
  }
  show(coord: Coord) {
    this.marker?.remove();
    this.marker = this.map.marker(coord, {
      className: 'map-popup-anchor',
      html: this.element,
      size: [0, 0],
      anchor: [0, 0],
      interactive: false,
      z: 10,
    });
    this.marker.element.style.pointerEvents = '';
    requestAnimationFrame(() => this.inView());
  }
  /**
   * Pans the map so the whole popup shows, 16 px from the edges and clear of
   * the tool column on the right.
   */
  private inView() {
    const gl = this.map.gl();
    if (!gl || !this.marker) return;
    const box = this.element.getBoundingClientRect(),
      map = this.map.container.getBoundingClientRect();
    const tools = optionalById('map-corner-top-right')?.offsetWidth ?? 0;
    const dx =
      Math.min(0, box.left - map.left - 16) ||
      Math.max(0, box.right - map.right + 16 + tools);
    const dy =
      Math.min(0, box.top - map.top - 16) ||
      Math.max(0, box.bottom - map.bottom + 16);
    if (dx || dy) gl.panBy([dx, dy]);
  }
  close() {
    if (!this.marker) return;
    this.marker.remove();
    this.marker = null;
    this.onClose();
  }
}
