import { expect, it } from 'vitest';
import { defaults, type Route } from '../src/core';
import {
  canRestore,
  exportLibraryBackup,
  libraryKey,
  parseLibraryBackup,
  type Favorite,
  type SavedRoute,
} from '../src/saved-routes';
/** A backup as plain data, to break on purpose. */
interface EditableBackup {
  routes: { route: { steps: Record<string, unknown>[] } }[];
  favorites: Record<string, unknown>[];
}
const route: Route = {
  segments: [
    [
      [-22.9, -43.1],
      [-23, -43.2],
    ],
  ],
  steps: [],
  distance: 2000,
  duration: 120,
  provider: 'Test',
};
function record(): SavedRoute {
  const state = defaults();
  state.name = 'Weekend';
  state.points = [
    { name: 'Start', coord: [-22.9, -43.1] },
    { name: 'End', coord: [-23, -43.2] },
  ];
  return {
    id: 'weekend',
    name: 'Weekend',
    state,
    route,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}
/** Routes back from a backup holding `routes` and no favorites. */
const roundtrip = (routes: SavedRoute[]) =>
  parseLibraryBackup(exportLibraryBackup({ routes, favorites: [] })).routes;
const favorite = (name = 'Home'): Favorite => ({
  id: libraryKey(name),
  name,
  coord: [-22.93, -43.24],
  kind: 'place',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
it('roundtrips complete saved geometry, state and names in a portable backup', () => {
  expect(roundtrip([record()])).toEqual([record()]);
});
it('keeps favorites in a backup, and reads one without them', () => {
  const text = exportLibraryBackup({
    routes: [record()],
    favorites: [favorite()],
  });
  expect(JSON.parse(text)).toMatchObject({
    format: 'nautavo-library',
    version: 1,
  });
  expect(parseLibraryBackup(text)).toEqual({
    routes: [record()],
    favorites: [favorite()],
  });
  const routesOnly = JSON.stringify({
    format: 'nautavo-library',
    version: 1,
    routes: [record()],
  });
  expect(parseLibraryBackup(routesOnly)).toEqual({
    routes: [record()],
    favorites: [],
  });
});
it('refuses a backup of another format, the former route-gpx-library included', () => {
  const backup = JSON.parse(
    exportLibraryBackup({ routes: [record()], favorites: [] }),
  ) as { format: string };
  backup.format = 'route-gpx-library';
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    'Invalid route backup.',
  );
});
it('rejects the whole backup when one favorite is malformed', () => {
  const backup = JSON.parse(
    exportLibraryBackup({
      routes: [record()],
      favorites: [favorite(), favorite('Work')],
    }),
  ) as EditableBackup;
  backup.favorites[1].coord = [95, 0];
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    'Invalid favorite in the backup.',
  );
  backup.favorites[1] = { name: ' ', coord: [0, 0] };
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    'Invalid favorite in the backup.',
  );
});
it('imports backups with old steps and with maneuver details, rejecting invalid ones', () => {
  const old = record();
  old.route = {
    ...route,
    steps: [{ name: 'Road', ref: '', distance: 2000, duration: 120 }],
  };
  expect(roundtrip([old])[0].route).toEqual(old.route);
  const current = record();
  current.route = {
    ...route,
    steps: [
      {
        name: 'Road',
        ref: '',
        distance: 2000,
        duration: 120,
        kind: 'turn',
        modifier: 'left',
        at: [-22.9, -43.1],
      },
      {
        name: 'Ring',
        ref: '',
        distance: 0,
        duration: 0,
        kind: 'roundabout',
        exit: 3,
      },
      {
        name: 'Unnamed road',
        ref: '',
        distance: 500,
        duration: 30,
        kind: 'fork',
        branch: 'RJ-071',
        toward: 'Ilha do Governador, Aeroporto Internacional',
      },
    ],
  };
  expect(roundtrip([current])[0].route).toEqual(current.route);
  const broken = JSON.parse(
    exportLibraryBackup({ routes: [old, current], favorites: [] }),
  ) as EditableBackup;
  broken.routes[1].route.steps[0].modifier = 'sideways';
  expect(() => parseLibraryBackup(JSON.stringify(broken))).toThrow(
    'Invalid saved route geometry.',
  );
  const badSign = JSON.parse(
    exportLibraryBackup({ routes: [current], favorites: [] }),
  ) as EditableBackup;
  (badSign.routes[0].route.steps[2] as { toward: unknown }).toward = ['A'];
  expect(() => parseLibraryBackup(JSON.stringify(badSign))).toThrow(
    'Invalid saved route geometry.',
  );
});
it('recognizes matching names without adding case or whitespace duplicates', () => {
  expect(libraryKey(' Weekend ')).toBe(libraryKey('WEEKEND'));
});
it('validates every imported record before allowing a batch import', () => {
  const invalid = {
    ...record(),
    route: {
      ...route,
      segments: [
        [
          [91, 0],
          [0, 0],
        ],
      ],
    },
  };
  expect(() =>
    parseLibraryBackup(
      JSON.stringify({
        format: 'nautavo-library',
        version: 1,
        routes: [record(), invalid],
      }),
    ),
  ).toThrow('geometry');
  expect(() => parseLibraryBackup('{}')).toThrow();
});
it('keeps the kind of a favorite, a place when absent, and rejects others', () => {
  const backup = JSON.parse(
    exportLibraryBackup({
      routes: [],
      favorites: [{ ...favorite(), kind: 'home' }, favorite('Gym')],
    }),
  ) as EditableBackup;
  delete backup.favorites[1].kind;
  expect(
    parseLibraryBackup(JSON.stringify(backup)).favorites.map((f) => f.kind),
  ).toEqual(['home', 'place']);
  backup.favorites[1].kind = 'castle';
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    'Invalid favorite in the backup.',
  );
});
it("keeps a favorite's address, and rejects one too long", () => {
  const backup = JSON.parse(
    exportLibraryBackup({
      routes: [],
      favorites: [{ ...favorite(), place: 'Rua A, 10, Rio de Janeiro' }],
    }),
  ) as EditableBackup;
  expect(parseLibraryBackup(JSON.stringify(backup)).favorites[0].place).toBe(
    'Rua A, 10, Rio de Janeiro',
  );
  backup.favorites[0].place = 'x'.repeat(241);
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    'Invalid favorite in the backup.',
  );
});

it('restores a deleted entry only to a free name (#205)', () => {
  expect(canRestore(undefined)).toBe(true);
  // Saved again under that name meanwhile: Undo leaves it as it is.
  expect(canRestore(record())).toBe(false);
});
