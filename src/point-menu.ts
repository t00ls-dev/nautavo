import { toCoord, type PlannerMap, type Pixel } from './planner-map';
import { LongPress } from './long-press';
import { t } from './i18n';
import type { Coord } from './core';
import { compactLayout } from './panel';
import { byId as $ } from './dom';
import { followsTap, isTap, type TouchAt } from './tap-hold';
/**
 * Map point menu (right click, long press, ContextMenu key): the elevation of
 * that point, also while editing is locked, since viewing is not an edit.
 * Route points are set by typing, by a desktop click on the map (the selected
 * point) or by moving a marker; the menu no longer sets them.
 */

interface MapPointerEvent {
  point: Pixel;
  lngLat: { lat: number; lng: number };
  originalEvent: Event;
}
const onMarker = (event: MapPointerEvent) =>
  !!(event.originalEvent.target as Element | null)?.closest?.(
    '.maplibregl-marker',
  );

export function setupPointMenu(
  map: PlannerMap,
  options: {
    click: (coord: Coord) => void;
    /** False while route editing is locked; it reports why to the user. */
    editable?: () => boolean;
    /** Elevation of the chosen point, on this explicit action only. */
    elevation?: (coord: Coord) => void;
    /** Closes what a map tap should dismiss first; true when it did. */
    dismiss?: () => boolean;
  },
) {
  const {
    click,
    editable = () => true,
    elevation,
    dismiss = () => false,
  } = options;
  const container = map.container;
  const menu = document.createElement('div');
  menu.id = 'point-menu';
  menu.className = 'point-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('Map point'));
  container.parentElement!.append(menu);
  let coord: Coord = [0, 0],
    pointerId: number | null = null,
    openingEvent: PointerEvent | null = null;
  let suppressClick = false;
  let down: TouchAt | null = null,
    lastTap: TouchAt | null = null;
  // A touch release may retarget its synthetic click to the menu just opened
  // under the finger. Consume that click, but allow the next deliberate tap.
  container.parentElement!.addEventListener(
    'pointerdown',
    () => {
      suppressClick = false;
    },
    true,
  );
  container.parentElement!.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
  const close = () => {
    menu.hidden = true;
  };
  const item = (label: string, action: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('role', 'menuitem');
    button.onclick = () => {
      close();
      map.focus();
      action();
    };
    menu.append(button);
    return button;
  };
  if (elevation) item('Elevation here', () => elevation(coord));
  const items = () =>
    [...menu.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => !b.hidden,
    );
  /** The menu has something to offer: the elevation query. */
  const available = () => !!elevation;
  const open = (point: Pixel, position: Coord, focus: boolean) => {
    coord = position;
    menu.hidden = false;
    const bounds = container.getBoundingClientRect();
    // On phones the bottom sheet covers the lower part of the map.
    const bottom = compactLayout()
      ? $('sheet').getBoundingClientRect().top - bounds.top
      : bounds.height;
    menu.style.left = `${Math.max(8, Math.min(point.x, bounds.width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(point.y, bottom - menu.offsetHeight - 8))}px`;
    if (focus) items()[0]?.focus();
  };
  const press = new LongPress(() => {
    if (!openingEvent || !available()) return;
    suppressClick = true;
    const box = container.getBoundingClientRect();
    const point = {
      x: openingEvent.clientX - box.left,
      y: openingEvent.clientY - box.top,
    };
    const at = map.unproject(point);
    if (at) open(point, at, false);
    try {
      navigator.vibrate?.(15);
    } catch {
      /* Optional feedback. */
    }
  });
  // The browser's own long-press menu and text selection never belong on
  // the map surface; form fields and the route panel are unaffected.
  container.addEventListener('contextmenu', (event) => {
    if (matchMedia('(pointer: coarse)').matches) event.preventDefault();
  });
  container.addEventListener('selectstart', (event) => {
    if (!(event.target as Element | null)?.closest?.('input,textarea'))
      event.preventDefault();
  });
  const touching = (on: boolean) =>
    document.documentElement.classList.toggle('map-touching', on);
  container.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') touching(true);
    if (
      !matchMedia('(pointer: coarse)').matches ||
      event.pointerType === 'mouse' ||
      (event.target as Element).closest('.maplibregl-marker,.map-control')
    )
      return;
    if (pointerId !== null) {
      press.cancel();
      return;
    }
    // A tap, then touch and hold: MapLibre's one-finger zoom, not a choice.
    if (
      followsTap(lastTap, {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
      })
    ) {
      lastTap = null;
      return;
    }
    pointerId = event.pointerId;
    down = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    openingEvent = event;
    suppressClick = false;
    press.start(event.clientX, event.clientY);
  });
  container.addEventListener('pointermove', (event) =>
    press.move(event.clientX, event.clientY),
  );
  const end = () => {
    press.cancel();
    pointerId = null;
    touching(false);
  };
  container.addEventListener('pointerup', (event) => {
    // A short touch that stayed in place may start a double tap.
    const up = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    lastTap = down && isTap(down, up) ? up : null;
    down = null;
    end();
  });
  container.addEventListener('pointercancel', end);
  // A finger lifted outside the map must not leave page selection off.
  window.addEventListener('pointerup', () => touching(false));
  window.addEventListener('pointercancel', () => touching(false));
  // A double tap and hold zooms; that hold is not a point choice.
  map.on('movestart', () => {
    press.cancel();
    close();
  });
  map.on('click', (event: MapPointerEvent) => {
    // Clicks on markers belong to them, not to the map.
    if (onMarker(event)) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    close();
    // A tap that closes the elevation popup only closes it.
    if (dismiss()) return;
    if (!matchMedia('(pointer: coarse)').matches && editable())
      click(toCoord(event.lngLat));
  });
  map.on('contextmenu', (event: MapPointerEvent) => {
    if (matchMedia('(pointer: coarse)').matches || onMarker(event)) return;
    if (!available()) return;
    open(event.point, toCoord(event.lngLat), true);
  });
  container.addEventListener('keydown', (event) => {
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      const size = map.size();
      if (available())
        open({ x: size.x / 2, y: size.y / 2 }, map.getCenter(), true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target as Node)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      close();
      map.focus();
    }
  });
  menu.addEventListener('keydown', (event) => {
    const buttons = items();
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[
        (i + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
          buttons.length
      ].focus();
    }
    if (event.key === 'Tab') close();
  });
}
