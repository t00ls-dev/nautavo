import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '../src/core';
import { ServerError, RequestQueue } from '../src/http';
import {
  calculate,
  decodePolyline,
  navigationRoute,
  osrmRoute,
  osrmUrl,
  valhallaRoute,
} from '../src/routing';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (x: unknown) => ({ ok: true, json: async () => x });
const osrm = {
  code: 'Ok',
  waypoints: [
    { location: [-43, -22], distance: 0 },
    { location: [-44, -23], distance: 0 },
  ],
  routes: [
    {
      distance: 123,
      duration: 45,
      geometry: {
        coordinates: [
          [-43, -22],
          [-44, -23],
        ],
      },
      legs: [
        {
          steps: [
            {
              name: 'Highway',
              ref: 'BR-101',
              distance: 123,
              duration: 45,
              maneuver: { type: 'depart' },
            },
          ],
        },
      ],
    },
  ],
};
const state = () => {
  const s = defaults();
  s.points = [
    { name: 'A', coord: [-22, -43] },
    { name: 'B', coord: [-23, -44] },
  ];
  return s;
};
/** The same route without Prefer main roads, which keeps OSRM primary. */
const osrmFirst = () => ({ ...state(), prefer: false });
describe('routing adapters', () => {
  it('requests full geometry with lon,lat and returns lat,lon', async () => {
    const fetch = vi.fn().mockResolvedValue(response(osrm));
    vi.stubGlobal('fetch', fetch);
    const r = await osrmRoute(state());
    expect(fetch.mock.calls[0][0]).toContain(
      '-43,-22;-44,-23?overview=full&geometries=geojson&steps=true',
    );
    expect(r.segments[0]).toEqual([
      [-22, -43],
      [-23, -44],
    ]);
    expect(r.steps[0].ref).toBe('BR-101');
  });
  it('keeps OSRM turn direction, roundabout exit and location, omitting unknown values', async () => {
    const data = structuredClone(osrm) as typeof osrm & {
      routes: { legs: { steps: Record<string, unknown>[] }[] }[];
    };
    const step = (maneuver: unknown) => ({
      name: 'Road',
      distance: 1,
      duration: 1,
      maneuver,
    });
    data.routes[0].legs[0].steps.push(
      step({ type: 'turn', modifier: 'left', location: [-43.5, -22.5] }),
      step({ type: 'roundabout', exit: 2, location: [-43.6, -22.6] }),
      step({
        type: 'turn',
        modifier: 'sideways',
        exit: 1.5,
        location: [0, 99],
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    const r = await osrmRoute(state());
    expect(r.steps[1]).toMatchObject({
      kind: 'turn',
      modifier: 'left',
      at: [-22.5, -43.5],
    });
    expect(r.steps[2]).toMatchObject({ kind: 'roundabout', exit: 2 });
    expect(r.steps[3]).not.toHaveProperty('modifier');
    expect(r.steps[3]).not.toHaveProperty('exit');
    expect(r.steps[3]).not.toHaveProperty('at');
  });
  it('maps Valhalla maneuver types to the shared vocabulary', async () => {
    const maneuver = (type: number, extra = {}) => ({
      street_names: ['Road'],
      length: 0.1,
      time: 1,
      type,
      begin_shape_index: 1,
      ...extra,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          trip: {
            status: 0,
            summary: { length: 1, time: 90 },
            legs: [
              {
                shape: '??_c`|@_gayB',
                maneuvers: [
                  maneuver(1, { begin_shape_index: 0 }),
                  maneuver(15),
                  maneuver(9),
                  maneuver(13),
                  maneuver(26, { roundabout_exit_count: 3 }),
                  maneuver(18),
                  maneuver(23),
                  maneuver(28),
                  maneuver(4, { begin_shape_index: 9 }),
                ],
              },
            ],
          },
        }),
      ),
    );
    const r = await valhallaRoute(state());
    expect(r.steps.map((s) => [s.kind, s.modifier, s.exit])).toEqual([
      ['depart', undefined, undefined],
      ['turn', 'left', undefined],
      ['turn', 'slight right', undefined],
      ['turn', 'uturn', undefined],
      ['roundabout', undefined, 3],
      ['on ramp', 'right', undefined],
      ['fork', 'right', undefined],
      [undefined, undefined, undefined],
      ['arrive', undefined, undefined],
    ]);
    expect(r.steps[0].at).toEqual([0, 0]);
    expect(r.steps[1].at).toEqual([1, 2]);
    // An index outside the shape gives no location.
    expect(r.steps[8]).not.toHaveProperty('at');
  });
  it('rejects no-route responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ code: 'NoRoute' })),
    );
    await expect(osrmRoute(state())).rejects.toThrow('No driving route');
  });
  it('decodes Valhalla geometry at precision 6', () => {
    expect(decodePolyline('??_c`|@_gayB')).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });
  it('uses Valhalla automatically when OSRM fails', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(
        response({
          trip: {
            status: 0,
            summary: { length: 1, time: 90 },
            legs: [
              {
                shape: '??_c`|@_gayB',
                maneuvers: [
                  { street_names: ['BR-101'], length: 1, time: 90, type: 1 },
                ],
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const promise = calculate(osrmFirst());
    await vi.runAllTimersAsync();
    const r = await promise;
    expect(r.provider).toBe('Valhalla (fallback)');
    expect(r.distance).toBe(1000);
    expect(r.steps[0].ref).toBe('BR-101');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  const valhalla = (length: unknown = 1) => ({
    trip: {
      status: 0,
      summary: { length, time: 90 },
      legs: [
        {
          shape: '??_c`|@_gayB',
          maneuvers: [
            { street_names: ['BR-101'], length: 1, time: 90, type: 1 },
          ],
        },
      ],
    },
  });
  const brokenOsrm = (change: (x: typeof osrm) => void) => {
    const copy = structuredClone(osrm);
    change(copy);
    return copy;
  };
  it.each([
    [
      'coordinates outside Earth',
      brokenOsrm((x) => {
        x.routes[0].geometry.coordinates[1] = [-44, -123];
      }),
    ],
    [
      'non-numeric coordinates',
      brokenOsrm((x) => {
        (x.routes[0].geometry.coordinates[0] as unknown[]) = ['a', 'b'];
      }),
    ],
    [
      'missing legs',
      brokenOsrm((x) => {
        delete (x.routes[0] as { legs?: unknown }).legs;
      }),
    ],
    [
      'a negative distance',
      brokenOsrm((x) => {
        x.routes[0].distance = -1;
      }),
    ],
    [
      'a waypoint count that does not match the request',
      brokenOsrm((x) => {
        x.waypoints.pop();
      }),
    ],
  ])('rejects OSRM responses with %s', async (_, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    await expect(osrmRoute(state())).rejects.toThrow(
      'OSRM returned an invalid route.',
    );
  });
  it('falls back to Valhalla when OSRM returns an invalid route', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          brokenOsrm((x) => {
            x.routes[0].duration = Number.NaN;
          }),
        ),
      )
      .mockResolvedValueOnce(response(valhalla()));
    vi.stubGlobal('fetch', fetch);
    const promise = calculate(osrmFirst());
    await vi.runAllTimersAsync();
    expect((await promise).provider).toContain('Valhalla');
  });
  it('asks Valhalla first with Prefer main roads, OSRM once after a pause on failure', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(valhalla()))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(osrm));
    vi.stubGlobal('fetch', fetch);
    /** One calculation, with the routing queue's spacing let pass. */
    const run = async (s: ReturnType<typeof state>) => {
      const promise = calculate(s);
      await vi.runAllTimersAsync();
      return promise;
    };
    const first = await run(state());
    expect(String(fetch.mock.calls[0][0])).toContain('/route?json=');
    expect(
      JSON.parse(
        decodeURIComponent(String(fetch.mock.calls[0][0]).split('json=')[1]),
      ),
    ).toMatchObject({ costing_options: { auto: { use_highways: 1 } } });
    expect(first.provider).toBe('Valhalla');
    // The route points where Valhalla placed them: the ends of each leg.
    expect(first.snapped).toEqual([
      [0, 0],
      [1, 2],
    ]);
    expect((await run(state())).provider).toBe('OSRM (fallback)');
    expect(String(fetch.mock.calls[2][0])).toContain('/route/v1/driving/');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('keeps OSRM first without Prefer main roads, or when the caller says so', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(response(osrm));
    vi.stubGlobal('fetch', fetch);
    const plain = calculate(osrmFirst()),
      chosen = calculate(state(), () => true, null, 'osrm');
    await vi.runAllTimersAsync();
    expect((await plain).provider).toBe('OSRM');
    expect((await chosen).provider).toBe('OSRM');
    for (const [url] of fetch.mock.calls)
      expect(String(url)).toContain('/route/v1/driving/');
  });
  it('rejects Valhalla responses with invalid values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(valhalla('x'))));
    await expect(valhallaRoute(state())).rejects.toThrow(
      'Valhalla returned an invalid route.',
    );
  });
  it('reports an unavailable fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: 'No route' })),
    );
    await expect(valhallaRoute(state())).rejects.toThrow('No route');
  });
  it('serializes requests and spaces starts', async () => {
    vi.useFakeTimers();
    const q = new RequestQueue(1100),
      times: number[] = [];
    const f = async () => {
      times.push(Date.now());
      return 1;
    };
    const a = q.run(f),
      b = q.run(f);
    await vi.runAllTimersAsync();
    await Promise.all([a, b]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1100);
  });
});

it('skips cancelled queue entries without spending request slots', async () => {
  vi.useFakeTimers();
  const queue = new RequestQueue(1100);
  const starts: number[] = [];
  const request = async () => {
    starts.push(Date.now());
    return 1;
  };
  const first = queue.run(request);
  await vi.runAllTimersAsync();
  await first;
  const obsolete = Array.from({ length: 5 }, () =>
    queue.run(request, () => false),
  );
  const rejected = obsolete.map((promise) =>
    expect(promise).rejects.toThrow('Cancelled'),
  );
  const next = queue.run(request);
  await vi.runAllTimersAsync();
  await Promise.all([...rejected, next]);
  expect(starts).toHaveLength(2);
  expect(starts[1] - starts[0]).toBe(1100);
});

it('does not start Valhalla when a route is superseded during the fallback delay', async () => {
  vi.useFakeTimers();
  let current = true;
  const fetch = vi.fn(async () => {
    setTimeout(() => {
      current = false;
    }, 1);
    throw new Error('Offline');
  });
  vi.stubGlobal('fetch', fetch);
  const pending = calculate(osrmFirst(), () => current);
  const assertion = expect(pending).rejects.toThrow('Offline');
  await vi.runAllTimersAsync();
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
});

describe('navigation recalculation', () => {
  it('sends the direction of travel to OSRM for the first point only', () => {
    expect(osrmUrl(state(), 452.4)).toContain('&bearings=92,60;');
    expect(osrmUrl(state())).not.toContain('bearings');
    expect(osrmUrl(state(), null)).not.toContain('bearings');
  });
  it('asks once from the position, with Valhalla as the only fallback', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      });
    vi.stubGlobal('fetch', fetch);
    const done = navigationRoute(
      state(),
      [-22.1234, -43.5678],
      [-22.2, -43.6],
      90,
      () => true,
    );
    const failed = expect(done).rejects.toThrow(
      'Could not calculate the route right now.',
    );
    await vi.runAllTimersAsync();
    await failed;
    // OSRM, then Valhalla once; no retries.
    expect(fetch).toHaveBeenCalledTimes(2);
    const [osrmCall, valhallaCall] = fetch.mock.calls.map((c) => String(c[0]));
    expect(osrmCall).toContain(
      '/route/v1/driving/-43.5678,-22.1234;-43.6,-22.2?',
    );
    expect(osrmCall).toContain('bearings=90,60;');
    const body = JSON.parse(
      decodeURIComponent(valhallaCall.split('json=')[1]),
    ) as { locations: Record<string, unknown>[] };
    expect(body.locations[0]).toMatchObject({
      lat: -22.1234,
      lon: -43.5678,
      heading: 90,
      heading_tolerance: 60,
    });
    expect(body.locations[1]).not.toHaveProperty('heading');
  });
});

describe('routing failure', () => {
  it('says what failed in plain words and keeps the reason as its cause', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    const done = calculate(osrmFirst()).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = (await done) as Error;
    expect(error.message).toBe(
      'Could not calculate the route right now. Check the points or try again.',
    );
    expect(error.message).not.toMatch(/OSRM|Valhalla|HTTP|\d{3}/);
    // The server's own status stays on the cause, out of the message.
    expect(error.cause).toBeInstanceOf(ServerError);
    expect((error.cause as ServerError).status).toBe(503);
    expect((error.cause as Error).message).toBe(
      'The server did not answer correctly.',
    );
  });
});
