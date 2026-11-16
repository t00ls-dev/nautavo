import { expect, it, vi } from 'vitest';
import {
  defaultView,
  initialView,
  parseView,
  serializeView,
} from '../src/default-view';

it('uses a known timezone before language, then region and language fallbacks', () => {
  expect(defaultView('Europe/Lisbon', ['en-US']).center).toEqual([39.5, -8]);
  expect(defaultView('Unknown', ['en-AU']).center).toEqual([-25, 134]);
  expect(defaultView('Unknown', ['pt']).center).toEqual([-23, -46]);
  expect(defaultView('Unknown', ['unknown', 'ja']).center).toEqual([36, 138]);
});
it('has a world fallback with no network access', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  expect(defaultView('Etc/UTC', ['xx'])).toEqual({ center: [20, 0], zoom: 1 });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
it('opens on the route, allowed location, last view or IP, never asking', async () => {
  const ip = { center: [3, 4] as [number, number], zoom: 10 };
  const last = { center: [-22.9, -43.2] as [number, number], zoom: 14 };
  const local = vi.fn(() => defaultView('Europe/London', []));
  const permission = vi
    .fn<() => Promise<PermissionState | null>>()
    .mockResolvedValue('granted');
  const lastView = vi.fn<() => typeof last | null>(() => last);
  const approximateRegion = vi
    .fn<() => Promise<typeof ip | null>>()
    .mockResolvedValue(ip);
  const options = {
    hasRoute: true,
    permission,
    lastView,
    approximateRegion,
    local,
  };
  expect(await initialView(options)).toBeNull();
  expect(permission).not.toHaveBeenCalled();
  // Allowed: the device's fixes frame the map, with no IP lookup.
  options.hasRoute = false;
  expect(await initialView(options)).toBeNull();
  expect(approximateRegion).not.toHaveBeenCalled();
  // Unknown (would ask, or cannot tell): where the map was last left.
  for (const state of ['prompt', null] as const) {
    permission.mockResolvedValue(state);
    expect(await initialView(options)).toEqual(last);
  }
  expect(approximateRegion).not.toHaveBeenCalled();
  lastView.mockReturnValue(null);
  expect(await initialView(options)).toEqual(ip);
  // Denied: the IP region, even with a last view.
  lastView.mockReturnValue(last);
  permission.mockResolvedValue('denied');
  expect(await initialView(options)).toEqual(ip);
  expect(local).not.toHaveBeenCalled();
  approximateRegion.mockResolvedValue(null);
  expect(await initialView(options)).toEqual(local());
});
it('stores the last view rounded and rejects invalid ones', () => {
  const text = serializeView({ center: [-22.912345678, -43.2], zoom: 15.1234 });
  expect(parseView(text)).toEqual({ center: [-22.91235, -43.2], zoom: 15.12 });
  for (const bad of [
    null,
    'x',
    '{}',
    '{"center":[91,0],"zoom":10}',
    '{"center":[0,0],"zoom":"10"}',
    '{"center":[0,0],"zoom":99}',
  ])
    expect(parseView(bad)).toBeNull();
});
