// Optional regression with real recorded tracks kept only on this machine.
// Default runs skip it: `npm run test:tracks` reads the GPX, FIT and TCX files
// in the ignored `.audit.local/tracks/` folder, never committed since they
// hold the traveler's locations.
// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { defaults, importTrackFile } from '../src/core';
import { checkTrack } from '../src/track-check';

const DIR = '.audit.local/tracks';
const enabled = process.env.TRACKS === '1';
const files =
  enabled && existsSync(DIR)
    ? readdirSync(DIR).filter((f) => /\.(gpx|fit|tcx)(\.gz)?$|\.zip$/i.test(f))
    : [];

/**
 * Valhalla answers are kept next to each track (`<file>.trace-<hash>.json`)
 * and reused, so each piece is asked once, through the app's own request.
 */
function cachedFetch(name: string) {
  const live = globalThis.fetch;
  return vi.fn(async (url: string, init: RequestInit) => {
    const hash = createHash('sha1')
      .update(`${url}|${init.body as string}`)
      .digest('hex')
      .slice(0, 16);
    const file = `${DIR}/${name}.trace-${hash}.json`;
    if (!existsSync(file)) {
      const response = await live(url, init);
      writeFileSync(file, await response.text());
      if (!response.ok) throw new Error(`${response.status} for ${name}`);
    }
    const text = readFileSync(file, 'utf8');
    return new Response(text, { status: 200 });
  });
}

describe.skipIf(!enabled)('local tracks', () => {
  if (!files.length) it.skip(`no tracks in ${DIR}`, () => {});
  for (const name of files)
    it(
      name,
      async () => {
        vi.stubGlobal('fetch', cachedFetch(name));
        const imported = importTrackFile(readFileSync(`${DIR}/${name}`));
        const server = defaults().valhalla;
        const named = imported.indices
          ? []
          : imported.points.flatMap((p) => (p.coord ? [p.coord] : []));
        // After the import: glitches corrected, nothing else changed.
        const repair = await checkTrack(
          imported.route,
          server,
          'repair',
          named,
          imported.elevations,
        );
        expect(repair.kind, `${name}: repair`).toBe('checked');
        if (repair.kind !== 'checked') return;
        // Calculate route: the road of the track, through every point.
        const follow = await checkTrack(
          imported.route,
          server,
          'follow',
          imported.points.flatMap((p) => (p.coord ? [p.coord] : [])),
        );
        expect(follow.kind, `${name}: follow`).toBe('checked');
        if (follow.kind !== 'checked') return;
        const km = (m: number) => (m / 1000).toFixed(2);
        const off = follow.check.off.reduce((n, o) => n + o.to - o.from, 0);
        console.log(
          `${name}: ${km(imported.route.distance)} km, import ${km(repair.check.route.distance)} km, ` +
            `Calculate ${km(follow.check.route.distance)} km, ` +
            `${repair.check.aligned} pieces aligned, ${repair.check.glitches} glitches, ` +
            `${follow.check.off.length} stretches off the road (${km(off)} km)`,
        );
        // Nothing the traveler did not ride, nothing left out: the result
        // stays within 3% of the recording.
        for (const result of [repair.check, follow.check])
          expect(
            Math.abs(result.route.distance - imported.route.distance),
          ).toBeLessThanOrEqual(0.03 * imported.route.distance);
        vi.unstubAllGlobals();
      },
      300_000,
    );
});
