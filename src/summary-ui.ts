import type { Coord, Route, Step } from './core';
import {
  distanceLabel,
  durationLabel,
  milepostLabel,
  stepDistanceLabel,
  withUnit,
} from './units';
import { distanceUnits } from './unit-preferences';
import { icon } from './icons';
import { isImportedRoute } from './track-legs';
import {
  maneuverIcon,
  maneuverPositions,
  maneuverText,
  shortRoadName,
} from './maneuvers';
import { speedFromKmh, travelTimeSeconds } from './travel-time';
import { t } from './i18n';
import { text } from './dom';

/**
 * DOM of the route summary card, built from the route and the values passed
 * in; `renderSummary` in `src/main.ts` puts it together with the rest.
 */

/**
 * The summary's numbers: distance, time from the traveler's speed (never the
 * router's duration) and the arrival when there is a departure, with the
 * line that says what the time assumes and the closed sheet's peek text.
 */
export function summaryStats(
  route: Route,
  speedKmh: number,
  departure: number,
  locale: string,
) {
  const duration = travelTimeSeconds(route.distance, speedKmh);
  const stats = document.createElement('dl');
  stats.className = 'stats';
  const stat = (label: string, value: string, note?: string) => {
    const item = document.createElement('div');
    const term = text('dt', label);
    const data = document.createElement('dd');
    data.append(text('strong', value));
    // A smaller second line, so the value stays on one line on phones.
    if (note) data.append(text('span', note));
    item.append(term, data);
    stats.append(item);
  };
  const distance = distanceLabel(route.distance, distanceUnits(), locale);
  stat('Distance', distance);
  const time = durationLabel(duration);
  stat('Time', time);
  if (Number.isFinite(departure)) {
    const arrival = new Date(departure + duration * 1000);
    // The date is added only when the arrival is on another day.
    stat(
      'Arrival',
      arrival.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      arrival.toDateString() === new Date(departure).toDateString()
        ? undefined
        : arrival.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          }),
    );
  }
  // The basis of the time estimate, next to the numbers it explains.
  const speed = speedFromKmh(speedKmh, distanceUnits()).toLocaleString(locale, {
    maximumFractionDigits: 1,
  });
  const basis = `At ${withUnit(speed, distanceUnits() === 'imperial' ? 'mph' : 'km/h')} · no stops`;
  return {
    stats,
    basis: text('p', basis, 'hint stats-basis'),
    peek: `${distance} · ${time}`,
  };
}

/**
 * The Itinerary's steps: position along the route, arrow, instruction and
 * shortened road on one line, the full text in the tooltip; a step with a
 * maneuver location is a button that shows it with `onShow`, and local
 * sections to review are highlighted.
 */
export function itineraryList(
  route: Route,
  local: Step[],
  locale: string,
  onShow: (coord: Coord) => void,
): HTMLUListElement {
  const ul = document.createElement('ul');
  const positions = maneuverPositions(route, !isImportedRoute(route));
  // Without any position (an imported track's rerouted parts saved before
  // locations existed), the km column is left out rather than kept empty.
  const withPositions = positions.some((at) => at !== null);
  route.steps.forEach((s, n) => {
    if (s.distance <= 0) return;
    const li = document.createElement('li');
    // A step with a maneuver location is a button that shows it on the map.
    // The grid (position, arrow, instruction and road) is an inner element:
    // older Safari does not lay out a <button> itself as a grid and falls
    // back to the centered button layout.
    const holder: HTMLElement = document.createElement(s.at ? 'button' : 'div');
    holder.className = 'step-item';
    const row = document.createElement('span');
    row.className = 'step-row';
    holder.append(row);
    // Turn direction from the router; the instruction stays an English key
    // that the DOM translation handles.
    const arrow = maneuverIcon(s);
    const instruction = maneuverText(s);
    const at = positions[n];
    if (withPositions)
      row.append(
        text(
          'span',
          // Trailing space keeps the text readable when copied or read aloud.
          at === null ? '' : `${milepostLabel(at, distanceUnits(), locale)} `,
          'milepost',
        ),
      );
    else row.classList.add('no-position');
    if (arrow) {
      const svg = icon(arrow.name);
      svg.classList.add('maneuver-icon');
      if (arrow.mirror) svg.classList.add('mirror');
      row.append(svg);
    } else row.append(text('span', '', 'maneuver-icon'));
    // Two lines: the instruction in full, then the road (shortened, giving
    // way on a narrow screen) with the step's length always in view; the
    // full text stays in the tooltip and accessible label.
    const road = t(s.name);
    const length = stepDistanceLabel(s.distance, distanceUnits(), locale);
    // Highway references are in the chips above the list; on the line they
    // stand in only for a road without a name.
    const shortRoad =
      s.ref && s.name === 'Unnamed road' ? s.ref : shortRoadName(road);
    const full = `${instruction ? `${t(instruction)} · ` : ''}${s.ref ? `${s.ref} · ` : ''}${road} · ${length}`;
    const body = document.createElement('span');
    body.className = 'step-text';
    // The spaces keep the words apart when the text is copied.
    if (instruction)
      body.append(
        text('span', instruction, 'maneuver'),
        document.createTextNode(' '),
      );
    const detail = document.createElement('span');
    detail.className = 'step-detail';
    detail.append(
      text('span', shortRoad, 'step-road'),
      document.createTextNode(' '),
      text('span', length, 'step-length'),
    );
    body.append(detail);
    row.append(body);
    holder.title = full;
    if (s.at) {
      const button = holder as HTMLButtonElement;
      button.type = 'button';
      button.classList.add('maneuver-link');
      button.setAttribute('aria-controls', 'map');
      button.setAttribute(
        'aria-label',
        `${t('Show on map')}: ${at === null ? '' : `${milepostLabel(at, distanceUnits(), locale)} · `}${full}`,
      );
      const coord = s.at;
      button.onclick = () => onShow(coord);
    }
    li.append(holder);
    if (local.includes(s)) li.className = 'local-road';
    ul.append(li);
  });
  return ul;
}
