import { departureOf } from './departure';
import type { Route, State } from './core';
import { byId as $ } from './dom';
import { icon } from './icons';
import { distanceLabel } from './units';
import { nextSunrise, routeDaylight } from './daylight';
import { distanceUnits } from './unit-preferences';

/**
 * The daylight notice below the route summary (`#daylight-alert`, #305):
 * shown only when part of the trip is in the dark, with the distance in the
 * dark and the departure that avoids it; a tap shows the Daylight coloring
 * (main.ts). Text stays in English source form, one text node per phrase,
 * for the DOM translator.
 */
const phrase = (value: string) => {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
};

export function renderDaylight(
  state: State,
  route: Route | null,
  /** The same average speed as time, arrival and weather. */
  speedKmh: number,
): void {
  const alert = $<HTMLButtonElement>('daylight-alert');
  const text = alert.querySelector('.daylight-alert-text')!;
  alert.hidden = true;
  text.replaceChildren();
  const start = route?.segments.find((segment) => segment.length)?.[0];
  const leaving = departureOf(state);
  const departure = leaving ? Date.parse(leaving) : NaN;
  if (!route || !start || !Number.isFinite(departure)) return;
  const result = routeDaylight(route, departure, speedKmh);
  if (result.nightDistance <= 0) return;
  const locale = state.language === 'pt' ? 'pt-BR' : 'en';
  const sameDay = (time: number) =>
    new Date(time).toDateString() === new Date(departure).toDateString();
  // The clock alone on the departure's day, else with the date.
  const when = (time: number) =>
    new Date(time).toLocaleString(locale, {
      ...(sameDay(time) ? {} : { month: 'short', day: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    });
  const sunrise = nextSunrise(departure, start);
  // Leaving in the dark waits for the sunrise (when the night is not over
  // before the route is), leaving too late in the day runs into the night.
  const advice =
    sunrise !== null && result.sections[0]?.from === 0
      ? `Daylight at the start from ${when(sunrise)}.`
      : result.latestDeparture !== null && departure > result.latestDeparture
        ? `Leave by ${when(result.latestDeparture)} to arrive before sunset.`
        : null;
  text.append(
    phrase(
      `${distanceLabel(result.nightDistance, distanceUnits(), locale)} in the dark`,
    ),
  );
  if (advice)
    text.append(
      document.createTextNode(' '),
      phrase('·'),
      document.createTextNode(' '),
      phrase(advice),
    );
  alert.hidden = false;
}

/** The notice's fixed parts: its icon and the arrow to the map. */
export function setupDaylightAlert(show: () => void): void {
  const alert = $<HTMLButtonElement>('daylight-alert');
  const text = document.createElement('span');
  text.className = 'daylight-alert-text';
  alert.replaceChildren(icon('sunset'), text, icon('chevron'));
  alert.onclick = show;
}
