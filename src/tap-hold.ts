/**
 * iOS Safari opens its text loupe for a tap followed by a touch and hold
 * (WebKit's "tap and a half"), even over content with `user-select: none`,
 * and no CSS turns it off (WebKit bug 296492). On the planner page that
 * gesture is the map's one-finger zoom, and on the activity view, the
 * charts, the route panel and the navigation and replay screens it showed
 * the loupe over the page. Cancelling the second touch at its start is the
 * only way to stop it: MapLibre still reads that touch (as the navigation
 * map does with every touch cancelled), so one-finger and pinch zoom keep
 * working, and only the browser's own reaction to it is dropped.
 *
 * Controls and text fields keep the second touch, so a quick second press
 * still clicks and a word can still be selected while typing. Map markers
 * are buttons for the keyboard but not such controls: a tap and then a
 * drag on one showed the loupe over the map, so they never keep it; their
 * drag follows pointer events, which a cancelled touch does not stop. Only a short
 * tap that stayed in place counts as the first touch, so a pan or scroll
 * followed by a quick new one is never blocked.
 */
/**
 * A double tap as MapLibre's tap recognizer counts it, shared by the
 * planner's point menu and the loupe guard below, so both agree with the
 * map's own double tap: a tap lasts less than `touch` ms and moves
 * less than `distance` px, and the second touch starts within `interval` ms
 * and `distance` px of the first tap.
 */
const DOUBLE_TAP = { touch: 500, interval: 500, distance: 30 } as const;
export interface TouchAt {
  x: number;
  y: number;
  time: number;
}
const near = (a: TouchAt, b: TouchAt) =>
  Math.hypot(a.x - b.x, a.y - b.y) < DOUBLE_TAP.distance;
/** A touch from `down` to `up` that was short and stayed in place. */
export const isTap = (down: TouchAt, up: TouchAt) =>
  up.time - down.time < DOUBLE_TAP.touch && near(down, up);
/** A touch starting at `down` that is the second of a double tap. */
export const followsTap = (tap: TouchAt | null, down: TouchAt) =>
  !!tap && down.time - tap.time < DOUBLE_TAP.interval && near(tap, down);
const KEEPS_TOUCH =
  'button, a, input, textarea, select, label, summary, [contenteditable], [role="button"], [role="slider"]';
/**
 * Points and weather on the map, whatever their role; a popup's buttons
 * (drawn as a marker too, `MapPopup`) stay controls.
 */
const MAP_MARKER = '.maplibregl-marker:not(.map-popup-anchor)';
/** Whether a second touch on `target` stays the browser's own. */
const keepsTouch = (target: EventTarget | null) => {
  const element = target as Element | null;
  return !!element?.closest?.(KEEPS_TOUCH) && !element.closest(MAP_MARKER);
};

export function stopTapHoldLoupe(): void {
  let start: TouchAt | null = null,
    tap: TouchAt | null = null;
  document.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1) {
        start = tap = null;
        return;
      }
      const at = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      const second = followsTap(tap, at);
      tap = null;
      start = second ? null : at;
      if (second && event.cancelable && !keepsTouch(event.target))
        event.preventDefault();
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    'touchend',
    (event) => {
      const touch = event.changedTouches[0],
        up = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      tap = start && !event.touches.length && isTap(start, up) ? up : null;
      start = null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener('touchcancel', () => (start = tap = null), {
    capture: true,
    passive: true,
  });
}
