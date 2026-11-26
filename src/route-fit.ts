import type { Coord } from './core';
import { byId as $ } from './dom';
import {
  clearInsets,
  sameInsets,
  widestInsets,
  type Insets,
  type PlannerMap,
} from './planner-map';

/**
 * Framing the route on the planner map clear of the interface drawn over it,
 * and framing it again while the map still shows that fit.
 */
/** Pixels kept between the route's markers and whatever covers the map. */
const FIT_GAP = 12;
/** Fewer pixels than this left for the route: the covers are left out. */
const FIT_MIN_SPACE = 48;

export function createRouteFit(map: PlannerMap, coords: () => Coord[]) {
  /**
   * Padding that frames the route clear of the interface drawn over the map
   * (the bottom sheet and header on phones, the map note, the map tools and
   * legend corners and the credits) with its markers whole; passing notices
   * are left out. An axis left with less than `FIT_MIN_SPACE` (the full-height
   * sheet) keeps only the markers' reach.
   */
  function fitPadding(): Insets {
    const element = $('map'),
      box = element.getBoundingClientRect();
    const over = [
      $('sheet'),
      $('sheet').querySelector('header'),
      $('map-note'),
      // The elevation strip under the map on wide screens (#305).
      document.querySelector('.elevation-strip #elevation[open]'),
      ...element.querySelectorAll(
        ':scope > .map-corner, :scope > .map-credits',
      ),
    ].filter((e): e is Element => !!e && e.getClientRects().length > 0);
    const covers = clearInsets(
        box,
        over.map((e) => e.getBoundingClientRect()),
      ),
      reach = map.markerReach();
    const padding = (edge: keyof Insets, withCovers: boolean) =>
      (withCovers ? covers[edge] : 0) + reach[edge] + FIT_GAP;
    const room = (size: number, a: keyof Insets, b: keyof Insets) =>
      size - padding(a, true) - padding(b, true) >= FIT_MIN_SPACE;
    const vertical = room(box.bottom - box.top, 'top', 'bottom'),
      horizontal = room(box.right - box.left, 'left', 'right');
    return {
      top: padding('top', vertical),
      bottom: padding('bottom', vertical),
      left: padding('left', horizontal),
      right: padding('right', horizontal),
    };
  }
  /** The map's camera, or 'pending' before the map exists. */
  function viewKey(): string {
    const gl = map.gl();
    return gl
      ? `${gl.getCenter().toArray().join()} ${gl.getZoom()} ${gl.getBearing()}`
      : 'pending';
  }
  /**
   * The last route fit: its coordinates, padding and the camera it left, until
   * something else moves the map.
   */
  let fitted: { pts: Coord[]; padding: Insets; view: string } | null = null;
  function fitTo(pts: Coord[], padding: Insets) {
    map.fit(pts, { padding, maxZoom: 14 });
    const done = { pts, padding, view: viewKey() };
    fitted = done;
    // Before the map exists, the fit is done when it does: remember that view.
    if (done.view === 'pending')
      map.ready(() => {
        if (fitted === done) done.view = viewKey();
      });
  }
  function fit() {
    const pts = coords();
    if (pts.length) fitTo(pts, fitPadding());
  }
  /**
   * Fits the same coordinates again once the sheet, the map's size or the
   * route's markers change, as long as the map still shows the last fit: a
   * pan, zoom or any other move since then keeps the view, and an edited point
   * never moves it. Marker changes only widen the padding, since the markers
   * themselves change with the zoom (weather clusters), so the view settles
   * instead of swinging.
   */
  function refit(widenOnly: boolean) {
    if (!fitted) return;
    if (fitted.view !== viewKey()) {
      fitted = null;
      return;
    }
    const last = fitted.padding,
      next = fitPadding();
    const padding = widenOnly ? widestInsets(last, next) : next;
    if (sameInsets(padding, last)) return;
    fitTo(fitted.pts, padding);
  }
  let refitTimer = 0;
  /** Once a sheet drag or transition, or a resize, has settled. */
  function refitSoon() {
    clearTimeout(refitTimer);
    refitTimer = window.setTimeout(() => refit(false), 150);
  }
  new ResizeObserver(() => {
    map.resize();
    refitSoon();
  }).observe($('map'));
  new ResizeObserver(refitSoon).observe($('sheet'));
  // At once, in the batch that drew the markers, so they never show covered.
  map.onFramedChange(() => refit(true));
  return { fit, padding: fitPadding };
}
