import { byId as $ } from './dom';

/**
 * The route's tabs (#305): Points, then the analyses (Itinerary, Weather,
 * Elevation), one shown at a time below the summary. Each
 * analysis stays the `<details>` it was: choosing its tab opens it, which is
 * still the explicit choice that loads its data, and closes the others; on
 * wide screens Elevation opens in the strip under the map instead and is no
 * tab. A section opened from elsewhere (the summary's notes, a weather
 * marker) selects its tab.
 */
const PANELS = [
  'points-section',
  'itinerary',
  'weather-section',
  'elevation',
] as const;
type Panel = (typeof PANELS)[number];

/** The `<details>` an analysis tab opens; the Itinerary's is rebuilt with each route. */
function detailsOf(panel: Panel): HTMLDetailsElement | null {
  if (panel === 'points-section') return null;
  const element = $(panel);
  return element instanceof HTMLDetailsElement
    ? element
    : element.querySelector('details');
}

export function setupRouteTabs(options: {
  /** Whether Elevation lives in the strip under the map. */
  elevationInStrip: () => boolean;
}) {
  const panel = $('route-panel');
  let selected: Panel = 'points-section';
  const tabOf = (id: Panel) =>
    $(`tab-${id === 'points-section' ? 'points' : id}`);
  const inTabs = (id: Panel) =>
    !(id === 'elevation' && options.elevationInStrip());

  function select(id: Panel, focus = false) {
    selected = id;
    panel.dataset.tab = id;
    for (const other of PANELS) {
      const tab = tabOf(other);
      tab.setAttribute('aria-selected', String(other === id));
      tab.tabIndex = other === id ? 0 : -1;
      const details = detailsOf(other);
      if (details && inTabs(other) && other !== id && details.open)
        details.open = false;
    }
    const details = detailsOf(id);
    if (details && !details.open) details.open = true;
    if (focus) tabOf(id).focus();
  }

  for (const id of PANELS) tabOf(id).onclick = () => select(id);
  // Arrow keys move between the shown tabs, as a tab list does.
  $('route-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const shown = PANELS.filter(
      (id) => !tabOf(id).hidden && tabOf(id).offsetParent !== null,
    );
    const at = shown.indexOf(selected);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? shown.length - 1
          : (at + (event.key === 'ArrowRight' ? 1 : shown.length - 1)) %
            shown.length;
    event.preventDefault();
    select(shown[next], true);
  });
  // `toggle` does not bubble: listen while it passes down to the section.
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      const id = PANELS.find((p) => detailsOf(p) === details);
      if (!id || !inTabs(id)) return;
      if (details.open && id !== selected) select(id);
      else if (!details.open && id === selected) select('points-section');
    },
    true,
  );
  select('points-section');
  return { select };
}
