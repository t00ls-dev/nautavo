import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFile, JSON_TYPES, shareFile } from '../src/share-file';
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
describe('exportFile', () => {
  const options = {
    share: true,
    types: JSON_TYPES,
    downloadType: 'application/json',
  };
  let downloads: string[];
  beforeEach(() => {
    downloads = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'canShare');
    Reflect.deleteProperty(navigator, 'share');
  });
  const sharing = (share: (data: ShareData) => Promise<void>) => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    });
    const mock = vi.fn(share);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: mock,
    });
    return mock;
  };
  it('shares a named file of the first accepted type', async () => {
    const share = sharing(async () => {});
    expect(await exportFile('{}', 'backup.json', options)).toBe('shared');
    // Only the file: a title or text would be saved as a second file on iOS.
    expect(Object.keys(share.mock.calls[0][0])).toEqual(['files']);
    const file = share.mock.calls[0][0].files![0];
    expect([file.name, file.type]).toEqual(['backup.json', 'application/json']);
    expect(downloads).toEqual([]);
  });
  it('does nothing when the share sheet is cancelled', async () => {
    sharing(() => Promise.reject(new DOMException('', 'AbortError')));
    expect(await exportFile('{}', 'backup.json', options)).toBe('cancelled');
    expect(downloads).toEqual([]);
  });
  it('downloads when sharing fails, is off or is unsupported', async () => {
    sharing(() => Promise.reject(new DOMException('', 'NotAllowedError')));
    expect(await exportFile('{}', 'a.json', options)).toBe('downloaded');
    expect(await exportFile('{}', 'b.json', { ...options, share: false })).toBe(
      'downloaded',
    );
    Reflect.deleteProperty(navigator, 'share');
    expect(await exportFile('{}', 'c.json', options)).toBe('downloaded');
    expect(downloads).toEqual(['a.json', 'b.json', 'c.json']);
  });
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
