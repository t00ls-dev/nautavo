import {
  validateState,
  validCoord,
  validRoute,
  type Coord,
  type Route,
  type State,
} from './core';
export interface SavedRoute {
  id: string;
  name: string;
  state: State;
  route: Route;
  createdAt: string;
  updatedAt: string;
  /**
   * Set when adding turn directions was tried and the road had changed, so
   * reopening does not ask the router again. Optional; older entries lack it.
   */
  directionsChecked?: boolean;
}
/** What a favorite is, for its icon and its place in the lists. */
const FAVORITE_KINDS = ['home', 'work', 'place'] as const;
export type FavoriteKind = (typeof FAVORITE_KINDS)[number];
const isKind = (value: unknown): value is FavoriteKind =>
  FAVORITE_KINDS.includes(value as FavoriteKind);
/** A favorite place (#52): a named coordinate kept only on this device. */
export interface Favorite {
  id: string;
  name: string;
  coord: Coord;
  /** Home and work come first; absent means a place. */
  kind?: FavoriteKind;
  /** The place's address as the search gave it, shown under the name. */
  place?: string;
  createdAt: string;
  updatedAt: string;
}
type Store = 'routes' | 'favorites';
/** Longest address kept for a favorite. */
const PLACE_LIMIT = 240;
/** A favorite's address field, absent when there is none. */
const placeOf = (place: string | undefined) =>
  place?.trim() ? { place: place.trim().slice(0, PLACE_LIMIT) } : {};
/** Longest name for a saved route or a favorite. */
const NAME_LIMIT = 160;
const validName = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= NAME_LIMIT;

let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      // Version 2 adds favorites; an upgrade keeps the saved routes.
      const request = indexedDB.open('route-gpx', 2);
      request.onupgradeneeded = () => {
        for (const store of ['routes', 'favorites'] as const)
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Local route storage is blocked by another tab.'));
    }).catch((e) => {
      connection = undefined;
      throw e;
    });
  return connection;
}
async function operation<T>(
  name: Store,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? request.error);
    tx.onerror = () => reject(tx.error ?? request.error);
  });
}
/** Saved routes and favorites are identified by their normalized names. */
export function libraryKey(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('en');
}
/** Deletes an entry and returns it as it was, in one transaction. */
async function take<T>(name: Store, id: string): Promise<T | undefined> {
  const db = await database();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    let taken: T | undefined;
    const read = store.get(id);
    read.onsuccess = () => {
      taken = read.result as T | undefined;
      if (taken) store.delete(id);
    };
    tx.oncomplete = () => resolve(taken);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
/**
 * A deleted entry can come back only to a free name: one saved again
 * meanwhile is never overwritten (#205).
 */
export const canRestore = (existing: unknown): boolean =>
  existing === undefined;
/**
 * Puts a deleted entry back exactly as it was (undo), unless its name was
 * taken meanwhile; says whether it did.
 */
async function putBack(name: Store, record: { id: string }): Promise<boolean> {
  const db = await database();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    let restored = false;
    const read = store.get(record.id);
    read.onsuccess = () => {
      restored = canRestore(read.result);
      if (restored) store.put(record);
    };
    tx.oncomplete = () => resolve(restored);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
export async function listSavedRoutes(): Promise<SavedRoute[]> {
  const rows = await operation<SavedRoute[]>('routes', 'readonly', (s) =>
    s.getAll(),
  );
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveNamedRoute(
  state: State,
  route: Route,
): Promise<SavedRoute> {
  const name = state.name.trim();
  if (!validName(name)) throw new Error('Name your route before saving.');
  const id = libraryKey(name);
  const old = await operation<SavedRoute | undefined>(
    'routes',
    'readonly',
    (s) => s.get(id),
  );
  const now = new Date().toISOString();
  const record: SavedRoute = {
    id,
    name,
    state: structuredClone({ ...state, name }),
    route: structuredClone(route),
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
  await operation('routes', 'readwrite', (s) => s.put(record));
  return record;
}
/**
 * The saved record with `route`'s steps, or null when the stored geometry is
 * not exactly the same. Name, state and dates are kept.
 */
export function withUpdatedSteps(
  record: SavedRoute,
  route: Route,
): SavedRoute | null {
  if (JSON.stringify(record.route.segments) !== JSON.stringify(route.segments))
    return null;
  const updated = { ...record.route, steps: structuredClone(route.steps) };
  return validRoute(updated) ? { ...record, route: updated } : null;
}

/** Stores directions added to a saved route, changing nothing else. */
export async function updateSavedSteps(
  id: string,
  route: Route,
): Promise<void> {
  const record = await operation<SavedRoute | undefined>(
    'routes',
    'readonly',
    (s) => s.get(id),
  );
  const updated = record && withUpdatedSteps(record, route);
  if (updated) await operation('routes', 'readwrite', (s) => s.put(updated));
}

/** Remembers that directions could not be added, changing nothing else. */
export async function markDirectionsChecked(id: string): Promise<void> {
  const record = await operation<SavedRoute | undefined>(
    'routes',
    'readonly',
    (s) => s.get(id),
  );
  if (record)
    await operation('routes', 'readwrite', (s) =>
      s.put({ ...record, directionsChecked: true }),
    );
}

/** Deletes a saved route and returns it, so it can be restored. */
export const deleteSavedRoute = (id: string) => take<SavedRoute>('routes', id);
export const restoreSavedRoute = (record: SavedRoute) =>
  putBack('routes', record);
export async function listFavorites(): Promise<Favorite[]> {
  const rows = await operation<Favorite[]>('favorites', 'readonly', (s) =>
    s.getAll(),
  );
  const rank = (f: Favorite) => FAVORITE_KINDS.indexOf(f.kind ?? 'place');
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
/** Saves a favorite; one with the same name is replaced. */
export async function saveFavorite(
  name: string,
  coord: Coord,
  kind: FavoriteKind = 'place',
  place?: string,
): Promise<Favorite> {
  const clean = name.trim();
  if (!validName(clean)) throw new Error('Name the favorite before saving.');
  if (!validCoord(coord)) throw new Error('Invalid favorite place.');
  const id = libraryKey(clean);
  const old = await operation<Favorite | undefined>(
    'favorites',
    'readonly',
    (s) => s.get(id),
  );
  const now = new Date().toISOString();
  const record: Favorite = {
    id,
    name: clean,
    coord: [coord[0], coord[1]],
    kind,
    ...placeOf(place),
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
  await operation('favorites', 'readwrite', (s) => s.put(record));
  return record;
}
/**
 * Changes a favorite's name, kind or place; refused when the name is taken
 * by another one.
 */
export async function editFavorite(
  id: string,
  name: string,
  kind: FavoriteKind,
  coord: Coord,
  place?: string,
): Promise<void> {
  const clean = name.trim();
  if (!validName(clean)) throw new Error('Name the favorite before saving.');
  if (!validCoord(coord)) throw new Error('Invalid favorite place.');
  const next = libraryKey(clean);
  const [old, taken] = await Promise.all(
    [id, next].map((key) =>
      operation<Favorite | undefined>('favorites', 'readonly', (s) =>
        s.get(key),
      ),
    ),
  );
  if (!old) return;
  if (taken && next !== id)
    throw new Error('A favorite with this name already exists.');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('favorites', 'readwrite');
    const store = tx.objectStore('favorites');
    store.delete(id);
    const record: Favorite = {
      id: next,
      name: clean,
      coord: [coord[0], coord[1]],
      kind,
      ...placeOf(place),
      createdAt: old.createdAt,
      updatedAt: new Date().toISOString(),
    };
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/** Deletes a favorite and returns it, so it can be restored. */
export const deleteFavorite = (id: string) => take<Favorite>('favorites', id);
export const restoreFavorite = (record: Favorite) =>
  putBack('favorites', record);

/** A backup's contents: saved routes and, from version 2, favorites. */
export interface Library {
  routes: SavedRoute[];
  favorites: Favorite[];
}
export function exportLibraryBackup(library: Library): string {
  return JSON.stringify(
    {
      format: 'route-gpx-library',
      version: 2,
      exportedAt: new Date().toISOString(),
      routes: library.routes,
      favorites: library.favorites,
    },
    null,
    2,
  );
}
/**
 * Reads a backup, version 1 (routes only) or 2 (routes and favorites), and
 * validates all of it before anything is written.
 */
export function parseLibraryBackup(text: string): Library {
  if (text.length > 50_000_000)
    throw new Error('Choose a backup smaller than 50 MB.');
  const backup = JSON.parse(text) as {
    format?: string;
    version?: number;
    routes?: unknown[];
    favorites?: unknown;
  };
  if (
    backup?.format !== 'route-gpx-library' ||
    (backup.version !== 1 && backup.version !== 2) ||
    !Array.isArray(backup.routes) ||
    (backup.version === 2 &&
      backup.favorites !== undefined &&
      !Array.isArray(backup.favorites))
  )
    throw new Error('Invalid route backup.');
  const now = new Date().toISOString();
  const date = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? value
      : now;
  const routes = backup.routes.map((item) => {
    if (!item || typeof item !== 'object')
      throw new Error('Invalid route backup.');
    const row = item as SavedRoute;
    if (!validName(row.name)) throw new Error('Invalid saved route name.');
    const state = validateState(row.state);
    if (state.points.some((p) => !p.coord))
      throw new Error('Invalid saved route points.');
    const route = row.route;
    if (!validRoute(route)) throw new Error('Invalid saved route geometry.');
    const name = row.name.trim();
    state.name = name;
    return {
      id: libraryKey(name),
      name,
      state,
      route,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    };
  });
  const favorites = (
    backup.version === 2 && Array.isArray(backup.favorites)
      ? backup.favorites
      : []
  ).map((item) => {
    const row = (item ?? {}) as Favorite;
    if (
      !validName(row.name) ||
      !validCoord(row.coord) ||
      (row.kind !== undefined && !isKind(row.kind)) ||
      (row.place !== undefined &&
        (typeof row.place !== 'string' || row.place.length > PLACE_LIMIT))
    )
      throw new Error('Invalid favorite in the backup.');
    const name = row.name.trim();
    return {
      id: libraryKey(name),
      name,
      coord: [row.coord[0], row.coord[1]] as Coord,
      kind: row.kind ?? 'place',
      ...placeOf(row.place),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    };
  });
  return { routes, favorites };
}
/**
 * Adds what the backup has and this device does not; entries whose names
 * already exist are kept as they are. Returns how many of each were added.
 */
export async function importLibraryBackup(
  library: Library,
): Promise<{ routes: number; favorites: number }> {
  const fresh = <T extends { id: string }>(rows: T[], have: string[]) => {
    const seen = new Set(have);
    return rows.filter((r) => !seen.has(r.id) && !!seen.add(r.id));
  };
  const routes = fresh(
    library.routes,
    (await listSavedRoutes()).map((r) => r.id),
  );
  const favorites = fresh(
    library.favorites,
    (await listFavorites()).map((f) => f.id),
  );
  if (routes.length || favorites.length) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['routes', 'favorites'], 'readwrite');
      for (const record of routes) tx.objectStore('routes').put(record);
      for (const record of favorites) tx.objectStore('favorites').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return { routes: routes.length, favorites: favorites.length };
}
