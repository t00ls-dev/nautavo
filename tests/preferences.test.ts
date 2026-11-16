import { afterEach, expect, it, vi } from 'vitest';
import {
  PREFERENCE,
  readPreference,
  readSession,
  SESSION,
  writePreference,
  writeSession,
} from '../src/preferences';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
it('reads, writes and removes device preferences and session state', () => {
  expect(readPreference(PREFERENCE.autoReroute)).toBeNull();
  writePreference(PREFERENCE.autoReroute, 'off');
  expect(localStorage.getItem('auto-reroute')).toBe('off');
  expect(readPreference(PREFERENCE.autoReroute)).toBe('off');
  writePreference(PREFERENCE.autoReroute, null);
  expect(localStorage.getItem('auto-reroute')).toBeNull();
  writeSession(SESSION.panelSize, 'full');
  expect(readSession(SESSION.panelSize)).toBe('full');
  expect(localStorage.getItem('panel-size')).toBeNull();
});
it('works without storage: reads give null and writes are dropped', () => {
  const blocked = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  vi.stubGlobal('localStorage', {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  });
  expect(readPreference(PREFERENCE.language)).toBeNull();
  expect(() => writePreference(PREFERENCE.language, 'pt')).not.toThrow();
  expect(() => writePreference(PREFERENCE.language, null)).not.toThrow();
});
it('keeps every stored key distinct', () => {
  const keys = [...Object.values(PREFERENCE), ...Object.values(SESSION)];
  expect(new Set(keys).size).toBe(keys.length);
});
