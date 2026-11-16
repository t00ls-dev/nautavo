import { importedProvider, meters, type Coord, type Route } from './core';
import { attributePlan, type AttributePiece as Piece } from './road-attributes';
import { exactSlice, indexTrack } from './track-position';
import { ValhallaLimitError, valhallaTrace } from './services';
import {
  ALIGNED,
  alignedPiece,
  compareTrack,
  coveredShare,
  MATCH_THRESHOLDS,
  rebuildTrack,
  safeResult,
  turnarounds,
  type MatchRun,
  type PieceStatus,
} from './track-match';

/**
 * Checks an imported track against the road a map matcher finds for it
 * (`valhallaTrace`, one request per piece of at most 190 km, on the routing
 * queue) and rebuilds it (`src/track-match.ts`):
 * the recorded track, with GPS glitches replaced by the road actually taken.
 * "follow" (Calculate route on an imported track) also takes the matcher's
 * maneuvers as the route's directions; "repair" (after an import) keeps the
 * route's own.
 * Stretches no road explains stay as recorded and are returned as `off`.
 */
export interface TrackCheck {
  route: Route;
  elevations?: (number | null)[][];
  /** GPS glitches replaced by the road. */
  glitches: number;
  /** Pieces whose recording the matched road stands for, whole. */
  aligned: number;
  /** Stretches the track cannot be followed exactly, along the result. */
  off: { from: number; to: number; coords: Coord[][] }[];
  /** False when some pieces could not be checked (network or server). */
  complete: boolean;
}
export type CheckOutcome =
  | { kind: 'checked'; check: TrackCheck }
  | { kind: 'limit' }
  | { kind: 'too-long' }
  | { kind: 'failed' }
  /** The result failed `safeResult`: the recorded track is kept. */
  | { kind: 'unsafe' };

/** A matched piece near at least 90% of the points sent for it. */
const COVERED = 0.9;
const share = (answer: Route | null | 'failed' | undefined, piece: Piece) =>
  answer && answer !== 'failed'
    ? coveredShare(piece.coords, answer.segments)
    : 0;
const covers = (answer: Route | null | 'failed', piece: Piece) =>
  answer === 'failed' || share(answer, piece) >= COVERED;

export async function checkTrack(
  route: Route,
  server: string,
  mode: 'repair' | 'follow',
  stops: Coord[],
  elevations?: (number | null)[][],
  isCurrent: () => boolean = () => true,
): Promise<CheckOutcome> {
  // Pieces end at U-turns, which a map matcher would fold away.
  const pieces = attributePlan(route.segments, [], turnarounds(route.segments));
  if (!pieces) return { kind: 'too-long' };
  let answers: Awaited<ReturnType<typeof valhallaTrace>>;
  try {
    answers = await valhallaTrace(server, pieces, isCurrent);
    // The car profile stops where a road is closed to cars (a mountain road,
    // a cycle path): those pieces are asked once more with the bicycle
    // profile, and its answer is kept when it covers more of the track.
    const short = pieces.filter((piece, n) => !covers(answers[n], piece));
    if (short.length) {
      const again = await valhallaTrace(server, short, isCurrent, 'bicycle');
      answers = answers.map((answer, n) => {
        const k = short.indexOf(pieces[n]);
        const other = k < 0 ? undefined : again[k];
        return other &&
          other !== 'failed' &&
          share(other, pieces[n]) > share(answer, pieces[n])
          ? other
          : answer;
      });
    }
  } catch (e) {
    return { kind: e instanceof ValhallaLimitError ? 'limit' : 'failed' };
  }
  const matched: Coord[][] = [];
  // A piece the matcher could not cover (it returned little or nothing) is
  // not checked: its track is kept as recorded and nothing is flagged there,
  // since the matcher failing says nothing about the road.
  const placed: (MatchRun | null)[] = [];
  let offset = 0;
  const statuses: PieceStatus[] = pieces.map((piece, n) => {
    const answer = answers[n];
    const ok = answer && answer !== 'failed' && covers(answer, piece);
    placed.push(null);
    if (ok) {
      matched.push(...answer.segments);
      const length = indexTrack(answer.segments).total;
      placed[n] = {
        kind: 'aligned',
        from: piece.at[0],
        to: piece.at.at(-1)!,
        mFrom: offset,
        mTo: offset + length,
      };
      offset += length;
    }
    return {
      from: piece.at[0],
      to: piece.at.at(-1)!,
      status: answer === 'failed' ? 'failed' : ok ? 'matched' : 'unmatched',
    };
  });
  const first = route.segments.flat()[0],
    last = route.segments.flat().at(-1)!;
  // The route's own start and end may move to the street; every other route
  // point stays a check.
  const inner = stops.filter(
    (c, n) =>
      !(n === 0 && meters(c, first) <= ALIGNED.ends) &&
      !(n === stops.length - 1 && meters(c, last) <= ALIGNED.ends),
  );
  const compared = compareTrack(route.segments, matched, statuses, stops);
  const rIndex = indexTrack(route.segments);
  // Each matched piece stands for its whole recording when it passes
  // `alignedPiece`; the others keep the recording, glitches repaired.
  let head = 0,
    tail = 0;
  const aligned = placed.flatMap((run, n) => {
    if (!run) return [];
    const within = (r: MatchRun) => r.from >= run.from && r.to <= run.to;
    const shift = (r: MatchRun) => ({
      ...r,
      from: r.from - run.from,
      to: r.to - run.from,
    });
    const answer = answers[n] as Route;
    const ends = alignedPiece(
      exactSlice(rIndex, run.from, run.to).map((s) => s.map((p) => p.coord)),
      answer.segments,
      inner,
      compared.filter((r) => r.kind === 'glitch' && within(r)).map(shift),
      { start: run.from <= 1, end: run.to >= rIndex.total - 1 },
    );
    if (!ends) return [];
    if (run.from <= 1) head = ends.head;
    if (run.to >= rIndex.total - 1) tail = ends.tail;
    return [{ ...run, steps: answer.steps }];
  });
  const runs = withAligned(compared, aligned);
  const rebuilt = rebuildTrack(route.segments, matched, runs, elevations);
  // The safety net: a result that skips part of the track is never used.
  const glitches = runs.filter((r) => r.kind === 'glitch');
  const ends = [
    { from: 0, to: head },
    { from: rIndex.total - tail, to: rIndex.total },
  ];
  if (
    !safeResult(
      route.segments,
      rebuilt.segments,
      [...inner, ...(head ? [] : [first]), ...(tail ? [] : [last])],
      [...glitches, ...ends],
    )
  )
    return { kind: 'unsafe' };
  const imported = importedProvider(route.provider) ?? 'Imported GPX';
  const steps =
    mode === 'follow' ? aligned.flatMap((a) => a.steps) : route.steps;
  const result: Route = {
    segments: rebuilt.segments,
    steps,
    distance: indexTrack(rebuilt.segments).total,
    duration: null,
    provider:
      mode === 'follow' ? `${imported} + Valhalla map matching` : imported,
  };
  return {
    kind: 'checked',
    check: {
      route: result,
      elevations: rebuilt.elevations,
      glitches: glitches.length,
      aligned: aligned.length,
      off: offStretches(route.segments, runs),
      complete: statuses.every((s) => s.status !== 'failed'),
    },
  };
}

/** The recorded geometry of each "off" run, for the map and the list. */
function offStretches(
  recorded: Coord[][],
  runs: MatchRun[],
): TrackCheck['off'] {
  return runs
    .filter(
      (r) => r.kind === 'off' && r.to - r.from >= MATCH_THRESHOLDS.flagLength,
    )
    .map((r) => ({
      from: r.from,
      to: r.to,
      coords: rebuildTrack(recorded, [], [{ ...r, kind: 'unknown' }]).segments,
    }));
}

/**
 * The runs with each aligned piece in place of what it covers: runs inside
 * it go, and a run reaching into it is cut at its edge and keeps the
 * recording there (a glitch cut in two can no longer use its road).
 */
function withAligned(runs: MatchRun[], aligned: MatchRun[]): MatchRun[] {
  if (!aligned.length) return runs;
  const out: MatchRun[] = [];
  for (const run of runs) {
    let parts: MatchRun[] = [run];
    for (const a of aligned)
      parts = parts.flatMap((r) => {
        if (r.to <= a.from || r.from >= a.to) return [r];
        const kind = r.kind === 'glitch' ? 'same' : r.kind;
        const cut: MatchRun[] = [];
        if (r.from < a.from) cut.push({ kind, from: r.from, to: a.from });
        if (r.to > a.to) cut.push({ kind, from: a.to, to: r.to });
        return cut;
      });
    out.push(...parts);
  }
  return [...out, ...aligned].sort((a, b) => a.from - b.from);
}
