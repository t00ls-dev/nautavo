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
import {
  encodeFit,
  FIT_MESSAGE,
  FIT_TIMESTAMP,
  fitStringSize,
  fitTime,
  semicircles,
  type FitMessage,
} from './fit';
import { isImportedRoute } from './track-legs';
import { indexTrack, legPositions, pointAtDistance } from './track-position';

/**
 * Course exports, TCX and FIT: the full-resolution track with a course point
 * at each turn of the route's directions and at each route point, so GPS
 * devices and watches that follow a course announce the turns. Pure; texts
 * come in through `translate` (English source keys, `src/i18n.ts`).
 */

/** The TCX point types a turn maps to; the rest are Generic. */
type CueType = 'Left' | 'Right' | 'Straight' | 'Generic';
export interface Cue {
  /** Along-track distance, in meters. */
  distance: number;
  coord: Coord;
  type: CueType;
  /** Short label the device shows beside the arrow, cut by each format. */
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
      name: label.trim(),
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
      name: name.trim(),
      notes: name,
    });
  });
  return cues.sort((a, b) => a.distance - b.distance);
}

const time = (ms: number) =>
  new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const position = ([lat, lon]: Coord) =>
  `<Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position>`;

interface CourseOptions {
  speedKmh: number;
  date?: Date;
  /** Elevation per track point, parallel to the segments, when known. */
  elevations?: (number | null)[][] | undefined;
}

/**
 * What both courses share: the along-track distance of every track point (a
 * segment gap adds none) and the time at a distance. Formats require a time
 * at every point: they follow the traveler's average speed from `date`, as
 * the planner's own times do.
 */
function courseTrack(route: Route, { speedKmh, date }: CourseOptions) {
  if (
    !route.segments.length ||
    route.segments.some((s) => s.length < 2 || s.some((p) => !validCoord(p)))
  )
    throw new Error('No valid route geometry to export.');
  let total = 0;
  const distances = route.segments.map((segment) =>
    segment.map((coord, i) => (total += i ? meters(segment[i - 1], coord) : 0)),
  );
  const speed = speedKmh / 3.6;
  const start = (date ?? new Date()).getTime();
  return {
    distances,
    total,
    start,
    seconds: total / speed,
    at: (distance: number) => start + (distance / speed) * 1000,
  };
}

/** A TCX course of the route. Each GPX segment is its own track. */
export function generateTcx(
  route: Route,
  name: string,
  cues: Cue[],
  options: CourseOptions,
): string {
  const course = courseTrack(route, options);
  const when = (distance: number) => time(course.at(distance));
  const tracks = route.segments.map((segment, k) => {
    const points = segment.map((coord, i) => {
      const distance = course.distances[k][i];
      const ele = knownElevation(options.elevations?.[k]?.[i]);
      const altitude =
        ele === null ? '' : `<AltitudeMeters>${ele}</AltitudeMeters>`;
      return `<Trackpoint><Time>${when(distance)}</Time>${position(coord)}${altitude}<DistanceMeters>${distance.toFixed(1)}</DistanceMeters></Trackpoint>`;
    });
    return `<Track>${points.join('')}</Track>`;
  });
  const first = route.segments[0][0];
  const last = route.segments.at(-1)!.at(-1)!;
  const tag = escapeXml;
  const coursePoints = cues.map(
    (cue) =>
      `<CoursePoint><Name>${tag(cut(cue.name, CUE_NAME_LENGTH))}</Name><Time>${when(cue.distance)}</Time>${position(cue.coord)}<PointType>${cue.type}</PointType><Notes>${tag(cue.notes)}</Notes></CoursePoint>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>${tag(cut(name, COURSE_NAME_LENGTH))}</Name><Lap><TotalTimeSeconds>${Math.round(course.seconds)}</TotalTimeSeconds><DistanceMeters>${course.total.toFixed(1)}</DistanceMeters><BeginPosition><LatitudeDegrees>${first[0]}</LatitudeDegrees><LongitudeDegrees>${first[1]}</LongitudeDegrees></BeginPosition><EndPosition><LatitudeDegrees>${last[0]}</LatitudeDegrees><LongitudeDegrees>${last[1]}</LongitudeDegrees></EndPosition><Intensity>Active</Intensity></Lap>${tracks.join('')}${coursePoints.join('')}</Course></Courses></TrainingCenterDatabase>\n`;
}

/** FIT course point types (`course_point`) of the cue types. */
const FIT_CUE_TYPES: Record<CueType, number> = {
  Generic: 0,
  Left: 6,
  Right: 7,
  Straight: 8,
};
/** FIT values: a course file, a timer event and its start and stop_all. */
const FIT_FILE_COURSE = 6,
  FIT_DEVELOPMENT = 255,
  FIT_TIMER = 0,
  FIT_START = 0,
  FIT_STOP_ALL = 4,
  /** Room for the course name; devices cut it further on screen. */
  FIT_NAME_BYTES = 64,
  /**
   * Room for a course point name, its terminating zero included: 16 bytes,
   * about the 15 characters Edge devices are reported to show. Longer than
   * the TCX schema's 10, which FIT does not share.
   */
  FIT_CUE_BYTES = 16;
/** FIT altitude: uint16 in fifths of a meter from -500 m. */
const fitAltitude = (ele: number | null) => {
  const value = ele === null ? -1 : Math.round((ele + 500) * 5);
  return value >= 0 && value < 0xffff ? value : null;
};

/**
 * A FIT course of the route: file id, course, lap, timer start, the
 * records with the course points among them in time order, timer stop. A segment gap stops and
 * starts the timer, adding no distance or time. FIT course points carry a
 * name only, so the whole instruction stays in the TCX.
 */
export function generateFit(
  route: Route,
  name: string,
  cues: Cue[],
  options: CourseOptions,
): Uint8Array<ArrayBuffer> {
  const course = courseTrack(route, options);
  const when = (distance: number) => fitTime(course.at(distance));
  const centimeters = (distance: number) => Math.round(distance * 100);
  const lat = ([value]: Coord) => semicircles(value);
  const lon = ([, value]: Coord) => semicircles(value);
  const first = route.segments[0][0];
  const last = route.segments.at(-1)!.at(-1)!;
  const end = when(course.total);
  const timer = (distance: number, type: number): FitMessage => ({
    global: FIT_MESSAGE.event,
    fields: [
      [FIT_TIMESTAMP, 'uint32', when(distance)],
      [0, 'enum', FIT_TIMER],
      [1, 'enum', type],
      [4, 'uint8', 0],
    ],
  });
  const messages: FitMessage[] = [
    {
      global: FIT_MESSAGE.fileId,
      fields: [
        [0, 'enum', FIT_FILE_COURSE],
        [1, 'uint16', FIT_DEVELOPMENT],
        [2, 'uint16', 0],
        [4, 'uint32', when(0)],
      ],
    },
    {
      global: FIT_MESSAGE.course,
      fields: [
        [4, 'enum', 0],
        [5, 'string', name, Math.min(fitStringSize(name), FIT_NAME_BYTES)],
      ],
    },
    {
      global: FIT_MESSAGE.lap,
      fields: [
        [FIT_TIMESTAMP, 'uint32', end],
        [2, 'uint32', when(0)],
        [3, 'sint32', lat(first)],
        [4, 'sint32', lon(first)],
        [5, 'sint32', lat(last)],
        [6, 'sint32', lon(last)],
        [7, 'uint32', Math.round(course.seconds * 1000)],
        [8, 'uint32', Math.round(course.seconds * 1000)],
        [9, 'uint32', centimeters(course.total)],
      ],
    },
    timer(0, FIT_START),
  ];
  let next = 0;
  const pointsUpTo = (distance: number) => {
    for (; next < cues.length && cues[next].distance <= distance; next++) {
      const cue = cues[next];
      messages.push({
        global: FIT_MESSAGE.coursePoint,
        fields: [
          [254, 'uint16', next],
          [1, 'uint32', when(cue.distance)],
          [2, 'sint32', lat(cue.coord)],
          [3, 'sint32', lon(cue.coord)],
          [4, 'uint32', centimeters(cue.distance)],
          [5, 'enum', FIT_CUE_TYPES[cue.type]],
          [6, 'string', cue.name, FIT_CUE_BYTES],
        ],
      });
    }
  };
  route.segments.forEach((segment, k) => {
    const distances = course.distances[k];
    if (k) {
      messages.push(timer(distances[0], FIT_STOP_ALL));
      messages.push(timer(distances[0], FIT_START));
    }
    segment.forEach((coord, i) => {
      pointsUpTo(distances[i]);
      const altitude = fitAltitude(
        knownElevation(options.elevations?.[k]?.[i]),
      );
      messages.push({
        global: FIT_MESSAGE.record,
        fields: [
          [FIT_TIMESTAMP, 'uint32', when(distances[i])],
          [0, 'sint32', lat(coord)],
          [1, 'sint32', lon(coord)],
          ...(altitude === null ? [] : [[2, 'uint16', altitude] as const]),
          [5, 'uint32', centimeters(distances[i])],
        ],
      });
    });
  });
  pointsUpTo(Infinity);
  messages.push(timer(course.total, FIT_STOP_ALL));
  return encodeFit(messages);
}
