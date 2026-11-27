import { popupMenu } from './popup-menu';
import type { PlannerMap } from './planner-map';
import { type IconName, icon, iconControl } from './icons';
import { byId as $, text } from './dom';
import { sharesFirst } from './share-file';
import { readSession, SESSION, writeSession } from './preferences';
import { swallowNextClick } from './touch-click';

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
/** Height of the map left in view above the bottom sheet, in pixels. */
export function visibleMapHeight(container: HTMLElement): number {
  const box = container.getBoundingClientRect();
  if (!sheetCoversMap()) return box.height;
  const top = $('sheet').getBoundingClientRect().top - box.top;
  return Math.min(box.height, Math.max(0, top));
}

/**
 * With no point set, Saved routes and Favorite places come right below the
 * points, where a visit starts (#213); once one is set, they return below
 * the route details. Moved in the page, so the focus order follows.
 */
export function placeLibrary(first: boolean): void {
  const lists = document.querySelectorAll('.saved-routes, .favorites');
  if (first) $('start-options').after(...lists);
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
/** Inside the panel, what keeps its own drag rather than moving the sheet. */
const OWN_GESTURES =
  'input, textarea, select, [contenteditable="true"], .point-grip, .chart-frame';

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
  // The Export menu (#301): touch devices that can share files share them
  // instead (main.ts); each choice says what it is for.
  const shares = sharesFirst();
  const exportIcon = shares ? 'share' : 'download';
  const exportChoice = (
    id: string,
    name: IconName,
    label: string,
    note?: string,
  ) => {
    const control = $(id);
    iconControl(control, name, label);
    if (note)
      control
        .querySelector('.button-label')!
        .append(text('span', note, 'export-note'));
  };
  exportChoice(
    'download',
    exportIcon,
    shares ? 'Share GPX' : 'Download GPX',
    'The complete track, for any app or device',
  );
  // Courses with their turns, for GPS devices and watches (#288).
  exportChoice(
    'download-tcx',
    exportIcon,
    shares ? 'Share TCX with turns' : 'Download TCX with turns',
    'A course that announces the turns on GPS devices',
  );
  exportChoice(
    'download-fit',
    exportIcon,
    shares ? 'Share FIT with turns' : 'Download FIT with turns',
    'A course for Garmin, Wahoo and similar devices',
  );
  exportChoice('share-gpx', 'share', 'Share GPX');
  exportChoice(
    'share',
    'link',
    'Copy link',
    'Opening it calculates the route again',
  );
  $('share').title = 'Copy route link';
  iconControl($('save-route'), 'bookmark', 'Save route');
  iconControl($('export'), exportIcon, 'Export');
  iconControl($('more-actions'), 'more', 'More actions', true);
  iconControl($('open-settings'), 'settings', 'Settings', true);
  iconControl($('close-settings'), 'close', 'Close settings', true);
  document
    .querySelector('.secondary-actions .file-button')!
    .prepend(icon('upload'));
  // Travel the route replays it, as the replay's own play button shows.
  $('travel-route').prepend(icon('play'));
  iconControl($('library-import'), 'upload', 'Import GPX, FIT or TCX');
  $('library-import').onclick = () => $('import').click();

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
  type Drag = { y: number; height: number; moved: boolean };
  let drag: (Drag & { id: number }) | null = null;
  let pointerToggle = -Infinity;
  const sheetDrags = () => compactLayout() && !matchMedia(SIDE_SHEET).matches;
  const startDrag = (y: number): Drag => ({
    y,
    height: sheet.getBoundingClientRect().height,
    moved: false,
  });
  /** Follows the finger once it has moved; false while it has not. */
  const followDrag = (move: Drag, y: number, capture: () => void) => {
    const dy = move.y - y;
    if (!move.moved) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return false;
      move.moved = true;
      capture();
      // The panel shows while the sheet follows the finger.
      document.body.classList.remove('panel-closed');
      document.body.classList.add('sheet-dragging');
      panel.hidden = false;
    }
    sheet.style.height = `${Math.max(
      handle.offsetHeight,
      Math.min(sheetHeights().full, move.height + dy),
    )}px`;
    return true;
  };
  /** Settles a moved sheet on the nearest height: closed, half or full. */
  const settle = () => {
    const height = sheet.getBoundingClientRect().height;
    const { half, full } = sheetHeights();
    sheet.style.height = '';
    document.body.classList.remove('sheet-dragging');
    open = height > half / 2;
    if (open) size = height > (half + full) / 2 ? 'full' : 'half';
    remember();
    layout();
  };
  handle.addEventListener('pointerdown', (event) => {
    if (!sheetDrags() || event.button > 0) return;
    drag = { id: event.pointerId, ...startDrag(event.clientY) };
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    followDrag(drag, event.clientY, () =>
      handle.setPointerCapture(event.pointerId),
    );
  });
  const release = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    // Any click that follows this press belongs to it.
    pointerToggle = event.timeStamp;
    if (!moved) {
      if (event.type === 'pointerup') {
        toggle();
        // The sheet just moved: the click that follows would land on the
        // map or the panel now under the finger.
        swallowNextClick();
      }
      return;
    }
    settle();
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  handle.addEventListener('click', (event) => {
    // Keyboard and programmatic clicks have no pointer press before them.
    if (event.detail > 0 && event.timeStamp - pointerToggle < 1000) return;
    toggle();
  });
  // The whole panel drags the sheet too, by touch, so the finger need not
  // find the handle: a vertical drag that would not scroll the panel, that
  // is upward while the sheet is below full height, or downward with the
  // panel at its top. Fields, sliders, the points' grips and the charts keep
  // their own gestures, and a sideways drag stays the browser's.
  let touchDrag: (Drag & { id: number; x: number; sheet?: boolean }) | null =
    null;
  panel.addEventListener(
    'touchstart',
    (event) => {
      touchDrag = null;
      const [touch] = event.touches;
      if (event.touches.length !== 1 || !touch || !sheetDrags()) return;
      if (event.target instanceof Element && event.target.closest(OWN_GESTURES))
        return;
      touchDrag = {
        id: touch.identifier,
        x: touch.clientX,
        ...startDrag(touch.clientY),
      };
    },
    { passive: true },
  );
  panel.addEventListener(
    'touchmove',
    (event) => {
      const touch = [...event.changedTouches].find(
        (item) => item.identifier === touchDrag?.id,
      );
      if (!touchDrag || !touch) return;
      if (touchDrag.sheet === undefined) {
        const dx = Math.abs(touch.clientX - touchDrag.x);
        const up = touchDrag.y - touch.clientY;
        if (dx === 0 && up === 0) return;
        touchDrag.sheet =
          Math.abs(up) > dx &&
          (up > 0 ? !(open && size === 'full') : panel.scrollTop <= 0);
      }
      if (!touchDrag.sheet) return;
      event.preventDefault();
      followDrag(touchDrag, touch.clientY, () => undefined);
    },
    { passive: false },
  );
  const touchRelease = (event: TouchEvent) => {
    const ended = [...event.changedTouches].some(
      (item) => item.identifier === touchDrag?.id,
    );
    if (!touchDrag || !ended) return;
    const moved = touchDrag.moved;
    touchDrag = null;
    if (moved) settle();
  };
  panel.addEventListener('touchend', touchRelease);
  panel.addEventListener('touchcancel', touchRelease);
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

  // The route's numbers, its trip options and its tabs come first, above the
  // points, which are the first tab (#206, #305). The elements move rather
  // than being reordered by CSS, so the focus order follows what is seen.
  const points = panel.querySelector('.points-section')!;
  points.before(
    $('summary'),
    $('trip-options'),
    $('daylight-alert'),
    $('route-tabs'),
  );
  // On wide screens Elevation opens in a strip under the map (#305), where
  // its profile has the map's width; on the sheet it is one of the tabs.
  const placeElevation = () => {
    if (compactLayout()) $('route-details').append($('elevation'));
    else $('elevation-strip').append($('elevation'));
  };
  placeElevation();
  matchMedia(COMPACT).addEventListener('change', placeElevation);

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
    if (expanded) showExports(false);
  };
  // Export opens its menu above the action bar (#301).
  const showExports = popupMenu($('export'), $('export-menu'), () => {
    more.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('more-open');
  });

  // The closed sheet still shows the latest status message.
  const mirror = () => {
    $('peek-status').textContent = $('status').textContent;
    $('peek-status').toggleAttribute(
      'data-empty-prompt',
      $('status').hasAttribute('data-empty-prompt'),
    );
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
    attributeFilter: ['class', 'data-empty-prompt'],
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
