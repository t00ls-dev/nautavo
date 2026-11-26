import { byId as $, text } from './dom';
import {
  type Coord,
  type Point,
  type Route,
  type State,
  filename,
  generateGpx,
  meters,
  parseCoordinates,
} from './core';
import { FAVORITE_ICONS, coordText, favoriteDialog } from './favorite-dialog';
import {
  type Favorite,
  type SavedRoute,
  deleteFavorite,
  deleteSavedRoute,
  editFavorite,
  exportLibraryBackup,
  importLibraryBackup,
  libraryKey,
  listFavorites,
  listSavedRoutes,
  parseLibraryBackup,
  restoreFavorite,
  restoreSavedRoute,
  saveFavorite,
  saveNamedRoute,
} from './saved-routes';
import {
  GPX_DOWNLOAD,
  GPX_TYPES,
  JSON_TYPES,
  canShareFiles,
  exportFile,
} from './share-file';
import { type IconName, icon, iconControl } from './icons';
import type { PlannerMap } from './planner-map';
import { compactLayout } from './panel';
import { distanceLabel } from './units';
import { distanceUnits } from './unit-preferences';
import { getPosition, gpsPoint, positionView } from './location';
import { searchAddress } from './search';
import { splitPlace } from './autocomplete';
import { t } from './i18n';

/**
 * Saved routes and Favorite places (#52), kept on this device, with Save
 * route and the backup in Settings. The route on screen and its editor stay
 * in `src/main.ts`, reached through `deps`.
 */

export function setupLibrary(deps: {
  state: () => State;
  /** The route on screen, or null while one is being calculated. */
  route: () => Route | null;
  /** A point's field holds text not yet resolved to a place. */
  pending: () => boolean;
  locked: () => boolean;
  editBlocked: () => boolean;
  status: (message: string, error?: boolean) => void;
  /** Opens a saved route on screen. */
  open: (record: SavedRoute) => void;
  pointValue: (point: Point) => string;
  generatedName: (point: Point) => boolean;
  /** A point took a favorite's name: the address and the editor follow. */
  pointNamed: () => void;
  /** The route takes this name, as the Route name field gives it. */
  rename: (name: string) => void;
  map: PlannerMap;
  photonUrl: () => string;
  /** Exports share first on this device (`sharesFirst`). */
  shareExports: boolean;
}) {
  let savedEntries: SavedRoute[] = [];
  let libraryRevision = 0;
  let savingRoute = false;
  function updateSaveButton() {
    $('share-gpx').hidden = deps.shareExports || !canShareFiles();
    $<HTMLButtonElement>('share-gpx').disabled =
      !deps.route() || deps.pending();
    // The name is asked in the save sheet (#301).
    $<HTMLButtonElement>('save-route').disabled =
      savingRoute || !deps.route() || deps.pending();
  }
  /** A saved route already has this name: saving replaces it. */
  const savedAs = (name: string) =>
    savedEntries.some((r) => r.id === libraryKey(name));
  /** Favorite places (#52), kept on this device next to the saved routes. */
  let favoriteEntries: Favorite[] = [];
  const editFavoriteSheet = favoriteDialog({
    base: () => deps.photonUrl(),
    center: () => deps.map.getCenter(),
    search: (query) => searchAddress(query, deps.state().nominatim),
    locate: () =>
      getPosition().then((position) => gpsPoint(positionView(position).center)),
  });
  /** A point this close to a favorite is that favorite (meters). */
  const FAVORITE_HERE = 30;
  const favoriteAt = (coord: Coord) =>
    favoriteEntries.find((f) => meters(f.coord, coord) <= FAVORITE_HERE);
  /**
   * The favorites a point's menu lists: all of them while the field shows the
   * point itself, else those whose name matches what is typed.
   */
  function favoritesFor(typed: string, point: Point): Favorite[] {
    const query = libraryKey(typed);
    if (!query || typed === deps.pointValue(point)) return favoriteEntries;
    return favoriteEntries.filter((f) => f.id.includes(query));
  }
  function saveAsFavorite(point: Point) {
    const coord = point.coord;
    if (!coord) return;
    const value = deps.pointValue(point);
    // A point typed as coordinates, or named by the app, has no name to suggest.
    const named = !deps.generatedName(point) && !parseCoordinates(value);
    editFavoriteSheet({
      title: 'Save favorite',
      coord,
      place: named ? value : undefined,
      name: named ? splitPlace(value)[0] : '',
      kind: 'place',
      save: (name, kind, where, place) =>
        saveFavorite(name, where, kind, place).then((favorite) => {
          // The point now goes by the favorite's name, as when one is chosen,
          // unless the sheet moved the favorite elsewhere.
          if (point.coord === coord && where === coord && !deps.editBlocked()) {
            point.name = favorite.name;
            deps.pointNamed();
          }
          deps.status('Favorite saved on this device.');
          return refreshFavorites();
        }),
    });
  }
  /** Add favorite, in Favorite places: the same sheet, starting empty. */
  iconControl($('add-favorite'), 'plus', 'Add favorite');
  $('add-favorite').onclick = () =>
    editFavoriteSheet({
      title: 'Add favorite',
      name: '',
      kind: 'place',
      save: (name, kind, where, place) =>
        saveFavorite(name, where, kind, place).then(() => {
          favoriteMessage('Favorite saved.');
          return refreshFavorites();
        }),
    });
  async function refreshFavorites() {
    try {
      favoriteEntries = await listFavorites();
    } catch {
      favoriteEntries = [];
    }
    $('favorite-count').textContent = `(${favoriteEntries.length})`;
    const list = $('favorite-list');
    list.replaceChildren();
    if (!favoriteEntries.length)
      list.append(
        text('p', "No favorites. Add one here or from a point's menu.", 'hint'),
      );
    for (const favorite of favoriteEntries)
      list.append(
        libraryRow({
          icon: FAVORITE_ICONS[favorite.kind ?? 'place'],
          name: favorite.name,
          detail: favorite.place ?? coordText(favorite.coord),
          primary: `${t('Show on map')}: ${favorite.name}`,
          // A tap on the name shows the place on the map.
          onPrimary: () => {
            if (!$('route-panel').hidden && compactLayout())
              $('panel-toggle').click();
            deps.map.panTo(favorite.coord);
          },
          actions: [
            {
              icon: 'edit',
              label: `Edit favorite: ${favorite.name}`,
              run: () =>
                editFavoriteSheet({
                  title: 'Edit favorite',
                  coord: favorite.coord,
                  place: favorite.place,
                  name: favorite.name,
                  kind: favorite.kind ?? 'place',
                  save: (next, kind, where, place) =>
                    editFavorite(favorite.id, next, kind, where, place).then(
                      () => {
                        favoriteMessage('Favorite saved.');
                        return refreshFavorites();
                      },
                    ),
                }),
            },
            {
              icon: 'trash',
              label: `Delete favorite: ${favorite.name}`,
              run: () =>
                void deleteFavorite(favorite.id)
                  .then((deleted) => {
                    if (deleted)
                      offerUndo(
                        $('favorite-status'),
                        'Favorite deleted.',
                        'Could not access favorites.',
                        () =>
                          restoreFavorite(deleted).then((restored) => {
                            favoriteMessage(
                              restored
                                ? 'Favorite restored.'
                                : 'A favorite with this name already exists.',
                              !restored,
                            );
                            return refreshFavorites();
                          }),
                      );
                    return refreshFavorites();
                  })
                  .catch(() =>
                    favoriteMessage('Could not access favorites.', true),
                  ),
            },
          ],
        }),
      );
    updateBackupButton();
  }
  /** The backup holds saved routes and favorites: enabled when either exists. */
  function updateBackupButton() {
    $<HTMLButtonElement>('backup-routes').disabled =
      !savedEntries.length && !favoriteEntries.length;
  }
  async function refreshSavedRoutes() {
    const version = ++libraryRevision;
    try {
      const rows = await listSavedRoutes();
      if (version !== libraryRevision) return;
      savedEntries = rows;
      $('saved-count').textContent = `(${rows.length})`;
      const list = $('saved-list');
      list.replaceChildren();
      if (!rows.length) list.append(text('p', 'No saved routes.', 'hint'));
      const locale = deps.state().language === 'pt' ? 'pt-BR' : 'en';
      for (const record of rows) {
        const open = () => deps.open(record);
        const download = () => {
          const name = filename(record.state.points, record.name);
          void exportFile(
            generateGpx(record.route, record.state.points, record.name),
            name,
            {
              share: deps.shareExports,
              types: GPX_TYPES,
              downloadType: GPX_DOWNLOAD,
            },
          );
        };
        const remove = () =>
          void deleteSavedRoute(record.id)
            .then((deleted) => {
              // The route on screen is no longer saved.
              const onScreen = record.id === libraryKey(deps.state().name);
              // The status shows in the interface language.
              const shown = $('status').textContent ?? '';
              if (
                onScreen &&
                SAVED_STATUS.some((m) => [m, t(m)].includes(shown))
              )
                deps.status('Route ready.');
              if (deleted)
                offerUndo(
                  $('library-status'),
                  'Saved route deleted.',
                  'Could not access saved routes.',
                  () =>
                    restoreSavedRoute(deleted).then((restored) => {
                      libraryMessage(
                        restored
                          ? 'Saved route restored.'
                          : 'A saved route with this name already exists.',
                        !restored,
                      );
                      return refreshSavedRoutes();
                    }),
                );
              return refreshSavedRoutes();
            })
            .catch(() =>
              libraryMessage('Could not access saved routes.', true),
            );
        const row = libraryRow({
          icon: 'route',
          name: record.name,
          detail: `${distanceLabel(record.route.distance, distanceUnits(), locale)} · ${new Date(record.updatedAt).toLocaleDateString(locale)}`,
          primary: `Open saved route: ${record.name}`,
          onPrimary: open,
          actions: [
            {
              icon: deps.shareExports ? 'share' : 'download',
              label: deps.shareExports
                ? `Share saved route: ${record.name}`
                : `Download saved route: ${record.name}`,
              run: download,
            },
            {
              icon: 'trash',
              label: `Delete saved route: ${record.name}`,
              run: remove,
            },
          ],
        });
        row.querySelector<HTMLButtonElement>('.library-open')!.disabled =
          deps.locked();
        list.append(row);
      }
      updateBackupButton();
      updateSaveButton();
    } catch {
      libraryMessage(
        'Local route storage is unavailable in this browser.',
        true,
      );
    }
  }
  /** What the top status says while the route on screen is a saved one. */
  const SAVED_STATUS = ['Route saved on this device.', 'Saved route opened.'];
  /** Says how a saved-route action went, in Saved routes. */
  function libraryMessage(message: string, error = false) {
    sectionMessage($('library-status'), message, error);
  }
  /** Says how a favorite action went, in Favorite places (#205). */
  function favoriteMessage(message: string, error = false) {
    sectionMessage($('favorite-status'), message, error);
  }
  const undoTimers = new WeakMap<HTMLElement, number>();
  function sectionMessage(
    element: HTMLElement,
    message: string,
    error = false,
  ) {
    clearTimeout(undoTimers.get(element));
    element.replaceChildren(message);
    element.classList.toggle('error', error);
  }
  /** How long Undo stays after a deletion (ms). */
  const UNDO_TIME = 8000;
  /**
   * A deletion's message with Undo beside it for `UNDO_TIME` (#205); the
   * message stays after the button goes.
   */
  function offerUndo(
    element: HTMLElement,
    message: string,
    failure: string,
    undo: () => Promise<unknown>,
  ) {
    sectionMessage(element, message);
    const button = text('button', 'Undo', 'ghost') as HTMLButtonElement;
    button.type = 'button';
    button.onclick = () => {
      button.disabled = true;
      void undo().catch(() => sectionMessage(element, failure, true));
    };
    element.append(button);
    undoTimers.set(
      element,
      window.setTimeout(() => button.remove(), UNDO_TIME),
    );
  }
  /**
   * One row of Saved routes or Favorite places (#213): an icon, the name and
   * a detail line in the row's main button, then icon actions with full names.
   */
  function libraryRow(row: {
    icon: IconName;
    name: string;
    detail: string;
    primary: string;
    onPrimary: () => void;
    actions: { icon: IconName; label: string; run: () => void }[];
  }): HTMLElement {
    const element = document.createElement('div');
    element.className = 'library-row';
    const mark = icon(row.icon);
    mark.classList.add('library-icon');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'library-open';
    open.title = row.name;
    open.setAttribute('aria-label', row.primary);
    open.append(text('strong', row.name), text('small', row.detail));
    open.onclick = row.onPrimary;
    element.append(mark, open);
    for (const action of row.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      iconControl(button, action.icon, action.label, true);
      button.onclick = action.run;
      element.append(button);
    }
    return element;
  }
  /** Backup and restore in Settings say how it went beside their buttons. */
  function backupMessage(message: string, error = false) {
    $('backup-status').textContent = message;
    $('backup-status').classList.toggle('error', error);
  }
  // Save route asks for the name in its own sheet (#301), filled with the
  // route's name; one already saved is replaced, and the sheet says so.
  const saveSheet = $<HTMLDialogElement>('save-dialog'),
    saveName = $<HTMLInputElement>('save-name'),
    saveError = $('save-error'),
    saveConfirm = $('save-confirm');
  const describeSave = () => {
    saveConfirm.textContent = savedAs(saveName.value.trim())
      ? 'Update saved route'
      : 'Save';
  };
  saveName.oninput = () => {
    saveError.hidden = true;
    saveName.removeAttribute('aria-invalid');
    describeSave();
  };
  $('save-route').onclick = () => {
    if (!deps.route() || deps.pending()) return;
    saveName.value = deps.state().name;
    saveError.hidden = true;
    saveName.removeAttribute('aria-invalid');
    describeSave();
    saveSheet.showModal();
  };
  $('save-cancel').onclick = () => saveSheet.close();
  $('save-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = saveName.value.trim();
    if (!name) {
      saveError.textContent = 'Name the route to save it.';
      saveError.hidden = false;
      saveName.setAttribute('aria-invalid', 'true');
      saveName.focus();
      return;
    }
    saveSheet.close();
    deps.rename(name);
    saveRoute();
  });
  function saveRoute() {
    if (!deps.route() || !deps.state().name.trim() || deps.pending()) return;
    const snapshot = structuredClone(deps.state());
    const route = structuredClone(deps.route()!);
    savingRoute = true;
    updateSaveButton();
    void saveNamedRoute(snapshot, route)
      .then(() => {
        deps.status('Route saved on this device.');
        return refreshSavedRoutes();
      })
      .catch(() => {
        deps.status(
          'Could not save locally. Download the GPX to keep it.',
          true,
        );
      })
      .finally(() => {
        savingRoute = false;
        updateSaveButton();
      });
  }
  if (deps.shareExports) $('backup-routes').textContent = 'Share backup';
  $('backup-routes').onclick = () => {
    if (!savedEntries.length && !favoriteEntries.length) return;
    void exportFile(
      exportLibraryBackup({ routes: savedEntries, favorites: favoriteEntries }),
      `nautavo-backup-${new Date().toISOString().slice(0, 10)}.json`,
      {
        share: deps.shareExports,
        types: JSON_TYPES,
        downloadType: 'application/json',
      },
    );
  };
  $<HTMLInputElement>('restore-routes').onchange = () => {
    const input = $<HTMLInputElement>('restore-routes');
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 50_000_000) {
      backupMessage('Choose a backup smaller than 50 MB.', true);
      input.value = '';
      return;
    }
    void file
      .text()
      .then((data) => importLibraryBackup(parseLibraryBackup(data)))
      .then((count) => {
        backupMessage(
          `${count.routes === 1 ? 'Imported 1 route' : `Imported ${count.routes} routes`}${count.favorites ? (count.favorites === 1 ? ' and 1 favorite' : ` and ${count.favorites} favorites`) : ''}. Existing names were kept.`,
        );
        return Promise.all([refreshSavedRoutes(), refreshFavorites()]);
      })
      .catch(() => backupMessage('Could not import this route backup.', true))
      .finally(() => {
        input.value = '';
      });
  };

  return {
    refreshSavedRoutes,
    refreshFavorites,
    favoritesFor,
    favoriteAt,
    saveAsFavorite,
    updateSaveButton,
    /** The open buttons follow the edit lock. */
    syncLock() {
      document
        .querySelectorAll<HTMLButtonElement>('#saved-list .library-open')
        .forEach((button) => (button.disabled = deps.locked()));
    },
  };
}
