import { describe, expect, it } from 'vitest';
import { hashedBrandUrls } from '../src/brand-assets';

describe('brand file URLs', () => {
  const built = new Map([
    ['icon-192.png', '/assets/icon-192-abc.png'],
    ['social-card.png', '/assets/social-card-def.png'],
  ]);

  it('points every source reference, absolute ones included, at the built file', () => {
    expect(
      hashedBrandUrls(
        '{"src": "/src/brand/icon-192.png"} https://nautavo.com/src/brand/social-card.png',
        built,
      ),
    ).toBe(
      '{"src": "/assets/icon-192-abc.png"} https://nautavo.com/assets/social-card-def.png',
    );
  });

  it('fails the build on a brand file it did not emit', () => {
    expect(() => hashedBrandUrls('/src/brand/missing.png', built)).toThrow(
      '/src/brand/missing.png',
    );
  });
});
