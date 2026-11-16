import { addressAutocomplete, splitPlace } from './autocomplete';
import { parseCoordinates, type Coord } from './core';
import { byId as $ } from './dom';
import { t } from './i18n';
import { icon, type IconName } from './icons';
import type { FavoriteKind } from './saved-routes';
import type { SearchResult } from './services';

/** The icon of each kind of favorite place (#52). */
export const FAVORITE_ICONS: Record<FavoriteKind, IconName> = {
  home: 'home',
  work: 'work',
  place: 'star',
};
/** The default name a kind suggests while the name field is empty. */
const KIND_NAMES: Partial<Record<FavoriteKind, string>> = {
  home: 'Home',
  work: 'Work',
};
/** A place's coordinates as shown when it has no address. */
export const coordText = (coord: Coord) =>
  coord.map((n) => n.toFixed(5)).join(', ');

export interface FavoriteEdit {
  title: string;
  name: string;
  kind: FavoriteKind;
  coord: Coord;
  /** The place's address, if known. */
  place?: string;
  /** Stores the choice; a rejection keeps the sheet open with its message. */
  save: (
    name: string,
    kind: FavoriteKind,
    coord: Coord,
    place?: string,
  ) => Promise<unknown>;
}

/**
 * The app's own sheet to name a favorite, choose its icon and its place,
 * instead of the browser's prompt (which shows the site address and offers
 * to block the page's dialogs). The place field searches like a point's:
 * suggestions while typing, Enter for an address search, pasted
 * coordinates and My location.
 */
export function favoriteDialog(services: {
  /** Photon server, map center and Nominatim search, as the points use. */
  base: () => string;
  center: () => Coord;
  search: (query: string) => Promise<SearchResult[]>;
  /** The device's position, after the tap that asks for it. */
  locate: () => Promise<Coord>;
}) {
  const dialog = $<HTMLDialogElement>('favorite-dialog'),
    form = $<HTMLFormElement>('favorite-form'),
    name = $<HTMLInputElement>('favorite-name'),
    where = $<HTMLInputElement>('favorite-where'),
    results = $('favorite-where-results'),
    error = $('favorite-error');
  for (const span of dialog.querySelectorAll<HTMLElement>('[data-icon]'))
    span.prepend(icon(span.dataset.icon as IconName));
  const kinds = [
    ...form.querySelectorAll<HTMLInputElement>('input[name=favorite-kind]'),
  ];
  let current: FavoriteEdit | null = null;
  /** The place chosen in the sheet, and the text the field showed for it. */
  let chosen: { coord: Coord; place?: string; shown: string } | null = null;
  const kind = () =>
    (kinds.find((k) => k.checked)?.value ?? 'place') as FavoriteKind;
  const fail = (message: string) => {
    error.textContent = t(message);
    error.hidden = false;
  };
  const choose = (coord: Coord, place?: string) => {
    const shown = place ?? coordText(coord);
    chosen = { coord, place, shown };
    where.value = shown;
    where.removeAttribute('aria-invalid');
    results.replaceChildren();
    error.hidden = true;
    // A place found by search suggests a name when there is none yet.
    if (place && !name.value.trim()) name.value = splitPlace(place)[0];
  };
  const closeSuggestions = addressAutocomplete(where, results, {
    base: services.base,
    center: services.center,
    valid: () => dialog.open,
    choose: (result) => {
      const coord = parseCoordinates(`${result.lat},${result.lon}`);
      if (coord) choose(coord, result.display_name.slice(0, 240));
    },
    pending: () => undefined,
    completed: () => undefined,
    failed: () => undefined,
    actions: () => [
      {
        label: 'My location',
        icon: 'locate',
        run: () =>
          void services
            .locate()
            .then((coord) => choose(coord))
            .catch(() => fail('Your location is not available.')),
      },
    ],
  });
  // Enter in the place field searches (or takes coordinates); it never
  // saves the sheet.
  where.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing)
      return;
    event.preventDefault();
    closeSuggestions();
    const query = where.value.trim();
    const coord = parseCoordinates(query);
    if (coord) return choose(coord);
    if (query.length < 3) return fail('Enter a place or valid coordinates.');
    void services.search(query).then(
      (found) => {
        if (!dialog.open || where.value.trim() !== query) return;
        if (!found.length)
          return fail(
            'No address found. Try a nearby street, city, or coordinates.',
          );
        results.replaceChildren(
          ...found.map((r) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = r.display_name;
            button.onclick = () => {
              const c = parseCoordinates(`${r.lat},${r.lon}`);
              if (c) choose(c, r.display_name.slice(0, 240));
            };
            return button;
          }),
        );
      },
      () => fail('Search is unavailable right now.'),
    );
  });
  // Home and Work fill an empty name, or replace the other's default.
  for (const k of kinds)
    k.onchange = () => {
      const defaults = Object.values(KIND_NAMES).map((n) => t(n));
      const suggested = KIND_NAMES[kind()];
      if (suggested && (!name.value.trim() || defaults.includes(name.value)))
        name.value = t(suggested);
    };
  $('favorite-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => closeSuggestions());
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!current || !chosen) return;
    // Text typed but not chosen is not a place yet.
    if (where.value.trim() !== chosen.shown) {
      const coord = parseCoordinates(where.value);
      if (coord) choose(coord);
      else {
        where.setAttribute('aria-invalid', 'true');
        where.focus();
        return fail('Choose the place from the search, or paste coordinates.');
      }
    }
    const edit = current,
      place = chosen;
    error.hidden = true;
    void edit
      .save(name.value, kind(), place.coord, place.place)
      .then(() => dialog.close())
      .catch((e: Error) => {
        fail(e.message);
        name.focus();
      });
  };
  return (edit: FavoriteEdit) => {
    current = edit;
    $('favorite-title').textContent = t(edit.title);
    name.value = edit.name;
    error.hidden = true;
    for (const k of kinds) k.checked = k.value === edit.kind;
    dialog.showModal();
    choose(edit.coord, edit.place);
    name.value = edit.name;
    name.focus();
  };
}
