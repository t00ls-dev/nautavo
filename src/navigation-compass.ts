import type { Coord } from './core';
import { decimalYear, magneticDeclination } from './declination';
import { compassHeading, turnToward } from './navigation';

/**
 * The device compass while navigating: readings turned from magnetic to true
 * north with the local WMM2025 declination and smoothed, kept on the device
 * like positions.
 */

/** A compass reading older than this (ms) is not used. */
const COMPASS_FRESH = 2000;
/** Share of each compass reading taken in, to smooth its jitter. */
const COMPASS_SMOOTHING = 0.25;
/** iOS reports compass accuracy in degrees; worse than this asks to calibrate. */
const COMPASS_ACCURACY = 20;

/** iOS asks before giving orientation; elsewhere this is undefined. */
type OrientationPermission = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/**
 * Android Chrome gives a north-referenced reading only as
 * `deviceorientationabsolute`; iOS adds its compass heading to
 * `deviceorientation`. Both are heard; readings without north are ignored.
 */
const ORIENTATION_EVENTS = ['deviceorientationabsolute', 'deviceorientation'];

export function navigationCompass(deps: {
  /** Called once a frame after new readings, while `idle` says so. */
  onReading: () => void;
  /** Stopped: the compass is what turns the map. */
  idle: () => boolean;
  /** Navigation is still on when iOS answers the permission request. */
  active: () => boolean;
}) {
  let reading: number | null = null,
    readAt = 0,
    /** Degrees from magnetic to true north here (east positive). */
    declination = 0,
    poor = false,
    frame = 0;
  const heading = () =>
    reading !== null && Date.now() - readAt < COMPASS_FRESH ? reading : null;
  function onOrientation(event: DeviceOrientationEvent) {
    const ios = event as DeviceOrientationEvent & {
      webkitCompassHeading?: number;
      webkitCompassAccuracy?: number;
    };
    const magnetic = compassHeading(
      {
        alpha: event.alpha,
        absolute: event.absolute || event.type === 'deviceorientationabsolute',
        webkitCompassHeading: ios.webkitCompassHeading,
      },
      window.screen.orientation?.angle ?? 0,
    );
    if (magnetic === null) return;
    // Compasses point to magnetic north; the map's north is true north.
    const turned = (magnetic + declination + 360) % 360;
    const accuracy = ios.webkitCompassAccuracy;
    poor =
      typeof accuracy === 'number' &&
      (accuracy < 0 || accuracy > COMPASS_ACCURACY);
    reading =
      reading === null
        ? turned
        : turnToward(reading, turned, COMPASS_SMOOTHING);
    readAt = Date.now();
    if (!deps.idle() || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      deps.onReading();
    });
  }
  const forget = () => {
    reading = null;
    poor = false;
  };
  return {
    /** The smoothed true heading, or null without a fresh reading. */
    heading,
    /** iOS says a fresh reading needs calibrating. */
    poor: () => poor && heading() !== null,
    /** Magnetic declination at a place now, from the local WMM2025 model. */
    placeAt(coord: Coord | undefined) {
      if (coord)
        declination = magneticDeclination(
          coord[0],
          coord[1],
          decimalYear(new Date()),
        );
    },
    /** Called from the start tap: iOS only asks for orientation on a gesture. */
    watch() {
      const listen = () =>
        ORIENTATION_EVENTS.forEach((name) =>
          window.addEventListener(name, onOrientation as EventListener),
        );
      const ask = (
        window.DeviceOrientationEvent as unknown as OrientationPermission
      )?.requestPermission;
      if (typeof ask === 'function')
        ask()
          .then((answer) => {
            if (answer === 'granted' && deps.active()) listen();
          })
          .catch(() => undefined);
      else listen();
    },
    /** A new navigation starts without the last one's readings. */
    forget,
    stop() {
      ORIENTATION_EVENTS.forEach((name) =>
        window.removeEventListener(name, onOrientation as EventListener),
      );
      cancelAnimationFrame(frame);
      frame = 0;
      forget();
    },
  };
}
