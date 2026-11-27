import type { Coord, Route, State } from './core';
import {
  attributePlan,
  edgeRanges,
  MAX_PIECES,
  type EdgeRange,
} from './road-attributes';
import { ValhallaLimitError, valhallaAttributes } from './valhalla-trace';
import { surfaceRanges, surfaceTotals, type SurfaceRange } from './surface';
import { onlineAttempt } from './offline';
import { indexTrack, legDistances } from './track-position';

/**
 * The surface of the route, for its coloring in Map layers (#305: no tab):
 * paved and unpaved stretches and their share of the route. Road
 * attributes are asked from Valhalla only when the Surface coloring is
 * chosen, and stay in page memory.
 */

/** Quiet time before asking for a new route while the coloring is on. */
const SETTLE_MS = 2000;

export function setupSurface(deps: {
  state: () => State;
  /** The explicit user choice that needs the surface (the Surface coloring). */
  wanted: () => boolean;
  /** Called when the surface or its status changes, so its users redraw. */
  onSurface: () => void;
}) {
  /** Surface that failed offline waits for the connection (one attempt). */
  const whenOnline = onlineAttempt();
  let route: Route | null = null,
    ranges: SurfaceRange[] | null = null,
    status: { text: string; error: boolean } | null = null,
    revision = 0,
    settle: ReturnType<typeof setTimeout> | undefined;

  function message(text: string, error = false) {
    status = text ? { text, error } : null;
    deps.onSurface();
  }
  /** Offline: says so and asks once more when the connection returns. */
  function offline(current: () => boolean): boolean {
    const waiting = whenOnline(() => {
      if (current()) void load();
    });
    if (waiting)
      message(
        'No connection. The surface will load when the connection returns.',
      );
    return waiting;
  }

  /** Along-track distance of each route point, so pieces restart there. */
  function legBounds(target: Route): number[] {
    const points = (
      target.snapped ?? deps.state().points.map((p) => p.coord)
    ).filter((c): c is Coord => !!c);
    return legDistances(target.segments, points);
  }

  async function load() {
    if (!route || !deps.wanted() || ranges) return;
    const target = route,
      mine = ++revision;
    const current = () => route === target && revision === mine;
    const plan = attributePlan(target.segments, legBounds(target));
    if (!plan) {
      message(
        `Surface is not available for this route: it would need more than ${MAX_PIECES} requests.`,
      );
      return;
    }
    message('Loading surface…');
    try {
      const results = await valhallaAttributes(
        deps.state().valhalla,
        plan,
        current,
      );
      if (!current()) return;
      if (results.every((r) => r === 'failed')) {
        if (!offline(current)) message('Surface unavailable.', true);
        return;
      }
      const edges: EdgeRange[] = results.flatMap((r, i) =>
        r && r !== 'failed' ? edgeRanges(plan[i], r) : [],
      );
      ranges = surfaceRanges(edges, indexTrack(target.segments).total);
      message('');
    } catch (error) {
      if (!current() || (error as Error).name === 'AbortError') return;
      if (!(error instanceof ValhallaLimitError) && offline(current)) return;
      message(
        error instanceof ValhallaLimitError
          ? error.message
          : 'Surface unavailable.',
        true,
      );
    }
  }

  return {
    /** A new route resets the surface; the coloring asks again once settled. */
    setRoute(next: Route | null) {
      if (next === route) return;
      route = next;
      ranges = null;
      revision++;
      clearTimeout(settle);
      message(route && deps.wanted() ? 'Loading surface…' : '');
      if (route && deps.wanted())
        settle = setTimeout(() => void load(), SETTLE_MS);
    },
    /** Surface ranges of the current route, when loaded. */
    ranges: () => ranges,
    /** Each kind's share of the route, as the legend shows it. */
    share(kind: string): string | null {
      if (!ranges) return null;
      const total = ranges.reduce((sum, r) => sum + r.to - r.from, 0);
      const length =
        surfaceTotals(ranges).find((t) => t.kind === kind)?.length ?? 0;
      if (!total) return null;
      const percent = Math.round((length / total) * 100);
      return `${percent < 1 ? '<1' : percent}%`;
    },
    /** Loading or failed, for the legend; a failed piece shows as Unknown. */
    status(): { text: string; retry?: () => void } | null {
      if (status)
        return status.error
          ? { text: status.text, retry: () => void load() }
          : { text: status.text };
      return null;
    },
    /** The coloring was turned on: load it now if still missing. */
    want() {
      if (route && !ranges && deps.wanted()) {
        clearTimeout(settle);
        void load();
      }
    },
  };
}
