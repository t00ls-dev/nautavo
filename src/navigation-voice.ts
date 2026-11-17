import type { Step } from './core';
import { maneuverText, stepRoad } from './maneuvers';
import {
  navigationDistanceLabel,
  type NavigationManeuver,
  type NavigationReadout,
} from './navigation';
import type { DistanceUnits } from './units';

/**
 * Spoken announcements while navigating (#190): what to say and when, as
 * English source text that `t()` translates (`src/i18n.ts`). The browser's
 * own `speechSynthesis` speaks it (`src/navigation-ui.ts`); nothing here
 * sends or stores anything. Off by default (`navigation-voice` preference).
 *
 * The next maneuver is announced at most three times: far (once, only when
 * it was first seen farther than that), near and at the turn, at distances
 * that grow with speed so a faster traveler hears it earlier.
 *
 * A sunset before the arrival is said once, `VOICE_SUNSET_MINUTES` ahead
 * (or at once, with the minutes left, when less remains), never over a
 * maneuver announcement.
 */
export const VOICE_THRESHOLDS = {
  /** Far: the larger of these meters and seconds ahead at the speed. */
  far: { meters: 400, seconds: 30 },
  /** Near: the larger of these meters and seconds ahead at the speed. */
  near: { meters: 100, seconds: 10 },
  /** At the turn, meters. */
  now: 30,
} as const;

/** The sunset is said when this many minutes away, or fewer. */
export const VOICE_SUNSET_MINUTES = 30;

type Stage = 'far' | 'near' | 'now';

/** Spoken distance: the banner's rounding, with the unit as a word. */
export function spokenDistance(
  meters: number,
  units: DistanceUnits,
  locale: string,
): string {
  const label = navigationDistanceLabel(meters, units, locale);
  const [value, unit] = label.split(' ');
  const word = { m: 'meters', km: 'kilometers', ft: 'feet', mi: 'miles' }[unit];
  return word ? `${value} ${word}` : label;
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The sentence for a maneuver at a stage, in English source text. */
function sentence(
  maneuver: NavigationManeuver,
  stage: Stage,
  distance: string,
  stop: string | null,
): string | null {
  const { step } = maneuver;
  if (step.kind === 'arrive')
    return stage === 'now'
      ? null
      : stop
        ? `In ${distance}, you reach ${stop}.`
        : `In ${distance}, you will arrive.`;
  const instruction = maneuverText(step) ?? 'Continue';
  const road = stepRoad(step);
  const onto = road ? ` onto ${road}` : '';
  return stage === 'now'
    ? `${instruction}${onto} now.`
    : `In ${distance}, ${lower(instruction)}${onto}.`;
}

export function createVoiceSchedule() {
  /** Stages already said, per maneuver step. */
  const said = new WeakMap<Step, Set<Stage>>();
  /** How far each maneuver was when first seen. */
  const firstSeen = new WeakMap<Step, number>();
  let offRoute = false,
    arrived = false,
    sunsetSaid = false;
  return {
    /**
     * What to say for this readout, or null. `speed` in m/s (0 when
     * unknown); `units` and `locale` format the spoken distance.
     */
    next(
      readout: NavigationReadout | null,
      speed: number,
      units: DistanceUnits,
      locale: string,
      /** The intermediate stop an arrive maneuver reaches, by name. */
      stop: string | null = null,
    ): string | null {
      if (!readout) return null;
      if (readout.arrived) {
        if (arrived) return null;
        arrived = true;
        return 'You have arrived.';
      }
      if (readout.offRoute !== offRoute) {
        offRoute = readout.offRoute;
        return offRoute ? 'You are off the route.' : 'Back on the route.';
      }
      if (offRoute || !readout.next) return null;
      const { step } = readout.next;
      const d = readout.toNext;
      if (!firstSeen.has(step)) firstSeen.set(step, d);
      const v = Math.max(0, speed || 0);
      const T = VOICE_THRESHOLDS;
      const far = Math.max(T.far.meters, T.far.seconds * v),
        near = Math.max(T.near.meters, T.near.seconds * v);
      const stage: Stage | null =
        d <= T.now
          ? 'now'
          : d <= near
            ? 'near'
            : d <= far && firstSeen.get(step)! > far
              ? 'far'
              : null;
      if (!stage) return null;
      const done = said.get(step) ?? new Set<Stage>();
      said.set(step, done);
      if (done.has(stage)) return null;
      // A later stage covers the earlier ones: none is said after it.
      const order: Stage[] = ['far', 'near', 'now'];
      if (order.slice(order.indexOf(stage) + 1).some((s) => done.has(s)))
        return null;
      for (const s of order.slice(0, order.indexOf(stage) + 1)) done.add(s);
      return sentence(
        readout.next,
        stage,
        spokenDistance(d, units, locale),
        stop,
      );
    },
    /** A recalculated route was taken (#145). */
    rerouted(): string {
      return 'Route recalculated.';
    },
    /** The sunset `minutes` ahead, before the arrival; null when none. */
    sunset(minutes: number | null): string | null {
      if (minutes === null || offRoute || sunsetSaid) return null;
      if (minutes > VOICE_SUNSET_MINUTES) return null;
      sunsetSaid = true;
      const whole = Math.max(1, Math.round(minutes));
      return whole === 1
        ? 'Sunset in 1 minute.'
        : `Sunset in ${whole} minutes.`;
    },
  };
}
