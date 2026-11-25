import { describe, expect, it } from 'vitest';
import { readTrackFile, type Coord, type Route, type Step } from '../src/core';
import { courseCues, generateTcx } from '../src/course-export';

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

  it('names a turn by its road, within the schema length, with the whole instruction in its notes', () => {
    const left = cues[1];
    expect([...left.name].length).toBeLessThanOrEqual(10);
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

  it('refuses a route without geometry', () => {
    expect(() =>
      generateTcx(route([], [[[0, 0]]]), 'x', [], { speedKmh: 20 }),
    ).toThrow('No valid route geometry to export.');
  });
});
