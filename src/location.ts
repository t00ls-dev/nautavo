import type { Coord } from './core';
import type { View } from './default-view';

export function positionView(position: GeolocationPosition): View {
  const { latitude, longitude, accuracy } = position.coords;
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0
  )
    throw new Error('Invalid position');
  return {
    center: [latitude, longitude],
    zoom: accuracy < 100 ? 15 : accuracy < 1000 ? 13 : 10,
  };
}
export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000,
    }),
  );
}
/**
 * The site's location permission, or null where it cannot be read (no secure
 * context, geolocation or Permissions API). Reading it never prompts.
 */
export async function locationPermission(): Promise<PermissionStatus | null> {
  try {
    if (
      !window.isSecureContext ||
      !navigator.geolocation ||
      !navigator.permissions
    )
      return null;
    return await navigator.permissions.query({ name: 'geolocation' });
  } catch {
    return null;
  }
}
export function locationError(code: number): string {
  return code === 1
    ? 'Location permission denied. Allow location in your browser site settings, then try again. You can still plan routes without GPS.'
    : code === 3
      ? 'Location timed out. Move to an open area and try again, or choose a point on the map.'
      : 'Location unavailable. Check your device location settings or choose a point on the map.';
}
/**
 * A GPS position used as a route point or sent for a navigation
 * recalculation: full precision, to the 6 decimals (about 10 cm) of links.
 */
export function gpsPoint(coord: Coord): Coord {
  return coord.map((n) => Number(n.toFixed(6))) as Coord;
}
