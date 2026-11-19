import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePolyline } from '../src/road-attributes';
afterEach(() => vi.unstubAllGlobals());

describe('valhallaTrace', () => {
  // A fresh module, so its routing queue holds no task from other tests.
  const fresh = async () => {
    vi.resetModules();
    return import('../src/valhalla-trace');
  };
  const coords: [number, number][] = [
    [-22.9, -43.2],
    [-22.9, -43.19],
    [-22.9, -43.18],
  ];
  const piece = (shift = 0) => ({
    coords: coords.map(([a, b]) => [a + shift, b] as [number, number]),
    at: [0, 1000, 2000],
  });
  it('matches a piece with map_snap, returns a checked route and caches it', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        trip: {
          status: 0,
          summary: { length: 2, time: 120 },
          legs: [
            {
              shape: encodePolyline(coords),
              maneuvers: [
                { street_names: ['Rua A'], length: 2, time: 120, type: 1 },
              ],
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetch);
    const { valhallaTrace } = await fresh();
    const [route] = await valhallaTrace('https://valhalla.test', [piece()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://valhalla.test/trace_route');
    expect(JSON.parse(init.body as string)).toMatchObject({
      costing: 'auto',
      shape_match: 'map_snap',
    });
    expect(route).toMatchObject({
      provider: 'Valhalla map matching',
      steps: [{ name: 'Rua A', kind: 'depart' }],
    });
    expect((route as { segments: unknown }).segments).toEqual([coords]);
    // The same piece again comes from the page-memory cache.
    await valhallaTrace('https://valhalla.test', [piece()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('gives null for a trace the server cannot match and stops at a usage limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({}),
        }),
    );
    const { valhallaTrace, ValhallaLimitError } = await fresh();
    expect(await valhallaTrace('https://valhalla.test', [piece(0.01)])).toEqual(
      [null],
    );
    await expect(
      valhallaTrace('https://valhalla.test', [piece(0.02)]),
    ).rejects.toBeInstanceOf(ValhallaLimitError);
  });
});
