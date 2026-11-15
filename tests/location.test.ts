import { afterEach, expect, it, vi } from 'vitest';
import { authorizedView, gpsPoint, positionView } from '../src/location';
import {
  approximateRegion,
  defaultRegionUrl,
  regionUrl,
} from '../src/services';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('never requests GPS while permission is prompt or denied or unavailable', async () => {
  const getCurrentPosition = vi.fn();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    permissions: { query: async () => ({ state: 'prompt' }) },
    geolocation: { getCurrentPosition },
  });
  expect(await authorizedView()).toBeNull();
  expect(getCurrentPosition).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  expect(await authorizedView()).toBeNull();
  expect(getCurrentPosition).not.toHaveBeenCalled();
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
