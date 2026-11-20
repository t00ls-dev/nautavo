import type { PlannerMap } from './planner-map';
import { icon, iconControl } from './icons';
import { byId as $ } from './dom';
import { sharesFirst } from './share-file';
import { readSession, SESSION, writeSession } from './preferences';

/**
 * The phone layout: a narrow screen, or a short one (a phone in landscape),
 * where the route panel is a sheet over the map; the same queries are in
 * `style.css`.
 */
const COMPACT = '(max-width: 759px), (max-height: 500px)';
export const compactLayout = (): boolean => matchMedia(COMPACT).matches;
/** A phone in landscape: the sheet is a panel on the left, never dragged (#252). */
const SIDE_SHEET = '(orientation: landscape) and (max-height: 500px)';
/** The open sheet covers the map: showing a place there closes it first. */
export const sheetCoversMap = (): boolean =>
  compactLayout() && !matchMedia(SIDE_SHEET).matches;

/**
 * With no point set, Saved routes and Favorite places come right below the
 * points, where a visit starts (#213); once one is set, they return below
 * the route details. Moved in the page, so the focus order follows.
 */
export function placeLibrary(first: boolean): void {
  const lists = document.querySelectorAll('.saved-routes, .favorites');
  if (first) $('trip-options').before(...lists);
  else $('route-details').after(...lists);
}

type SheetSize = 'half' | 'full';
/** Snap heights of the open sheet; the same numbers are in `style.css`. */
function sheetHeights(): Record<SheetSize, number> {
  const view = window.innerHeight;
  // `--safe-top` as the stylesheet resolves it: the status strip is that tall.
  const safeTop =
    document.querySelector('.top-edge')?.getBoundingClientRect().height ?? 0;
  return {
    half: Math.min(0.55 * view, Math.max(260, view - 310)),
    full: view - 60 - safeTop,
  };
}
const DRAG_THRESHOLD = 8;

/**
 * The route panel around the map: a sidebar on wide screens and a bottom
 * sheet on phones. The sheet is closed (status and export actions only), half
 * or full height; the handle toggles it and can be dragged between heights.
 * Also the panel's icons, the More actions disclosure and the Settings dialog.
 */
export function setupPanel(map: PlannerMap): void {
  iconControl($('add'), 'plus', 'Add stop');
  iconControl($('reverse'), 'swap', 'Reverse');
  iconControl($('roundtrip'), 'roundtrip', 'Round trip');
  iconControl($('calculate'), 'refresh', 'Calculate route');
  // Touch devices that can share files share the GPX instead (main.ts).
  if (sharesFirst()) iconControl($('download'), 'share', 'Share GPX');
  else iconControl($('download'), 'download', 'Download GPX');
  iconControl($('share'), 'link', 'Copy link');
  $('share').title = 'Copy route link';
  iconControl($('share-gpx'), 'share', 'Share GPX');
  iconControl($('more-actions'), 'more', 'More actions', true);
  iconControl($('open-settings'), 'settings', 'Settings', true);
  iconControl($('close-settings'), 'close', 'Close settings', true);
  document
    .querySelector('.secondary-actions .file-button')!
    .prepend(icon('upload'));

  const sheet = $('sheet'),
    handle = $('panel-toggle'),
    panel = $('route-panel');
  // Wide screens show the toggle as an icon in the sidebar header.
  handle.append(icon('sidebar'));
  handle.title = 'Route panel';
  let open = true,
    size: SheetSize = 'half';
  open = readSession(SESSION.panelOpen) !== 'false';
  if (readSession(SESSION.panelSize) === 'full') size = 'full';
  /** The height a focused point field raised the sheet from (#204). */
  let raisedFrom: SheetSize | null = null;
  let lowerTimer = 0;
  // Called when the traveler moves the sheet: their height wins.
  const remember = () => {
    raisedFrom = null;
    writeSession(SESSION.panelOpen, String(open));
    writeSession(SESSION.panelSize, size);
  };
  const layout = () => {
    document.body.classList.toggle('panel-closed', !open);
    document.body.classList.toggle('sheet-full', open && size === 'full');
    panel.hidden = !open;
    handle.setAttribute('aria-expanded', String(open));
    requestAnimationFrame(() => map.resize());
  };
  new ResizeObserver(() => {
    document.body.style.setProperty(
      '--sheet-height',
      `${sheet.getBoundingClientRect().height}px`,
    );
  }).observe(sheet);

  const toggle = () => {
    open = !open;
    remember();
    layout();
  };
  // Dragging the handle resizes the sheet; a press without movement toggles
  // it on release. Browsers may drop the click of a tap that follows a drag
  // (tap suppression after a fling), so taps do not rely on `click`.
  let drag: { id: number; y: number; height: number; moved: boolean } | null =
    null;
  let pointerToggle = -Infinity;
  handle.addEventListener('pointerdown', (event) => {
    if (!compactLayout() || matchMedia(SIDE_SHEET).matches) return;
    if (event.button > 0) return;
    drag = {
      id: event.pointerId,
      y: event.clientY,
      height: sheet.getBoundingClientRect().height,
      moved: false,
    };
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = drag.y - event.clientY;
    if (!drag.moved) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      handle.setPointerCapture(event.pointerId);
      // The panel shows while the sheet follows the finger.
      document.body.classList.remove('panel-closed');
      document.body.classList.add('sheet-dragging');
      panel.hidden = false;
    }
    sheet.style.height = `${Math.max(
      handle.offsetHeight,
      Math.min(sheetHeights().full, drag.height + dy),
    )}px`;
  });
  const release = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    // Any click that follows this press belongs to it.
    pointerToggle = event.timeStamp;
    if (!moved) {
      if (event.type === 'pointerup') toggle();
      return;
    }
    const height = sheet.getBoundingClientRect().height;
    const { half, full } = sheetHeights();
    sheet.style.height = '';
    document.body.classList.remove('sheet-dragging');
    open = height > half / 2;
    if (open) size = height > (half + full) / 2 ? 'full' : 'half';
    remember();
    layout();
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  handle.addEventListener('click', (event) => {
    // Keyboard and programmatic clicks have no pointer press before them.
    if (event.detail > 0 && event.timeStamp - pointerToggle < 1000) return;
    toggle();
  });
  // Arrow keys move the sheet between closed, half and full height.
  handle.addEventListener('keydown', (event) => {
    if (!compactLayout()) return;
    const steps = ['closed', 'half', 'full'] as const;
    const at = steps.indexOf(open ? size : 'closed');
    const next =
      event.key === 'ArrowUp'
        ? Math.min(2, at + 1)
        : event.key === 'ArrowDown'
          ? Math.max(0, at - 1)
          : -1;
    if (next < 0) return;
    event.preventDefault();
    open = next > 0;
    if (open) size = steps[next] as SheetSize;
    remember();
    layout();
  });
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  // On the sheet the route's numbers come first, above the points (#206).
  // The element moves rather than being reordered by CSS, so the focus order
  // follows what is seen.
  const summary = $('summary'),
    points = panel.querySelector('.points-section')!,
    afterSummary = $('trip-options');
  const placeSummary = () =>
    compactLayout() ? points.before(summary) : afterSummary.before(summary);
  placeSummary();
  matchMedia(COMPACT).addEventListener('change', placeSummary);

  // A point field brings its menu into view (#204): on the sheet, focusing
  // it raises the sheet to full height and scrolls the field to the top of
  // the panel. Leaving the point fields puts the sheet back, unless the
  // traveler moved it meanwhile: at once when focus moves elsewhere, and a
  // moment later when it just goes (a tap on the menu that blurred the field
  // first, as on iOS), so that tap still lands where it was aimed.
  const fields = $('points');
  const inField = (element: Element | null) =>
    !!element && fields.contains(element) && element.matches('input');
  const lower = () => {
    clearTimeout(lowerTimer);
    if (raisedFrom === null || inField(document.activeElement)) return;
    if (open && size === 'full') {
      size = raisedFrom;
      layout();
    }
    raisedFrom = null;
  };
  fields.addEventListener('focusin', (event) => {
    const field = event.target as HTMLElement;
    if (!compactLayout() || !open || !inField(field)) return;
    clearTimeout(lowerTimer);
    if (raisedFrom === null && size !== 'full') {
      raisedFrom = size;
      size = 'full';
      layout();
    }
    const top =
      field.getBoundingClientRect().top -
      panel.getBoundingClientRect().top +
      panel.scrollTop;
    panel.scrollTo({ top: top - 8 });
  });
  fields.addEventListener('focusout', (event) => {
    if (raisedFrom === null) return;
    clearTimeout(lowerTimer);
    if (event.relatedTarget) {
      if (!inField(event.relatedTarget as Element)) lower();
    } else lowerTimer = window.setTimeout(lower, 300);
  });

  const more = $('more-actions');
  more.onclick = () => {
    const expanded = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(expanded));
    document.body.classList.toggle('more-open', expanded);
  };

  // The closed sheet still shows the latest status message.
  const mirror = () => {
    $('peek-status').textContent = $('status').textContent;
    $('panel-toggle').classList.toggle(
      'error',
      $('status').classList.contains('error'),
    );
  };
  new MutationObserver(mirror).observe($('status'), {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  mirror();

  const dialog = $<HTMLDialogElement>('settings-dialog');
  $('open-settings').onclick = () => {
    $('settings-status').textContent = '';
    dialog.showModal();
  };
  $('close-settings').onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => $('open-settings').focus());
}
