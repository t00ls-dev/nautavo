import { afterEach, expect, it, vi } from 'vitest';
import { shareFile } from '../src/share-gpx';
import { LongPress } from '../src/long-press';
afterEach(() => vi.useRealTimers());
it('chooses the first approved file MIME without changing the filename or bytes', () => {
  const canShare = vi.fn(
    (data: ShareData) => data.files?.[0].type === 'application/xml',
  );
  const file = shareFile('<gpx/>', 'custom.gpx', canShare)!;
  expect(file.type).toBe('application/xml');
  expect(file.name).toBe('custom.gpx');
  expect(file.size).toBe(6);
  expect(canShare).toHaveBeenCalledTimes(2);
  expect(shareFile('x', 'x.gpx', () => false)).toBeNull();
  expect(
    shareFile('x', 'x.gpx', () => {
      throw new Error();
    }),
  ).toBeNull();
});
it('long press requires 500 ms and cancels on movement or release', () => {
  vi.useFakeTimers();
  const open = vi.fn(),
    press = new LongPress(open);
  press.start(10, 10);
  vi.advanceTimersByTime(499);
  expect(open).not.toHaveBeenCalled();
  press.move(13, 12);
  vi.advanceTimersByTime(1);
  expect(open).toHaveBeenCalledTimes(1);
  press.start(10, 10);
  press.move(20, 10);
  vi.advanceTimersByTime(600);
  expect(open).toHaveBeenCalledTimes(1);
  press.start(10, 10);
  press.cancel();
  vi.advanceTimersByTime(600);
  expect(open).toHaveBeenCalledTimes(1);
});
