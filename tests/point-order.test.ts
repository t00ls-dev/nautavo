import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem } from '../src/point-order';

// Four 48 px rows 8 px apart: centers every 56 px.
const centers = [24, 80, 136, 192];

describe('dropIndex', () => {
  it('stays in place until the middle to the next row', () => {
    expect(dropIndex(136, centers, 2)).toBe(2);
    expect(dropIndex(109, centers, 2)).toBe(2);
    expect(dropIndex(107, centers, 2)).toBe(1);
    expect(dropIndex(165, centers, 2)).toBe(3);
  });
  it('passes several rows in one move', () => {
    expect(dropIndex(20, centers, 3)).toBe(0);
    expect(dropIndex(200, centers, 0)).toBe(3);
    expect(dropIndex(100, centers, 0)).toBe(1);
  });
  it('never leaves the list', () => {
    expect(dropIndex(-500, centers, 1)).toBe(0);
    expect(dropIndex(5000, centers, 1)).toBe(3);
  });
});

describe('moveItem', () => {
  it('moves one item and keeps the others in order', () => {
    const items = ['a', 'b', 'c', 'd'];
    moveItem(items, 3, 1);
    expect(items).toEqual(['a', 'd', 'b', 'c']);
    moveItem(items, 0, 3);
    expect(items).toEqual(['d', 'b', 'c', 'a']);
    moveItem(items, 2, 2);
    expect(items).toEqual(['d', 'b', 'c', 'a']);
  });
});
