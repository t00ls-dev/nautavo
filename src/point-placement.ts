// Placing a route point precisely on a touch screen, where the finger hides
// the marker. Two ways, chosen in Settings (`point-placement` device
// preference):
// - Loupe (default): while a marker is dragged by touch, a magnified circle
//   above the finger shows the exact spot under the marker tip.
// - Crosshair: tapping a marker enters an adjust mode with a fixed marker at
//   the map center; the map pans under it until Confirm.
// Both only change how a point is moved; the point is set as before.
import { isolate, type PlannerMap } from './planner-map';
import type { Coord } from './core';
import { PREFERENCE, readPreference, writePreference } from './preferences';

export type PlacementMode = 'loupe' | 'crosshair';

export function placementMode(): PlacementMode {
  return readPreference(PREFERENCE.pointPlacement) === 'crosshair'
    ? 'crosshair'
    : 'loupe';
}
export function rememberPlacementMode(mode: PlacementMode): void {
  writePreference(PREFERENCE.pointPlacement, mode === 'loupe' ? null : mode);
}

/** Loupe diameter, magnification and lift above the marker tip (CSS px). */
export const LOUPE = { size: 120, zoom: 2, lift: 116, margin: 8 };

/**
 * Center of the loupe for a marker tip at `tip` on a map of `size`: above
 * the finger, beside it near the top edge, always inside the map.
 */
export function loupeCenter(
  tip: { x: number; y: number },
  size: { x: number; y: number },
): { x: number; y: number } {
  const half = LOUPE.size / 2 + LOUPE.margin;
  let x = tip.x;
  let y = tip.y - LOUPE.lift;
  if (y < half) {
    // Beside the marker, on the side with more room, at the tip's height.
    x = tip.x + (tip.x < size.x / 2 ? 1 : -1) * (LOUPE.size / 2 + 40);
    y = tip.y - 24;
  }
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(value, half), Math.max(half, max - half));
  return { x: clamp(x, size.x), y: clamp(y, size.y) };
}

/** The magnifier shown while a marker is dragged by touch. */
export function createLoupe(map: PlannerMap) {
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const el = document.createElement('div');
  el.className = 'placement-loupe';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(LOUPE.size * ratio);
  el.append(canvas);
  map.container.append(el);
  const ctx = canvas.getContext('2d');
  let at: Coord | null = null;
  let pending = false;
  let frame = 0;

  const cross = (c: number, color: string, width: number) => {
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * ratio;
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      ctx.moveTo(c + dx * 6 * ratio, c + dy * 6 * ratio);
      ctx.lineTo(c + dx * 17 * ratio, c + dy * 17 * ratio);
    }
    ctx.stroke();
  };
  const draw = () => {
    pending = false;
    const p = at && map.project(at);
    if (!p || !ctx) return;
    const w = canvas.width;
    ctx.save();
    ctx.fillStyle = '#e8ebe6';
    ctx.fillRect(0, 0, w, w);
    const gl = map.gl()?.getCanvas();
    if (gl) {
      const rect = gl.getBoundingClientRect();
      const box = map.container.getBoundingClientRect();
      if (rect.width) {
        const scale = gl.width / rect.width;
        const sx = (box.left + p.x - rect.left) * scale;
        const sy = (box.top + p.y - rect.top) * scale;
        const s = (LOUPE.size / LOUPE.zoom) * scale;
        try {
          ctx.drawImage(gl, sx - s / 2, sy - s / 2, s, s, 0, 0, w, w);
        } catch {
          /* The plain background stays. */
        }
      }
    }
    // The exact spot: a crosshair with a white halo and a center dot.
    // The stylesheet's primary color, so the loupe follows the brand.
    const primary = getComputedStyle(el)
      .getPropertyValue('--color-primary')
      .trim();
    cross(w / 2, '#fff', 5);
    cross(w / 2, primary, 2.5);
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, 2.5 * ratio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const request = () => {
    if (pending) return;
    pending = true;
    const gl = map.gl();
    if (gl) {
      // The WebGL buffer is readable only in the frame that drew it.
      gl.once('render', draw);
      gl.triggerRepaint();
    } else frame = requestAnimationFrame(draw);
  };
  return {
    move(coord: Coord) {
      at = coord;
      const tip = map.project(coord);
      if (!tip) return;
      const c = loupeCenter(tip, map.size());
      el.style.transform = `translate(${c.x - LOUPE.size / 2}px, ${c.y - LOUPE.size / 2}px)`;
      el.hidden = false;
      request();
    },
    hide() {
      at = null;
      pending = false;
      cancelAnimationFrame(frame);
      el.hidden = true;
    },
  };
}

/** Adjust mode: a fixed marker at the map center over a panning map. */
export function createCrosshair(map: PlannerMap) {
  const pin = document.createElement('div');
  pin.className = 'placement-pin';
  pin.hidden = true;
  pin.setAttribute('aria-hidden', 'true');
  const number = document.createElement('b');
  const head = document.createElement('span');
  head.append(number);
  const dot = document.createElement('i');
  pin.append(head, dot);
  const bar = document.createElement('div');
  bar.className = 'placement-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'group');
  const text = document.createElement('p');
  text.id = 'placement-text';
  text.setAttribute('aria-live', 'polite');
  bar.setAttribute('aria-labelledby', text.id);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'primary';
  confirm.textContent = 'Confirm';
  const buttons = document.createElement('div');
  buttons.append(cancel, confirm);
  bar.append(text, buttons);
  isolate(bar);
  map.container.append(pin, bar);
  let done: ((coord: Coord | null) => void) | null = null;
  const finish = (coord: Coord | null) => {
    if (!done) return;
    pin.hidden = bar.hidden = true;
    document.body.classList.remove('placing-point');
    document.removeEventListener('keydown', onKey, true);
    const callback = done;
    done = null;
    callback(coord);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  };
  cancel.onclick = () => finish(null);
  confirm.onclick = () => {
    const [lat, lon] = map.getCenter();
    finish([+lat.toFixed(6), +lon.toFixed(6)]);
  };
  return {
    get active() {
      return done !== null;
    },
    /** Centers `coord` and waits for Confirm (the new spot) or Cancel. */
    start(coord: Coord, label: number, callback: (c: Coord | null) => void) {
      finish(null);
      done = callback;
      number.textContent = String(label);
      text.textContent = `Move the map to place point ${label}`;
      map.stop();
      map.setView(coord, Math.max(map.getZoom(), 15));
      pin.hidden = bar.hidden = false;
      document.body.classList.add('placing-point');
      document.addEventListener('keydown', onKey, true);
      confirm.focus({ preventScroll: true });
    },
    cancel: () => finish(null),
  };
}
