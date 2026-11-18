import { expect, it } from 'vitest';
import {
  ARRIVAL_BLEND_MS,
  arrivalSpeedKmh,
  createSpeedMeter,
} from '../src/navigation-speed';
import { speedToKmh } from '../src/travel-time';

const start = Date.parse('2026-11-14T12:00:00Z');
/** Feeds one fix a second: `kmh` while moving, stopped when 0. */
function ride(
  meter: ReturnType<typeof createSpeedMeter>,
  from: { time: number; progress: number },
  seconds: number,
  kmh: number,
  accuracy = 5,
) {
  let { time, progress } = from;
  for (let i = 0; i < seconds; i++) {
    time += 1000;
    progress += kmh / 3.6;
    meter.update({
      time,
      progress,
      speed: kmh / 3.6,
      accuracy,
      moving: kmh > 0,
    });
  }
  return { time, progress };
}

it('shows the current speed, smoothed, and 0 once stopped', () => {
  const meter = createSpeedMeter();
  expect(meter.current()).toBeNull();
  const at = ride(meter, { time: start, progress: 0 }, 20, 18);
  expect(meter.current()! * 3.6).toBeCloseTo(18, 0);
  ride(meter, at, 3, 0);
  expect(meter.current()).toBe(0);
});

it('hides the current speed with a weak signal', () => {
  const meter = createSpeedMeter();
  ride(meter, { time: start, progress: 0 }, 5, 18, 80);
  expect(meter.current()).toBeNull();
});

it('starts at the configured speed and follows the trip average, stops included', () => {
  const meter = createSpeedMeter();
  // Waiting before moving does not count.
  let at = ride(meter, { time: start, progress: 0 }, 60, 0);
  expect(arrivalSpeedKmh(meter, at.time, 20, 'metric')).toBe(20);
  // 10 minutes at 30 km/h, then a 5-minute stop.
  at = ride(meter, at, 600, 30);
  expect(arrivalSpeedKmh(meter, at.time, 20, 'metric')).toBeCloseTo(30, 0);
  at = ride(meter, at, 300, 0);
  // 5 km in 15 minutes: 20 km/h.
  expect(meter.average(at.time)! * 3.6).toBeCloseTo(20, 0);
  expect(arrivalSpeedKmh(meter, at.time, 20, 'metric')).toBeCloseTo(20, 0);
});

it('blends the two over the first ten minutes', () => {
  const meter = createSpeedMeter();
  const at = ride(
    meter,
    { time: start, progress: 0 },
    ARRIVAL_BLEND_MS / 2000,
    30,
  );
  // Halfway through the blend: midway between 20 and 30.
  expect(arrivalSpeedKmh(meter, at.time, 20, 'metric')).toBeCloseTo(25, 0);
});

it('stays within the slider range', () => {
  const meter = createSpeedMeter();
  const at = ride(meter, { time: start, progress: 0 }, 700, 200);
  expect(arrivalSpeedKmh(meter, at.time, 20, 'metric')).toBe(120);
  // In miles the top is the slider's 75 mph, not 120 km/h (74.6 mph).
  expect(arrivalSpeedKmh(meter, at.time, 20, 'imperial')).toBeCloseTo(
    speedToKmh(75, 'imperial'),
    6,
  );
});
