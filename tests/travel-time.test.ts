import { expect, it } from 'vitest';
import {
  travelTimeSeconds,
  speedInputBounds,
  speedNotches,
  snapSpeed,
  convertSpeedUnits,
  DEFAULT_SPEED_MPH,
  speedToKmh,
  speedFromKmh,
  storedSpeedKmh,
  rememberSpeedKmh,
  DEFAULT_SPEED_KMH,
} from '../src/travel-time';
import { defaults, decodeState, encodeState, encodeStateV1 } from '../src/core';
it('calculates trip time in both systems, including 130 mph', () => {
  expect(travelTimeSeconds(42000, 60)).toBeCloseTo(2520);
  expect(travelTimeSeconds(160934.4, speedToKmh(60, 'imperial'))).toBeCloseTo(
    6000,
  );
  expect(travelTimeSeconds(209214.72, speedToKmh(130, 'imperial'))).toBeCloseTo(
    3600,
  );
  expect(() => travelTimeSeconds(42000, 0)).toThrow();
});
it('offers fine notches at low speeds and coarser ones above, to 120 km/h or 75 mph', () => {
  expect(speedInputBounds()).toEqual({ min: 1, max: 120 });
  expect(speedInputBounds('imperial')).toEqual({ min: 1, max: 75 });
  const metric = speedNotches();
  expect(metric.slice(0, 3)).toEqual([1, 2, 3]);
  expect(metric).toContain(40);
  expect(metric).not.toContain(41);
  expect(metric.slice(-5)).toEqual([80, 90, 100, 110, 120]);
  expect(metric).toHaveLength(52);
  const imperial = speedNotches('imperial');
  expect(imperial).toContain(25);
  expect(imperial).not.toContain(26);
  expect(imperial.at(-1)).toBe(75);
  expect(snapSpeed(0)).toBe(1);
  expect(snapSpeed(18.4)).toBe(18);
  expect(snapSpeed(43)).toBe(45);
  expect(snapSpeed(500)).toBe(120);
  expect(snapSpeed(500, 'imperial')).toBe(75);
});
it('remembers the average speed on the device, with a 20 km/h (13 mph) default', () => {
  localStorage.clear();
  expect(DEFAULT_SPEED_KMH).toBe(20);
  expect(storedSpeedKmh()).toBe(20);
  expect(speedFromKmh(storedSpeedKmh('imperial'), 'imperial')).toBeCloseTo(
    DEFAULT_SPEED_MPH,
  );
  rememberSpeedKmh(25);
  expect(storedSpeedKmh()).toBe(25);
  // A speed above the top, kept from before it was lowered, becomes the top.
  rememberSpeedKmh(150);
  expect(storedSpeedKmh()).toBe(120);
  expect(speedFromKmh(storedSpeedKmh('imperial'), 'imperial')).toBeCloseTo(75);
  for (const invalid of ['0', '-3', 'fast', '']) {
    localStorage.setItem('average-speed', invalid);
    expect(storedSpeedKmh()).toBe(DEFAULT_SPEED_KMH);
  }
  localStorage.clear();
});
it('keeps the speed on a notch when the units change, the default becoming the other default', () => {
  expect(
    speedFromKmh(convertSpeedUnits(20, 'metric', 'imperial'), 'imperial'),
  ).toBeCloseTo(13);
  expect(
    convertSpeedUnits(speedToKmh(13, 'imperial'), 'imperial', 'metric'),
  ).toBe(20);
  // 30 km/h is 18.6 mph: the 19 mph notch; and back, 30.6 km/h is 31.
  const mph = convertSpeedUnits(30, 'metric', 'imperial');
  expect(speedFromKmh(mph, 'imperial')).toBeCloseTo(19);
  expect(convertSpeedUnits(mph, 'imperial', 'metric')).toBe(31);
  expect(convertSpeedUnits(42, 'metric', 'metric')).toBe(42);
});
it('keeps links free of the average speed', () => {
  const s = defaults();
  s.departure = '2026-11-08T09:00:00.000Z';
  // The former speed slot (index 5) stays 0 so later positions are unchanged.
  expect(decodeState(encodeState(s))).toEqual(s);
});
it('ignores any speed in older links without discarding their points', () => {
  const s = defaults();
  s.points = [
    { name: 'Start', coord: [-22.93, -43.23] },
    { name: 'End', coord: [-23.05, -43.53] },
  ];
  for (const averageSpeedKmh of [20, 61.5, 500, -1, 'fast']) {
    const legacy = encodeStateV1({ ...s, averageSpeedKmh } as typeof s);
    const restored = decodeState(legacy);
    expect(restored.points).toEqual(s.points);
    expect(restored).not.toHaveProperty('averageSpeedKmh');
  }
});
