import { afterEach, expect, it, vi } from 'vitest';
import { gpsPoint, locationPermission, positionView } from '../src/location';
import {
  approximateRegion,
  defaultRegionUrl,
  regionUrl,
} from '../src/services';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('reads the location permission without requesting a position', async () => {
  const getCurrentPosition = vi.fn();
  const watchPosition = vi.fn();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    permissions: { query: async () => ({ state: 'prompt' }) },
    geolocation: { getCurrentPosition, watchPosition },
  });
  expect((await locationPermission())?.state).toBe('prompt');
  // Without the Permissions API, or outside a secure context, it is unknown.
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  expect(await locationPermission()).toBeNull();
  vi.stubGlobal('isSecureContext', false);
  vi.stubGlobal('navigator', {
    permissions: { query: async () => ({ state: 'granted' }) },
    geolocation: { getCurrentPosition },
  });
  expect(await locationPermission()).toBeNull();
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(watchPosition).not.toHaveBeenCalled();
});
it('selects precision-dependent zoom and rejects invalid positions', () => {
  expect(
    positionView({
      coords: { latitude: 10.123456, longitude: 20.654321, accuracy: 20 },
    } as GeolocationPosition).zoom,
  ).toBe(15);
  expect(() =>
    positionView({
      coords: { latitude: NaN, longitude: 20, accuracy: 1 },
    } as GeolocationPosition),
  ).toThrow();
});
it('does not access the network when IP detection is disabled and rejects insecure URLs', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await approximateRegion(false, defaultRegionUrl)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(() => regionUrl('http://example.com')).toThrow();
});

it('keeps GPS positions at the 6 decimals of links', () => {
  expect(gpsPoint([-22.12345678, -43.65432109])).toEqual([
    -22.123457, -43.654321,
  ]);
});
