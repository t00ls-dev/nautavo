import type {
  LayerSpecification,
  Map as GLMap,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';

/**
 * One vector base map for the planner and the navigation map: OpenFreeMap's
 * public style, with topographic shading and contours or satellite imagery
 * composed on the device. No source needs an account or key.
 */
export type BaseLayer = 'standard' | 'topographic' | 'satellite';
export type SatelliteVintage = '2016' | '2025';

export interface MapCredit {
  text: string;
  url: string;
}

/** OpenFreeMap's public vector style (#140). */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
/** Terrain Tiles on the Registry of Open Data on AWS (Terrarium encoding). */
export const TERRAIN_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
/** Highest zoom the terrain tiles hold; beyond it they are enlarged. */
export const TERRAIN_MAXZOOM = 15;
/** EOxCloudless imagery is published up to zoom 14 (about 10 m). */
const SATELLITE_MAXZOOM = 14;
const eox = 'https://tiles.maps.eox.at/wmts/1.0.0/';

export function satelliteUrl(vintage: SatelliteVintage): string {
  const id = vintage === '2016' ? 's2cloudless_3857' : 's2cloudless-2025_3857';
  return `${eox}${id}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`;
}

/** Without the style, the route and markers draw on this background. */
export const NEUTRAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e9ece9' },
    },
  ],
};

/** Credits of the vector map itself, shown on both maps. */
export const vectorCredits: MapCredit[] = [
  { text: 'MapLibre GL JS', url: 'https://maplibre.org/' },
  { text: 'OpenFreeMap', url: 'https://openfreemap.org/' },
  { text: '© OpenMapTiles', url: 'https://www.openmaptiles.org/' },
  {
    text: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
  },
];
const terrainCredits: MapCredit[] = [
  {
    text: 'Terrain Tiles by Mapzen on AWS Open Data',
    url: 'https://registry.opendata.aws/terrain-tiles/',
  },
  {
    text: 'Elevation sources: SRTM, GMTED2010, ETOPO1 and others',
    url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
];

export function mapCredits(
  layer: BaseLayer,
  vintage: SatelliteVintage = '2025',
): MapCredit[] {
  if (layer === 'standard') return [...vectorCredits];
  if (layer === 'topographic') return [...vectorCredits, ...terrainCredits];
  const imagery: MapCredit[] = [
    {
      text: 'EOxCloudless by EOX IT Services GmbH',
      url: 'https://cloudless.eox.at/',
    },
    {
      // The attribution EOX requires for each edition.
      text: `Contains modified Copernicus Sentinel data ${vintage === '2016' ? '2016 & 2017' : '2025'}`,
      url: 'https://cloudless.eox.at/',
    },
    {
      text: `CC ${vintage === '2016' ? 'BY' : 'BY-NC-SA'} 4.0`,
      url: `https://creativecommons.org/licenses/${vintage === '2016' ? 'by' : 'by-nc-sa'}/4.0/`,
    },
  ];
  // Satellite always draws the vector map's labels over the imagery.
  return [...vectorCredits, ...imagery];
}

/** Labels use the local name (what street signs show) instead of English. */
export function localNames(style: StyleSpecification): StyleSpecification {
  for (const layer of style.layers) {
    if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
    if (JSON.stringify(layer.layout['text-field']).includes('"name'))
      layer.layout['text-field'] = [
        'coalesce',
        ['get', 'name'],
        ['get', 'name:latin'],
      ];
  }
  return style;
}

/** Source layers drawn above the terrain shading and contours. */
const ABOVE_TERRAIN = new Set([
  'aeroway',
  'boundary',
  'building',
  'transportation',
  'transportation_name',
]);

/** Where terrain goes: under roads, buildings and every label. */
export function terrainIndex(layers: LayerSpecification[]): number {
  const index = layers.findIndex(
    (layer) =>
      layer.type === 'symbol' ||
      ABOVE_TERRAIN.has(
        (layer as { 'source-layer'?: string })['source-layer'] ?? '',
      ),
  );
  return index < 0 ? layers.length : index;
}

export interface TerrainSources {
  /** Raster DEM tile URL (shared with the contour generator's cache). */
  dem: string;
  /** Contour vector tile URL generated on the device from the DEM. */
  contours: string;
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * The planner's style for a layer, from OpenFreeMap's style. Satellite keeps
 * only the base map's labels; topographic adds shading and contours
 * under the roads. The base style is never modified.
 */
export function basemapStyle(
  base: StyleSpecification,
  layer: BaseLayer,
  options: {
    vintage?: SatelliteVintage;
    terrain?: TerrainSources;
  } = {},
): StyleSpecification {
  const style = localNames(clone(base));
  if (layer === 'standard') return style;
  if (layer === 'topographic') {
    if (!options.terrain) return style;
    const sources: Record<string, SourceSpecification> = {
      ...style.sources,
      terrain: {
        type: 'raster-dem',
        tiles: [options.terrain.dem],
        tileSize: 256,
        maxzoom: TERRAIN_MAXZOOM,
        encoding: 'terrarium',
      },
      contours: {
        type: 'vector',
        tiles: [options.terrain.contours],
        maxzoom: TERRAIN_MAXZOOM,
      },
    };
    const terrain: LayerSpecification[] = [
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain',
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': '#473b24',
          'hillshade-highlight-color': '#ffffff',
        },
      },
      {
        id: 'terrain-contours',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        minzoom: 11,
        paint: {
          'line-color': '#9a6b3d',
          'line-opacity': ['match', ['get', 'level'], 1, 0.55, 0.3],
          'line-width': ['match', ['get', 'level'], 1, 1, 0.5],
        },
      },
    ];
    const at = terrainIndex(style.layers);
    return {
      ...style,
      sources,
      layers: [
        ...style.layers.slice(0, at),
        ...terrain,
        ...style.layers.slice(at),
      ],
    };
  }
  const kept = style.layers.filter((item) => item.type === 'symbol');
  const used = new Set(
    kept.map((item) => (item as { source?: string }).source ?? ''),
  );
  const sources: Record<string, SourceSpecification> = Object.fromEntries(
    Object.entries(style.sources).filter(([id]) => used.has(id)),
  );
  sources.satellite = {
    type: 'raster',
    tiles: [satelliteUrl(options.vintage ?? '2025')],
    tileSize: 256,
    maxzoom: SATELLITE_MAXZOOM,
  };
  return {
    ...style,
    sources,
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#1f2a24' },
      },
      { id: 'satellite', type: 'raster', source: 'satellite' },
      ...kept,
    ],
  };
}

const styles = new Map<string, Promise<StyleSpecification | null>>();
/** The OpenFreeMap style, fetched once per page without credentials. */
export function fetchStyle(
  url = STYLE_URL,
): Promise<StyleSpecification | null> {
  let style = styles.get(url);
  if (!style) {
    style = fetch(url, { credentials: 'omit' })
      .then((response) =>
        response.ok ? (response.json() as Promise<StyleSpecification>) : null,
      )
      .catch(() => null);
    // A failed load is asked again next time, not remembered.
    void style.then((value) => {
      if (!value) styles.delete(url);
    });
    styles.set(url, style);
  }
  return style.then((value) => (value ? clone(value) : null));
}

/** A tile's place in the tile pyramid, as MapLibre reloads it. */
interface TileId {
  x: number;
  y: number;
  z: number;
}
/**
 * Asks again, when the connection returns, for the tiles of `map` that
 * failed meanwhile (a map moved while offline stays blank otherwise): one
 * request per failed tile on each `online` event, only for tiles still in
 * view, never in a loop (AGENTS.md); loaded tiles are not asked again.
 * Returns the cleanup for a map that is removed.
 */
export function refetchTilesOnline(map: GLMap): () => void {
  const failed = new Map<string, Map<string, TileId>>();
  // A tile's error carries its source and tile (not in MapLibre's types).
  const onError = (event: object) => {
    const { sourceId: source, tile: errored } = event as {
      sourceId?: string;
      tile?: { tileID?: { canonical?: TileId } };
    };
    const tile = errored?.tileID?.canonical;
    if (!source || !tile) return;
    const tiles = failed.get(source) ?? new Map<string, TileId>();
    tiles.set(`${tile.z}/${tile.x}/${tile.y}`, {
      x: tile.x,
      y: tile.y,
      z: tile.z,
    });
    failed.set(source, tiles);
  };
  const onOnline = () => {
    for (const [source, tiles] of failed)
      // A source the current style no longer has (another map layer).
      if (map.getSource(source)) map.refreshTiles(source, [...tiles.values()]);
    failed.clear();
  };
  map.on('error', onError);
  window.addEventListener('online', onOnline);
  return () => {
    map.off('error', onError);
    window.removeEventListener('online', onOnline);
  };
}

/** WebGL renderers that draw on the CPU, without a GPU. */
const SOFTWARE_RENDERER = /SwiftShader|llvmpipe|softpipe|Software Rasterizer/i;
/**
 * The resolution a map draws at: the screen's, except where WebGL is drawn
 * on the CPU (no GPU, or one the browser blocks), whose every frame costs in
 * proportion to its pixels and blocks the page: one canvas pixel per CSS
 * pixel there, so the map stays responsive (#151). `undefined` is MapLibre's
 * default, the screen's resolution; devices with a GPU never change.
 */
export function mapPixelRatio(): number | undefined {
  softwareWebGL ??= rendersOnCpu();
  return softwareWebGL ? Math.min(1, devicePixelRatio) : undefined;
}
/** The renderer never changes during a page's life: asked once. */
let softwareWebGL: boolean | undefined;
function rendersOnCpu(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = info
      ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return SOFTWARE_RENDERER.test(renderer);
  } catch {
    return false;
  }
}

/** Whether the browser can draw a WebGL map at all. */
export function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
