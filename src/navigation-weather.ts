import type { Route } from './core';
import { travelTimeSeconds } from './travel-time';
import {
  nearestHour,
  weatherWindow,
  type WeatherHour,
  type WeatherPoint,
} from './weather';
import { classifyWeather, type WeatherRisk } from './weather-risk';

/**
 * Weather on the navigation screen (#155): the forecast the planner already
 * fetched for the route, read at the traveler's position and ahead. No
 * request of its own; the position is never sent anywhere.
 */

/** The planner's forecast for a route, as the navigation screen reads it. */
export interface RouteWeather {
  route: Route;
  /** Samples along the planned route, by along-track distance. */
  points: WeatherPoint[];
  /** Hourly forecast for each sample. */
  hours: WeatherHour[][];
  /** Fetched interval, ms since the epoch. */
  start: number;
  end: number;
}

export interface SampleWeather {
  /** Index of the sample in `points`. */
  index: number;
  /** Meters from the traveler along the route (negative behind). */
  ahead: number;
  /** When the traveler is there, ms since the epoch. */
  passage: number;
  /** The forecast hour nearest to the passage. */
  hour: WeatherHour;
  /** Alerts for the hours around the passage, most severe first. */
  risks: WeatherRisk[];
}

/** Samples shown ahead of the one here. */
export const WEATHER_AHEAD = 3;

/**
 * The weather here (the sample nearest the traveler along the route, now)
 * and at the next samples ahead (when the traveler would pass them at
 * `speedKmh`). Samples whose time falls outside the fetched forecast are
 * left out.
 */
export function weatherAlong(
  weather: RouteWeather,
  progress: number,
  now: number,
  speedKmh: number,
  count = WEATHER_AHEAD,
): { here: SampleWeather | null; ahead: SampleWeather[] } {
  const at = (index: number, passage: number): SampleWeather | null => {
    const hours = weather.hours[index];
    if (!hours?.length || passage < weather.start || passage > weather.end)
      return null;
    return {
      index,
      ahead: weather.points[index].distance - progress,
      passage,
      hour: nearestHour(hours, passage),
      risks: classifyWeather(weatherWindow(hours, passage)),
    };
  };
  if (!weather.points.length) return { here: null, ahead: [] };
  let nearest = 0;
  weather.points.forEach((point, i) => {
    if (
      Math.abs(point.distance - progress) <
      Math.abs(weather.points[nearest].distance - progress)
    )
      nearest = i;
  });
  const here = at(nearest, now);
  const ahead: SampleWeather[] = [];
  for (
    let i = nearest + 1;
    i < weather.points.length && ahead.length < count;
    i++
  ) {
    const meters = weather.points[i].distance - progress;
    if (meters <= 0) continue;
    const sample = at(i, now + travelTimeSeconds(meters, speedKmh) * 1000);
    if (sample) ahead.push(sample);
  }
  return { here, ahead };
}
