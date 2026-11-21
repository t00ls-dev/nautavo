import { at } from './local-frame';

/**
 * Synthetic recorded activities (#156) shared by the unit and browser tests:
 * a GPX with times and Garmin TrackPointExtension values along a road going
 * east from the local frame's origin.
 */
export const ACTIVITY_START = Date.UTC(2026, 10, 15, 9, 40);
/** Meters between steps along the road. */
const STEP = 50;

export interface Sample {
  /** Seconds after the start. */
  t: number;
  /** Steps of `STEP` meters east of the start. */
  at: number;
  hr?: number;
  cad?: number;
  power?: number;
  temp?: number;
  /** Meters; 10 m plus one per step when left out. */
  ele?: number;
}
export const iso = (seconds: number) =>
  new Date(ACTIVITY_START + seconds * 1000).toISOString();

/** A GPX of the samples; `times: false` leaves the times out. */
export function activityGpx(samples: Sample[], { times = true } = {}): string {
  const point = (s: Sample) => {
    const [lat, lon] = at(s.at * STEP, 0);
    const value = (tag: string, v: number | undefined) =>
      v === undefined ? '' : `<${tag}>${v}</${tag}>`;
    return `<trkpt lat="${lat}" lon="${lon}"><ele>${s.ele ?? 10 + s.at}</ele>${
      times ? `<time>${iso(s.t)}</time>` : ''
    }<extensions>${value('power', s.power)}<gpxtpx:TrackPointExtension>${value(
      'gpxtpx:atemp',
      s.temp,
    )}${value('gpxtpx:hr', s.hr)}${value('gpxtpx:cad', s.cad)}</gpxtpx:TrackPointExtension></extensions></trkpt>`;
  };
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Morning ride</name><trkseg>${samples
    .map(point)
    .join('')}</trkseg></trk></gpx>`;
}

/** 10 steps 10 s apart (5 m/s), a pause of 2 min in place, then 10 more. */
export function ride(): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i <= 10; i++)
    samples.push({
      t: i * 10,
      at: i,
      hr: 120 + i,
      cad: 80,
      power: 200,
      temp: 25,
    });
  for (let i = 1; i <= 10; i++)
    samples.push({
      t: 220 + i * 10,
      at: 10 + i,
      hr: 140,
      cad: 0,
      power: 100,
      temp: 27,
    });
  return samples;
}

/**
 * The longest values a recording gives: every channel, four-digit power and
 * altitude, a negative temperature, a fast descent; 40 steps 5 s apart.
 */
export function extremeRide(): Sample[] {
  return Array.from({ length: 41 }, (_, i) => ({
    t: i * 5,
    // 10 m/s, then 20 m/s (72 km/h) downhill.
    at: i < 20 ? i : 20 + (i - 20) * 2,
    hr: 150 + i,
    cad: 60 + i,
    power: 900 + i * 20,
    temp: -12,
    ele: 2400 - i * 5,
  }));
}
