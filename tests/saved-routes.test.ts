import { expect, it } from 'vitest';
import { defaults, type Route } from '../src/core';
import {
  exportLibraryBackup,
  libraryKey,
  parseLibraryBackup,
  type Favorite,
  type SavedRoute,
} from '../src/saved-routes';
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
it('keeps favorites in a version 2 backup, and still reads version 1', () => {
  const text = exportLibraryBackup({
    routes: [record()],
    favorites: [favorite()],
  });
  expect(JSON.parse(text).version).toBe(2);
  expect(parseLibraryBackup(text)).toEqual({
    routes: [record()],
    favorites: [favorite()],
  });
  const v1 = JSON.stringify({
    format: 'route-gpx-library',
    version: 1,
    routes: [record()],
  });
  expect(parseLibraryBackup(v1)).toEqual({
    routes: [record()],
    favorites: [],
  });
});
it('rejects the whole backup when one favorite is malformed', () => {
  const backup = JSON.parse(
    exportLibraryBackup({
      routes: [record()],
      favorites: [favorite(), favorite('Work')],
    }),
  );
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
    ],
  };
  expect(roundtrip([current])[0].route).toEqual(current.route);
  const broken = JSON.parse(
    exportLibraryBackup({ routes: [old, current], favorites: [] }),
  );
  broken.routes[1].route.steps[0].modifier = 'sideways';
  expect(() => parseLibraryBackup(JSON.stringify(broken))).toThrow(
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
        format: 'route-gpx-library',
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
  );
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
  );
  expect(parseLibraryBackup(JSON.stringify(backup)).favorites[0].place).toBe(
    'Rua A, 10, Rio de Janeiro',
  );
  backup.favorites[0].place = 'x'.repeat(241);
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    'Invalid favorite in the backup.',
  );
});
