import type { Step } from './core';
import { text } from './dom';
import { t } from './i18n';
import { icon } from './icons';
import {
  maneuverIcon,
  maneuverText,
  shortRoadName,
  stepRoad,
} from './maneuvers';
import {
  currentStretch,
  navigationDistanceLabel,
  upcomingItems,
  type NavigationManeuver,
} from './navigation';
import { travelTimeSeconds } from './travel-time';
import { distanceUnits } from './unit-preferences';

/**
 * The upcoming list (#137): the bottom bar's handle opens a panel over the
 * map with the turns and route points ahead, from the route and progress
 * already in memory. Opening it changes nothing in navigation.
 */

/** A drag on the upcoming list's handle longer than this (px) opens or closes it. */
const LIST_DRAG = 30;

/** A maneuver's arrow, or a pin for the destination. */
export function maneuverGlyph(step: Step | null): SVGSVGElement {
  const arrow = step ? maneuverIcon(step) : null;
  const svg = icon(arrow?.name ?? (step ? 'maneuver-straight' : 'pin'));
  if (arrow?.mirror) svg.classList.add('mirror');
  return svg;
}

export function upcomingList(deps: {
  screen: HTMLDialogElement;
  toggle: HTMLButtonElement;
  list: HTMLOListElement;
  /** What lies ahead, or null when nothing is being followed. */
  ahead: () => {
    maneuvers: NavigationManeuver[];
    stops: { at: number | null; name: string }[];
    progress: number;
    departure: Step | null;
  } | null;
  arrivalSpeed: () => number;
  /** The traveler's clock, simulated while replaying. */
  now: () => number;
  locale: () => string;
}) {
  const { screen, toggle, list } = deps;
  let open = false,
    /** The stretch last shown first, so the list scrolls back to it when it changes. */
    shownStretch = 0;
  function set(next: boolean) {
    open = next;
    shownStretch = 0;
    list.hidden = !next;
    toggle.setAttribute('aria-expanded', String(next));
    if (next) render();
  }
  /** The stretch the traveler is on, highlighted at the top of the list. */
  function currentRow(stretch: { step: Step; index: number; total: number }) {
    const li = document.createElement('li');
    li.className = 'nav-list-current';
    li.setAttribute('aria-current', 'step');
    const road = stepRoad(stretch.step);
    const name = road
      ? shortRoadName(road)
      : t(maneuverText(stretch.step) ?? 'Continue');
    const count = t(`Step ${stretch.index} of ${stretch.total}`);
    const glyph = icon('navigate');
    glyph.classList.add('nav-list-icon');
    const label = document.createElement('span');
    label.className = 'nav-list-text';
    label.append(
      text('span', `${t('Now')} · ${name}`),
      text('span', count, 'nav-list-detail'),
    );
    li.title = `${t('Now')} · ${road ?? name} · ${count}`;
    li.append(glyph, label);
    return li;
  }
  function render() {
    const ahead = open ? deps.ahead() : null;
    if (!ahead) return;
    const { progress } = ahead;
    const locale = deps.locale();
    const stretch = currentStretch(ahead.maneuvers, progress, ahead.departure);
    const rows = upcomingItems(ahead.maneuvers, ahead.stops, progress).map(
      (item) => {
        const li = document.createElement('li');
        const distance = navigationDistanceLabel(
          item.at - progress,
          distanceUnits(),
          locale,
        );
        let label: HTMLElement, full: string, glyph: SVGSVGElement;
        if (item.kind === 'maneuver') {
          const instruction = t(maneuverText(item.step) ?? 'Continue');
          const road = stepRoad(item.step);
          label = text(
            'span',
            road ? `${instruction} · ${shortRoadName(road)}` : instruction,
            'nav-list-text',
          );
          full = road ? `${instruction} · ${road}` : instruction;
          glyph = maneuverGlyph(item.step);
        } else {
          const seconds = travelTimeSeconds(
            item.at - progress,
            deps.arrivalSpeed(),
          );
          const clock = new Date(
            deps.now() + seconds * 1000,
          ).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
          full = `${t(item.name)} · ${clock}`;
          // The arrival on its own line, below the stop's name, as the
          // stretch's number is below the road: on the narrowest card the
          // name and a 12-hour time do not fit side by side.
          label = document.createElement('span');
          label.className = 'nav-list-text';
          label.append(
            text('span', t(item.name)),
            text('span', clock, 'nav-list-detail'),
          );
          glyph = icon('pin');
          li.classList.add('nav-list-stop');
        }
        glyph.classList.add('nav-list-icon');
        li.title = `${full} · ${distance}`;
        li.append(glyph, label, text('span', distance, 'nav-list-distance'));
        return li;
      },
    );
    list.replaceChildren(...(stretch ? [currentRow(stretch)] : []), ...rows);
    if (stretch?.index !== shownStretch) list.scrollTop = 0;
    shownStretch = stretch?.index ?? 0;
  }
  // The bottom bar is a sheet: its handle, and the whole bar around it, open
  // the list; End, the replay controls and the list itself keep their own
  // taps. A tap toggles; a drag up opens and a drag down closes.
  const bar = toggle.closest<HTMLElement>('.nav-bar')!;
  // A recorded activity's replay has no turns: its bar is a data page.
  const ownTap = (target: EventTarget | null) =>
    screen.classList.contains('activity-replay') ||
    (target instanceof Element &&
      !!target.closest(
        'button:not(#nav-list-toggle), input, select, a, #nav-list',
      ));
  let dragFrom: number | null = null,
    dragged = false;
  bar.addEventListener('pointerdown', (e) => {
    if (ownTap(e.target)) return;
    dragFrom = e.clientY;
    dragged = false;
    // The release counts even when the finger has left the bar.
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointerup', (e) => {
    if (dragFrom === null) return;
    const dy = e.clientY - dragFrom;
    dragFrom = null;
    if (Math.abs(dy) < LIST_DRAG) return;
    dragged = true;
    set(dy < 0);
  });
  bar.addEventListener('click', (e) => {
    if (ownTap(e.target)) return;
    if (dragged) dragged = false;
    else set(!open);
  });
  // Escape closes the list first, and only then navigation.
  screen.addEventListener('cancel', (e) => {
    if (!open) return;
    e.preventDefault();
    set(false);
  });
  return { set, render };
}
