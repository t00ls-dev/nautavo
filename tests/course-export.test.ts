import { describe, expect, it } from 'vitest';
import { readTrackFile, type Coord, type Route, type Step } from '../src/core';
import { courseCues, generateFit, generateTcx } from '../src/course-export';
import { encodeFit } from '../src/fit';

// About 111 m per 0.001°, along the equator.
const east = (from: number, to: number): Coord[] =>
  Array.from({ length: Math.round((to - from) / 0.001) + 1 }, (_, i) => [
    0,
    +(from + i * 0.001).toFixed(6),
  ]);
const step = (at: number, extra: Partial<Step>): Step => ({
  name: '',
  ref: '',
  distance: 0,
  duration: 0,
  at: [0, at],
  ...extra,
});
const route = (steps: Step[], segments = [east(0, 0.02)]): Route => ({
  segments,
  steps,
  distance: 2220,
  duration: 300,
  provider: 'OSRM',
});
const points = [
  { coord: [0, 0] as Coord },
  { coord: [0, 0.01] as Coord },
  { coord: [0, 0.02] as Coord },
];
const name = (i: number) => ['Start', 'Café & Bar', 'Destination'][i];
const translate = (text: string) => `[${text}]`;
const xml = (text: string) =>
  new DOMParser().parseFromString(text, 'application/xml');

describe('courseCues', () => {
  const steps = [
    step(0, { kind: 'depart' }),
    step(0.004, {
      kind: 'turn',
      modifier: 'left',
      name: 'Avenida das Américas',
    }),
    step(0.006, { kind: 'continue', modifier: 'straight', name: 'Same' }),
    step(0.008, { kind: 'turn', modifier: 'slight right', toward: 'Centro' }),
    step(0.012, { kind: 'roundabout', modifier: 'right', exit: 2 }),
    step(0.015, { kind: 'turn', modifier: 'uturn' }),
    step(0.02, { kind: 'arrive' }),
  ];
  const cues = courseCues(route(steps), points, name, translate);

  it('marks each turn and route point, in order along the route', () => {
    expect(cues.map((c) => c.type)).toEqual([
      'Generic', // start
      'Left',
      'Right',
      'Generic', // stop
      'Generic', // roundabout
      'Generic', // U-turn
      'Generic', // destination
    ]);
    const distances = cues.map((c) => c.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('leaves out the departure, the arrival and going straight on', () => {
    expect(cues.some((c) => c.notes.includes('Same'))).toBe(false);
    expect(cues.filter((c) => c.notes === '[Depart]')).toHaveLength(0);
    expect(cues.filter((c) => c.notes === '[Arrive]')).toHaveLength(0);
  });

  it('names a turn by its short road name, with the whole instruction in its notes', () => {
    const left = cues[1];
    expect(left.name).toBe('Av. das Américas');
    expect(left.notes).toBe('[Turn left] · Avenida das Américas');
    expect(cues[2].notes).toBe('[Slight right] · [toward Centro]');
    // No road: the sign's destination, else the direction in a word.
    expect(cues[2].name).toBe('Centro');
    expect(cues[4].notes).toBe('[Roundabout, exit 2]');
  });

  it('names a turn without road or sign by its direction', () => {
    const [cue] = courseCues(
      route([step(0.004, { kind: 'turn', modifier: 'sharp right' })]),
      [],
      name,
      translate,
    );
    expect(cue.name).toBe('[Right]');
    expect(cue.notes).toBe('[Sharp right]');
  });

  it('names route points by the name given', () => {
    expect(cues[0].notes).toBe('Start');
    expect(cues[3].notes).toBe('Café & Bar');
    expect(cues[3].name).toBe('Café & Bar');
  });
});

describe('generateTcx', () => {
  const twoSegments = [east(0, 0.01), east(0.012, 0.02)];
  const r = route(
    [step(0.004, { kind: 'turn', modifier: 'left', name: 'Rua <A>' })],
    twoSegments,
  );
  const cues = courseCues(r, points, name, translate);
  const text = generateTcx(r, 'A very long route name & more', cues, {
    speedKmh: 36,
    date: new Date('2026-11-25T08:00:00Z'),
  });
  const doc = xml(text);

  it('is well-formed, with one track per segment and every point', () => {
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const tracks = doc.getElementsByTagName('Track');
    expect(tracks).toHaveLength(2);
    expect(doc.getElementsByTagName('Trackpoint')).toHaveLength(
      twoSegments.flat().length,
    );
  });

  it('keeps the schema limits and escapes text', () => {
    const course = doc.getElementsByTagName('Course')[0];
    expect(course.getElementsByTagName('Name')[0].textContent).toBe(
      'A very long rou',
    );
    const pointNames = [...doc.getElementsByTagName('CoursePoint')].map(
      (p) => p.getElementsByTagName('Name')[0].textContent,
    );
    expect(pointNames).toContain('Destinatio');
    expect(pointNames.every((n) => [...n].length <= 10)).toBe(true);
    const notes = [...doc.getElementsByTagName('Notes')].map(
      (n) => n.textContent,
    );
    expect(notes).toContain('[Turn left] · Rua <A>');
    expect(notes).toContain('Café & Bar');
  });

  it('times points by the average speed, without crossing a segment gap', () => {
    const times = [...doc.getElementsByTagName('Trackpoint')].map((p) =>
      Date.parse(p.getElementsByTagName('Time')[0].textContent),
    );
    expect(times[0]).toBe(Date.parse('2026-11-25T08:00:00Z'));
    // 10 m/s: the first segment (~1.11 km) takes ~111 s; the gap adds none.
    const firstEnd = times[east(0, 0.01).length - 1];
    expect((firstEnd - times[0]) / 1000).toBeCloseTo(111, 0);
    expect(times[east(0, 0.01).length]).toBe(firstEnd);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('opens again in Nautavo with its track and course points', () => {
    const parsed = readTrackFile(new TextEncoder().encode(text));
    expect(parsed.format).toBe('TCX');
    expect(parsed.segments).toEqual(twoSegments);
    expect(parsed.waypoints.map((w) => w.name)).toContain('Café & Bar');
  });

  it('writes the elevation it is given where the schema puts it (#290)', () => {
    const elevations = twoSegments.map((s) => s.map((_, i) => 5 + i));
    const withAltitude = generateTcx(r, 'x', cues, {
      speedKmh: 20,
      elevations,
    });
    expect(withAltitude.match(/<AltitudeMeters>/g)).toHaveLength(
      twoSegments.flat().length,
    );
    expect(withAltitude).toMatch(
      /<\/Position><AltitudeMeters>5<\/AltitudeMeters><DistanceMeters>/,
    );
    expect(text).not.toContain('<AltitudeMeters>');
  });

  it('refuses a route without geometry', () => {
    expect(() =>
      generateTcx(route([], [[[0, 0]]]), 'x', [], { speedKmh: 20 }),
    ).toThrow('No valid route geometry to export.');
  });
});

describe('generateFit', () => {
  const twoSegments = [east(0, 0.01), east(0.012, 0.02)];
  const r = route(
    [step(0.004, { kind: 'turn', modifier: 'left', name: 'Rua Ação' })],
    twoSegments,
  );
  const cues = courseCues(r, points, name, translate);
  const date = new Date('2026-11-25T08:00:00Z');
  const bytes = generateFit(r, 'Volta à Lagoa', cues, {
    speedKmh: 36,
    date,
  });
  const parsed = readTrackFile(bytes);
  const flat = (segments: Coord[][]) => segments.flat().flat();

  it('opens again in Nautavo with every point, its name and course points', () => {
    expect(parsed.format).toBe('FIT');
    expect(parsed.name).toBe('Volta à Lagoa');
    // Semicircles keep positions within a centimeter.
    const read = flat(parsed.segments);
    flat(twoSegments).forEach((value, i) => {
      expect(read[i]).toBeCloseTo(value, 6);
    });
    expect(parsed.waypoints.map((w) => w.name)).toEqual([
      'Start',
      'R. Ação',
      'Café & Bar',
      'Destination',
    ]);
  });

  it('cuts a course point name within its 16 bytes, at a character', () => {
    const long = route([
      step(0.004, {
        kind: 'turn',
        modifier: 'left',
        name: 'Avenida das Américas',
      }),
    ]);
    const read = readTrackFile(
      generateFit(long, 'x', courseCues(long, [], name, translate), {
        speedKmh: 20,
      }),
    );
    // "Av. das Américas" takes 17 bytes: dropping "as" leaves room for the zero.
    expect(read.waypoints.map((w) => w.name)).toEqual(['Av. das Améric']);
  });

  it('times points by the average speed, without crossing a segment gap', () => {
    const times = parsed.recorded.flat().map((p) => p.time!);
    expect(times[0]).toBe(date.getTime());
    const firstEnd = times[east(0, 0.01).length - 1];
    expect((firstEnd - times[0]) / 1000).toBeCloseTo(111, 0);
    expect(times[east(0, 0.01).length]).toBe(firstEnd);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('writes the elevation it is given and leaves it out otherwise', () => {
    expect(parsed.elevations.flat().every((e) => e === null)).toBe(true);
    const elevations = twoSegments.map((s) => s.map((_, i) => 5 + i));
    const withAltitude = readTrackFile(
      generateFit(r, 'x', cues, { speedKmh: 20, elevations }),
    );
    expect(withAltitude.elevations.flat()).toEqual(elevations.flat());
  });

  it('refuses a route without geometry', () => {
    expect(() =>
      generateFit(route([], [[[0, 0]]]), 'x', [], { speedKmh: 20 }),
    ).toThrow('No valid route geometry to export.');
  });
});

describe('encodeFit', () => {
  const position = (i: number) =>
    [
      [0, 'sint32', i * 1000],
      [1, 'sint32', 0],
    ] as const;

  it('defines more than 16 kinds of message, replacing the oldest', () => {
    // Each record adds its own field, so each needs its own definition.
    const messages = Array.from({ length: 20 }, (_, i) => ({
      global: 20,
      fields: [...position(i), [100 + i, 'uint8', 1] as const],
    }));
    const read = readTrackFile(encodeFit(messages));
    expect(read.segments.flat()).toHaveLength(20);
  });

  it('cuts a string at a character, inside its field', () => {
    const read = readTrackFile(
      encodeFit([
        { global: 31, fields: [[5, 'string', 'Açaí', 5]] },
        { global: 20, fields: [...position(0)] },
        { global: 20, fields: [...position(1)] },
      ]),
    );
    // "Aça" is 4 bytes: the "í" would not leave room for the zero.
    expect(read.name).toBe('Aça');
  });
});
