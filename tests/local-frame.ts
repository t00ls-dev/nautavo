import type { Coord } from '../src/core';

/**
 * A local frame for synthetic tracks around Rio: x east and y north, in
 * meters from `origin`, rounded to 7 decimals as a GPX file would store them.
 * Shared by the unit and browser tests of imported tracks.
 */
const origin: Coord = [-22.9, -43.2];
const PER_DEGREE = 111_320;
const round = (n: number) => Number(n.toFixed(7));
export const at = (x: number, y: number): Coord => [
  round(origin[0] + y / PER_DEGREE),
  round(origin[1] + x / (PER_DEGREE * Math.cos((origin[0] * Math.PI) / 180))),
];
/** A road going east along `y`, a point every `step` meters. */
export const road = (from: number, to: number, step = 10, y = 0): Coord[] => {
  const out: Coord[] = [];
  for (let x = from; x <= to; x += step) out.push(at(x, y));
  return out;
};
/** Meters north of the origin's latitude. */
export const north = ([lat]: readonly number[]) =>
  (lat - origin[0]) * PER_DEGREE;
