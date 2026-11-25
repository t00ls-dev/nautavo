import {
  escapeXml,
  knownElevation,
  meters,
  validCoord,
  type Coord,
  type Route,
} from './core';
import {
  maneuverPositions,
  maneuverText,
  shortRoadName,
  stepRoad,
  stepToward,
  towardText,
} from './maneuvers';
import { isImportedRoute } from './track-legs';
import { indexTrack, legPositions, pointAtDistance } from './track-position';

/**
 * TCX course export: the full-resolution track with a course point at each
 * turn of the route's directions and at each route point, so GPS devices and
 * watches that follow a course announce the turns. Pure; texts come in
 * through `translate` (English source keys, `src/i18n.ts`).
 */

/** The TCX point types a turn maps to; the rest are Generic. */
type CueType = 'Left' | 'Right' | 'Straight' | 'Generic';
export interface Cue {
  /** Along-track distance, in meters. */
  distance: number;
  coord: Coord;
  type: CueType;
  /** Short label the device shows beside the arrow. */
  name: string;
  /** The whole instruction. */
  notes: string;
}

/** TCX schema limits: a course name and a course point name. */
const COURSE_NAME_LENGTH = 15;
const CUE_NAME_LENGTH = 10;
const ROUNDABOUT = /roundabout|rotary/;

const cut = (text: string, length: number) =>
  [...text].slice(0, length).join('').trim();

function cueType(kind: string | undefined, modifier: string | undefined) {
  if (!modifier || ROUNDABOUT.test(kind ?? '') || modifier === 'uturn')
    return 'Generic';
  if (modifier.endsWith('left')) return 'Left';
  if (modifier.endsWith('right')) return 'Right';
  return 'Straight';
}

/**
 * The course points of a route, in order along it: every maneuver of its
 * directions except the departure, the arrivals and going straight on, and
 * every route point, named by `pointName`.
 */
export function courseCues(
  route: Route,
  points: { coord: Coord | null }[],
  pointName: (index: number) => string,
  translate: (text: string) => string,
): Cue[] {
  const index = indexTrack(route.segments);
  const at = (distance: number) => pointAtDistance(index, distance)?.coord;
  const cues: Cue[] = [];
  const positions = maneuverPositions(route, !isImportedRoute(route));
  route.steps.forEach((step, i) => {
    const distance = positions[i];
    const instruction = maneuverText(step);
    const straightOn =
      (step.kind === 'continue' || step.kind === 'new name') &&
      (!step.modifier || step.modifier === 'straight');
    if (
      distance === null ||
      !instruction ||
      straightOn ||
      step.kind === 'depart' ||
      step.kind === 'arrive'
    )
      return;
    const coord = at(distance);
    if (!coord) return;
    const road = stepRoad(step);
    const toward = stepToward(step);
    const said = translate(instruction);
    const type = cueType(step.kind, step.modifier);
    // Beside the device's arrow: the road, else the sign's destination, else
    // the direction in a word; never an instruction cut mid-word.
    const label = road
      ? shortRoadName(road)
      : toward || (type === 'Generic' ? said : translate(type));
    cues.push({
      distance,
      coord,
      type,
      name: cut(label, CUE_NAME_LENGTH),
      notes: [said, road, toward && translate(towardText(toward))]
        .filter(Boolean)
        .join(' · '),
    });
  });
  const placed = points.flatMap((p, i) =>
    p.coord ? [{ i, coord: p.coord }] : [],
  );
  legPositions(
    route.segments,
    placed.map((p) => p.coord),
  ).forEach((distance, n) => {
    if (distance === null) return;
    const name = pointName(placed[n].i);
    cues.push({
      distance,
      coord: placed[n].coord,
      type: 'Generic',
      name: cut(name, CUE_NAME_LENGTH),
      notes: name,
    });
  });
  return cues.sort((a, b) => a.distance - b.distance);
}

const time = (ms: number) =>
  new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const position = ([lat, lon]: Coord) =>
  `<Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position>`;

/**
 * A TCX course of the route. The schema requires a time at every point:
 * they follow the traveler's average speed from `date`, as the planner's
 * own times do. Each GPX segment is its own track, so a gap is not crossed.
 */
export function generateTcx(
  route: Route,
  name: string,
  cues: Cue[],
  {
    speedKmh,
    date = new Date(),
    elevations,
  }: {
    speedKmh: number;
    date?: Date;
    /** Elevation per track point, parallel to the segments, when known. */
    elevations?: (number | null)[][] | undefined;
  },
): string {
  if (
    !route.segments.length ||
    route.segments.some((s) => s.length < 2 || s.some((p) => !validCoord(p)))
  )
    throw new Error('No valid route geometry to export.');
  const speed = speedKmh / 3.6;
  const start = date.getTime();
  const when = (distance: number) => time(start + (distance / speed) * 1000);
  let total = 0;
  const tracks = route.segments.map((segment, k) => {
    const points = segment.map((coord, i) => {
      if (i) total += meters(segment[i - 1], coord);
      const ele = knownElevation(elevations?.[k]?.[i]);
      const altitude =
        ele === null ? '' : `<AltitudeMeters>${ele}</AltitudeMeters>`;
      return `<Trackpoint><Time>${when(total)}</Time>${position(coord)}${altitude}<DistanceMeters>${total.toFixed(1)}</DistanceMeters></Trackpoint>`;
    });
    return `<Track>${points.join('')}</Track>`;
  });
  const first = route.segments[0][0];
  const last = route.segments.at(-1)!.at(-1)!;
  const tag = escapeXml;
  const coursePoints = cues.map(
    (cue) =>
      `<CoursePoint><Name>${tag(cue.name)}</Name><Time>${when(cue.distance)}</Time>${position(cue.coord)}<PointType>${cue.type}</PointType><Notes>${tag(cue.notes)}</Notes></CoursePoint>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>${tag(cut(name, COURSE_NAME_LENGTH))}</Name><Lap><TotalTimeSeconds>${Math.round(total / speed)}</TotalTimeSeconds><DistanceMeters>${total.toFixed(1)}</DistanceMeters><BeginPosition><LatitudeDegrees>${first[0]}</LatitudeDegrees><LongitudeDegrees>${first[1]}</LongitudeDegrees></BeginPosition><EndPosition><LatitudeDegrees>${last[0]}</LatitudeDegrees><LongitudeDegrees>${last[1]}</LongitudeDegrees></EndPosition><Intensity>Active</Intensity></Lap>${tracks.join('')}${coursePoints.join('')}</Course></Courses></TrainingCenterDatabase>\n`;
}
