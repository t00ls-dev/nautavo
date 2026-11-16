import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../src/core';
import {
  forgetNavigation,
  rememberNavigation,
  rememberProgress,
  RESUME_EVERY,
  RESUME_LIMIT,
  resumableNavigation,
} from '../src/navigation-resume';
import { SESSION } from '../src/preferences';

const route: Route = {
  segments: [
    [
      [-22.9, -43.2],
      [-22.91, -43.21],
    ],
  ],
  steps: [],
  distance: 1500,
  duration: null,
  provider: 'Imported GPX',
};
const HASH = '#v2=abc';
const stored = () =>
  JSON.parse(sessionStorage.getItem(SESSION.navigation) ?? 'null') as {
    progress: number;
  } | null;

afterEach(() => {
  forgetNavigation();
  vi.restoreAllMocks();
});

describe('navigation resume', () => {
  it('gives back the route and progress on the same link', () => {
    rememberNavigation(route, HASH, 1000);
    rememberProgress(800, 1000 + RESUME_EVERY.time);
    expect(resumableNavigation(HASH, 2000 + RESUME_EVERY.time)).toEqual({
      route,
      progress: 800,
    });
  });

  it('writes progress only every so often, or at once when asked', () => {
    rememberNavigation(route, HASH, 0);
    rememberProgress(50, 1000);
    expect(stored()?.progress).toBe(0);
    rememberProgress(RESUME_EVERY.distance + 1, 2000);
    expect(stored()?.progress).toBe(RESUME_EVERY.distance + 1);
    rememberProgress(260, 3000, true);
    expect(stored()?.progress).toBe(260);
  });

  it('expires, and is cleared, after the time limit', () => {
    rememberNavigation(route, HASH, 0);
    expect(resumableNavigation(HASH, RESUME_LIMIT + 1)).toBeNull();
    expect(stored()).toBeNull();
  });

  it('belongs to the link it started on', () => {
    rememberNavigation(route, HASH, 0);
    expect(resumableNavigation('#v2=other', 1000)).toBeNull();
    expect(stored()).toBeNull();
  });

  it('rejects and clears malformed data', () => {
    sessionStorage.setItem(SESSION.navigation, '{not json');
    expect(resumableNavigation(HASH, 0)).toBeNull();
    sessionStorage.setItem(
      SESSION.navigation,
      JSON.stringify({ v: 1, hash: HASH, at: 0, progress: 0, route: {} }),
    );
    expect(resumableNavigation(HASH, 0)).toBeNull();
    expect(stored()).toBeNull();
  });

  it('is forgotten on exit', () => {
    rememberNavigation(route, HASH, 0);
    forgetNavigation();
    expect(resumableNavigation(HASH, 1000)).toBeNull();
  });

  it('works without storage, with nothing to continue', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => rememberNavigation(route, HASH, 0)).not.toThrow();
    expect(resumableNavigation(HASH, 1000)).toBeNull();
  });
});
