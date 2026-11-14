import { expect, it } from 'vitest';
import type { Route } from '../src/core';
import { HOUR, type WeatherHour } from '../src/weather';
import { weatherAlong, type RouteWeather } from '../src/navigation-weather';

const start = Date.parse('2026-11-14T00:00:00Z');
/** Hourly forecast for a day: `base` + a tenth of the hour °C, dry unless `rain`. */
const day = (base: number, rain = -1): WeatherHour[] =>
  Array.from({ length: 24 }, (_, h) => ({
    time: start + h * HOUR,
    temperature: base + h / 10,
    probability: h === rain ? 80 : 10,
    precipitation: 0,
    code: h === rain ? 61 : 1,
    wind: 10,
    windDirection: 90,
    gusts: 20,
    visibility: 20000,
    uv: 2,
  }));
// Samples every 20 km along a 100 km route.
const weather: RouteWeather = {
  route: {} as Route,
  points: [0, 20, 40, 60, 80, 100].map((km) => ({
    coord: [0, km / 100],
    distance: km * 1000,
  })),
  hours: [0, 1, 2, 3, 4, 5].map((i) => day(i * 2, i === 2 ? 13 : -1)),
  start,
  end: start + 23 * HOUR,
};
const noon = start + 12 * HOUR;

it('reads the sample nearest the traveler now and the next ones at their passage times', () => {
  // 26 km along at 60 km/h: the 20 km sample is nearest.
  const { here, ahead } = weatherAlong(weather, 26_000, noon, 60);
  expect(here?.index).toBe(1);
  expect(here?.ahead).toBe(-6000);
  expect(here?.hour.temperature).toBeCloseTo(2 + 1.2);
  expect(ahead.map((s) => s.index)).toEqual([2, 3, 4]);
  // 14 km to the 40 km sample at 1 km a minute: 14 minutes, the noon hour.
  expect(ahead[0].passage).toBe(noon + 14 * 60_000);
  // 54 km to the 80 km sample: 12:54, so the 13:00 hour.
  expect(ahead[2].hour.temperature).toBeCloseTo(8 + 1.3);
});

it('carries the alerts of the hours around each passage', () => {
  const { ahead } = weatherAlong(weather, 26_000, noon, 60);
  // Rain at 13:00 at the 40 km sample, within its ±1 hour window.
  expect(ahead[0].risks.map((r) => r.text)).toContain('Rain risk');
  expect(ahead[1].risks).toEqual([]);
});

it('leaves out samples whose time falls outside the fetched forecast', () => {
  // At 22:30, the later samples are passed after 23:00.
  const late = start + 22.5 * HOUR;
  const { here, ahead } = weatherAlong(weather, 0, late, 60);
  expect(here?.index).toBe(0);
  expect(ahead.map((s) => s.index)).toEqual([1]);
  // Before the forecast starts, there is nothing here.
  expect(weatherAlong(weather, 0, start - HOUR, 60).here).toBeNull();
});

it('has nothing ahead at the destination and nothing without samples', () => {
  expect(weatherAlong(weather, 100_000, noon, 60).ahead).toEqual([]);
  expect(
    weatherAlong({ ...weather, points: [], hours: [] }, 0, noon, 60),
  ).toEqual({ here: null, ahead: [] });
});
