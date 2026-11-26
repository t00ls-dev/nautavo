import type { Coord, Route, Step } from './core';
import {
  distanceLabel,
  durationLabel,
  elevationLabel,
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
  stepToward,
  towardText,
} from './maneuvers';
import { speedFromKmh, travelTimeSeconds } from './travel-time';
import { t } from './i18n';
import { text } from './dom';

/**
 * DOM of the route summary card, built from the route and the values passed
 * in; `renderSummary` in `src/main.ts` puts it together with the rest.
 */

/**
 * The summary's numbers (#302): distance, ascent and the arrival when there
 * is a departure, with the time from the traveler's speed (never the
 * router's duration) below it, else the time alone; the line that says what
 * the time assumes and the closed sheet's peek text. The ascent's value is
 * filled by `showAscent`.
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
  stat('Ascent', '');
  const ascent = stats.lastElementChild!.querySelector('dd')!;
  ascent.id = 'summary-ascent';
  const time = durationLabel(duration);
  if (Number.isFinite(departure)) {
    const arrival = new Date(departure + duration * 1000);
    // The date is added only when the arrival is on another day.
    const day =
      arrival.toDateString() === new Date(departure).toDateString()
        ? ''
        : ` · ${arrival.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          })}`;
    stat(
      'Arrival',
      arrival.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      `${time}${day}`,
    );
  } else stat('Time', time);
  // The basis of the time estimate, next to the numbers it explains.
  const speed = speedFromKmh(speedKmh, distanceUnits()).toLocaleString(locale, {
    maximumFractionDigits: 1,
  });
  const basis = `At ${withUnit(speed, distanceUnits() === 'imperial' ? 'mph' : 'km/h')} · no stops`;
  return {
    stats,
    ascent,
    basis: text('p', basis, 'hint stats-basis'),
    peek: `${distance} · ${time}`,
  };
}

/**
 * The summary's Ascent (#302): the value once the route's profile is known,
 * "…" while it loads, else a Show button whose tap asks for it: elevation is
 * never requested without that choice.
 */
export function showAscent(
  cell: HTMLElement,
  ascent: number | null,
  loading: boolean,
  locale: string,
  onShow: () => void,
) {
  if (ascent !== null)
    cell.replaceChildren(
      text('strong', elevationLabel(ascent, distanceUnits(), locale)),
    );
  else if (loading) {
    const busy = text('strong', '…');
    busy.setAttribute('aria-label', 'Loading elevation…');
    cell.replaceChildren(busy);
  } else {
    const show = text('button', 'Show', 'ascent-show') as HTMLButtonElement;
    show.type = 'button';
    show.setAttribute('aria-label', 'Show ascent');
    show.onclick = onShow;
    cell.replaceChildren(show);
  }
}

/**
 * The closed Trip options' line (#303): departure, speed and, when on,
 * Prefer main roads, each part its own text so the interface translates it.
 */
export function tripLine(
  departure: number,
  speedKmh: number,
  prefer: boolean,
  locale: string,
): string[] {
  const speed = speedFromKmh(speedKmh, distanceUnits()).toLocaleString(locale, {
    maximumFractionDigits: 1,
  });
  return [
    Number.isFinite(departure)
      ? new Date(departure).toLocaleString(locale, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'No departure',
    withUnit(speed, distanceUnits() === 'imperial' ? 'mph' : 'km/h'),
    ...(prefer ? ['Main roads'] : []),
  ];
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
    // The sign at the maneuver (#135): a road without a name or reference
    // reads its route number and "toward X"; a named road gets them on a
    // third line.
    const toward = stepToward(s),
      branch = s.branch ?? '';
    // The space keeps the route number apart from the text when copied.
    const sign = [
      ...(branch ? [text('span', branch, 'sign-route'), ' '] : []),
      ...(toward ? [t(towardText(toward))] : []),
    ];
    const nameless = s.name === 'Unnamed road' && !s.ref;
    const full = [
      instruction && t(instruction),
      s.ref,
      road,
      branch,
      toward && t(towardText(toward)),
      length,
    ]
      .filter(Boolean)
      .join(' · ');
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
    const roadLine = text('span', shortRoad, 'step-road');
    if (nameless && sign.length) roadLine.replaceChildren(...sign);
    detail.append(
      roadLine,
      document.createTextNode(' '),
      text('span', length, 'step-length'),
    );
    body.append(detail);
    if (!nameless && sign.length) {
      const line = document.createElement('span');
      line.className = 'step-toward';
      line.append(...sign);
      body.append(document.createTextNode(' '), line);
    }
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
