import { icon, iconControl } from './icons';
import { isolate, type PlannerMap } from './planner-map';
import { byId as $, optionalById } from './dom';
import { popupMenu } from './popup-menu';

/** A corner of the map holding controls, above the map's own layers. */
export function mapCorner(
  map: PlannerMap,
  position: 'top-right' | 'bottom-left',
): HTMLElement {
  const id = `map-corner-${position}`;
  let corner = optionalById(id);
  if (!corner) {
    corner = document.createElement('div');
    corner.id = id;
    corner.className = `map-corner map-${position}`;
    map.container.append(corner);
  }
  return corner;
}

/** Zoom buttons for pointers without pinch (hidden on phones). */
function zoomControl(map: PlannerMap): HTMLElement {
  const box = document.createElement('div');
  box.className = 'map-zoom map-control';
  for (const [kind, label, symbol] of [
    ['in', 'Zoom in', '+'],
    ['out', 'Zoom out', '−'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `map-zoom-${kind}`;
    button.textContent = symbol;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.onclick = () => (kind === 'in' ? map.zoomIn() : map.zoomOut());
    box.append(button);
  }
  return box;
}

/**
 * The compass: shown only on a turned map, its needle pointing to the map's
 * north; a press puts north up again.
 */
function compassControl(map: PlannerMap): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'compass';
  button.className = 'map-compass map-control';
  button.hidden = true;
  iconControl(button, 'compass', 'North up', true);
  const needle = button.querySelector<SVGSVGElement>('svg')!;
  button.onclick = () => map.gl()?.resetNorth();
  map.on('rotate', () => {
    const bearing = Math.round(map.getBearing() * 10) / 10 || 0;
    button.hidden = !bearing;
    needle.style.transform = bearing ? `rotate(${-bearing}deg)` : '';
  });
  return button;
}

export function setupMapControls(map: PlannerMap) {
  iconControl($('locate'), 'locate', 'Use my location');
  iconControl($('layers-toggle'), 'layers', 'Map layers');
  iconControl($('fit'), 'route', 'Fit route');
  iconControl($('map-more'), 'more', 'More map tools');
  // Full screen and Lock editing wait in the More menu (#307), with their
  // names shown.
  iconControl($('fullscreen'), 'maximize', 'Full screen');
  $('fullscreen').prepend(icon('minimize'));
  iconControl($('lock'), 'unlock', 'Lock editing');
  $('lock').prepend(icon('lock'));
  popupMenu($('map-more'), $('map-menu'));
  const container = document.createElement('div');
  container.className = 'map-action-control map-control';
  const group = document.createElement('div');
  group.className = 'map-tool-group';
  group.append(
    $('locate'),
    $('layers-toggle').parentElement!,
    $('fit'),
    $('map-more').parentElement!,
  );
  container.append(group);
  document.querySelector('.map-tools')?.remove();
  const zoom = zoomControl(map);
  const compass = compassControl(map);
  isolate(container);
  isolate(compass);
  isolate(zoom);
  mapCorner(map, 'top-right').append(container, compass, zoom);
  // The canvas takes keyboard focus; the hint describes it.
  map.ready((gl) =>
    gl.getCanvas().setAttribute('aria-describedby', 'map-note'),
  );
  window.addEventListener('resize', () => map.resize());
}
