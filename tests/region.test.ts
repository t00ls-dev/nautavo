import { describe, expect, it } from 'vitest';
import { REGION_PATH, regionAnswer, regionView } from '../src/region';
import worker from '../src/worker';

describe('approximate region', () => {
  it('keeps only a position rounded to 0.1° and the place names', () => {
    expect(
      regionAnswer({
        latitude: '-22.90685',
        longitude: '-43.17290',
        city: 'Rio de Janeiro',
        region: 'Rio de Janeiro',
      }),
    ).toEqual({
      latitude: -22.9,
      longitude: -43.2,
      city: 'Rio de Janeiro',
      region: 'Rio de Janeiro',
    });
  });

  it('answers nothing without a valid position or a city or region', () => {
    for (const cf of [
      undefined,
      {},
      { latitude: '48.85', longitude: '2.35' },
      { latitude: 'x', longitude: '2.35', city: 'Paris' },
      { latitude: '91', longitude: '2.35', city: 'Paris' },
      { latitude: '48.85', longitude: '181', region: 'Île-de-France' },
      { latitude: '48.85', longitude: '2.35', city: '  ' },
    ])
      expect(regionAnswer(cf), JSON.stringify(cf)).toBeNull();
  });

  it('turns an answer into a city-scale view and rejects malformed ones', () => {
    expect(
      regionView({ latitude: 48.85, longitude: 2.35, city: 'Paris' }),
    ).toEqual({ center: [48.9, 2.4], zoom: 9 });
    for (const data of [null, 'Paris', [], { latitude: 48.85, city: 'Paris' }])
      expect(regionView(data), JSON.stringify(data)).toBeNull();
  });
});

describe('the site Worker', () => {
  const ask = (path: string, cf?: object, method = 'GET') =>
    worker.fetch(
      Object.assign(new Request(`https://nautavo.com${path}`, { method }), {
        cf,
      }),
    );

  it('answers the region from the request location, never cached', async () => {
    const response = await ask(REGION_PATH, {
      latitude: '-22.90685',
      longitude: '-43.17290',
      region: 'Rio de Janeiro',
      postalCode: '20000-000',
      asn: 28573,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // Nothing beyond the coarse position and the place name leaves the Worker.
    expect(await response.json()).toEqual({
      latitude: -22.9,
      longitude: -43.2,
      region: 'Rio de Janeiro',
    });
  });

  it('answers 204 without a usable location, 405 to other methods and 404 elsewhere', async () => {
    const empty = await ask(REGION_PATH, {});
    expect(empty.status).toBe(204);
    expect(empty.headers.get('Cache-Control')).toBe('no-store');
    const post = await ask(REGION_PATH, {}, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET, HEAD');
    // Paths no file matches reach the Worker too; its 404 is never indexed.
    const missing = await ask('/api/other');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('answers HEAD like GET, without a body', async () => {
    const head = await ask(
      REGION_PATH,
      { latitude: '48.85', longitude: '2.35', city: 'Paris' },
      'HEAD',
    );
    expect(head.status).toBe(200);
    expect(head.headers.get('Cache-Control')).toBe('no-store');
    expect(head.headers.get('Content-Type')).toContain('application/json');
    expect(await head.text()).toBe('');
  });
});
