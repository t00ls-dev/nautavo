import type { Coord } from './core';
import { MapPopup, type PlannerMap } from './planner-map';
import { icon, iconControl, type IconName } from './icons';
import { visibleMapHeight } from './panel';

/**
 * Removing a route point from the map (#285): a trash zone at the bottom of
 * the map while a marker is dragged (drop it there), a popup on a tapped or
 * right-clicked marker with Remove. The route edit itself stays in
 * `src/main.ts`, shared with the list's ×, and Undo restores it.
 */

/** How far around the trash circle a marker's tip still counts, in pixels. */
const TRASH_REACH = 16;

/** The role of point `index` in a route of `count` points, for its labels. */
export type PointRole = 'start' | 'stop' | 'destination';
export const pointRole = (index: number, count: number): PointRole =>
  index === 0 ? 'start' : index === count - 1 ? 'destination' : 'stop';
const REMOVE_LABEL: Record<PointRole, string> = {
  start: 'Remove start',
  stop: 'Remove stop',
  destination: 'Remove destination',
};

/** Pixels of the map's bottom the bottom sheet covers (phones). */
const coveredBelow = (map: PlannerMap): number =>
  map.container.getBoundingClientRect().height -
  visibleMapHeight(map.container);

/** The trash zone shown while a route point is dragged. */
export function createTrash(map: PlannerMap) {
  const zone = document.createElement('div');
  zone.className = 'map-trash';
  zone.hidden = true;
  zone.setAttribute('aria-hidden', 'true');
  const circle = document.createElement('span');
  circle.append(icon('trash'));
  const label = document.createElement('b');
  zone.append(circle, label);
  map.container.append(zone);
  let hot = false;
  const mark = (on: boolean) => {
    hot = on;
    zone.classList.toggle('hot', on);
    label.textContent = on ? 'Release to remove' : 'Drag here to remove';
  };
  return {
    show() {
      // Above the bottom sheet on phones, so the whole zone is in view.
      zone.style.bottom = `${coveredBelow(map) + 20}px`;
      mark(false);
      zone.hidden = false;
    },
    hide() {
      zone.hidden = true;
      mark(false);
    },
    /** Whether a marker whose tip is at `coord` is over the trash. */
    over(coord: Coord): boolean {
      const tip = map.project(coord);
      if (zone.hidden || !tip) return false;
      const box = map.container.getBoundingClientRect();
      const c = circle.getBoundingClientRect();
      const x = c.left - box.left + c.width / 2;
      const y = c.top - box.top + c.height / 2;
      const on = Math.hypot(tip.x - x, tip.y - y) <= c.width / 2 + TRASH_REACH;
      if (on !== hot) mark(on);
      return on;
    },
  };
}

/** The popup of a route point on the map: its name, Remove and maybe Move. */
export function createPointPopup(map: PlannerMap) {
  const popup = new MapPopup(map, 'point-popup');
  popup.element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    popup.close();
    map.focus();
  });
  return {
    get open() {
      return popup.open;
    },
    show(options: {
      coord: Coord;
      /** The point's number, as on its marker. */
      number: number;
      name: string;
      role: PointRole;
      /** Removes the point. */
      remove: () => void;
      /** Places the point with the crosshair (that placement preference). */
      move?: (() => void) | undefined;
    }) {
      const box = document.createElement('div');
      box.className = 'point-popup-box';
      const header = document.createElement('div');
      header.className = 'point-popup-header';
      const number = document.createElement('span');
      number.className = 'point-popup-number';
      number.textContent = String(options.number);
      number.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong');
      name.textContent = options.name;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'point-popup-close';
      iconControl(close, 'close', 'Close', true);
      close.onclick = () => {
        popup.close();
        map.focus();
      };
      header.append(number, name, close);
      const actions = document.createElement('div');
      actions.className = 'point-popup-actions';
      const action = (label: string, symbol: IconName, run: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.append(icon(symbol), document.createTextNode(label));
        button.onclick = () => {
          popup.close();
          run();
        };
        actions.append(button);
        return button;
      };
      if (options.move) action('Move point', 'locate', options.move);
      action(REMOVE_LABEL[options.role], 'trash', options.remove);
      box.append(header, actions);
      popup.show(options.coord);
      popup.setContent(box);
      actions.querySelector('button')?.focus({ preventScroll: true });
    },
    close: () => popup.close(),
  };
}
