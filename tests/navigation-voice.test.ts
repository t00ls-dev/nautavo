import { describe, expect, it } from 'vitest';
import type { Step } from '../src/core';
import { translate } from '../src/i18n';
import type { NavigationReadout } from '../src/navigation';
import {
  createVoiceSchedule,
  spokenDistance,
  VOICE_THRESHOLDS,
} from '../src/navigation-voice';

const turn: Step = {
  name: 'Rua Uruguai',
  ref: '',
  distance: 500,
  duration: 60,
  kind: 'turn',
  modifier: 'right',
};
const arrive: Step = { ...turn, name: '', kind: 'arrive', modifier: undefined };
/** A readout `toNext` meters before `step`. */
const at = (
  toNext: number,
  step: Step = turn,
  extra: Partial<NavigationReadout> = {},
): NavigationReadout => ({
  progress: 0,
  remaining: toNext + 1000,
  offTrack: 2,
  next: { step, at: 1000 },
  toNext,
  after: null,
  afterGap: 0,
  arrived: false,
  weak: false,
  heading: 0,
  offRoute: false,
  rejoin: null,
  offSince: null,
  ...extra,
});
/** Everything said while approaching from `from` meters at `speed` m/s. */
function approach(from: number, speed: number, step: Step = turn) {
  const voice = createVoiceSchedule();
  const said: string[] = [];
  for (let d = from; d >= 0; d -= 5) {
    const text = voice.next(at(d, step), speed, 'metric', 'en');
    if (text) said.push(text);
  }
  return said;
}

describe('voice announcements', () => {
  it('announces a turn far, near and at the turn, once each', () => {
    expect(approach(1000, 5.5)).toEqual([
      'In 400 meters, turn right onto Rua Uruguai.',
      'In 100 meters, turn right onto Rua Uruguai.',
      'Turn right onto Rua Uruguai now.',
    ]);
  });

  it('announces earlier at higher speed', () => {
    const said = approach(2000, (60 / 3.6) * 2); // 120 km/h
    const far = VOICE_THRESHOLDS.far.seconds * ((60 / 3.6) * 2);
    expect(said[0]).toBe(
      `In ${spokenDistance(Math.floor(far / 5) * 5, 'metric', 'en')}, turn right onto Rua Uruguai.`,
    );
    expect(said).toHaveLength(3);
  });

  it('skips the far announcement for a turn first seen close by', () => {
    expect(approach(250, 5.5)).toEqual([
      'In 100 meters, turn right onto Rua Uruguai.',
      'Turn right onto Rua Uruguai now.',
    ]);
  });

  it('announces the destination, and the arrival once', () => {
    const voice = createVoiceSchedule();
    expect(voice.next(at(90, arrive), 5, 'metric', 'en')).toBe(
      'In 90 meters, you will arrive.',
    );
    const arrived = at(5, arrive, { arrived: true });
    expect(voice.next(arrived, 5, 'metric', 'en')).toBe('You have arrived.');
    expect(voice.next(arrived, 5, 'metric', 'en')).toBeNull();
  });

  it('says once when the route is left and when it is rejoined', () => {
    const voice = createVoiceSchedule();
    const off = at(800, turn, { offRoute: true });
    expect(voice.next(off, 5, 'metric', 'en')).toBe('You are off the route.');
    expect(voice.next(off, 5, 'metric', 'en')).toBeNull();
    expect(voice.next(at(800), 5, 'metric', 'en')).toBe('Back on the route.');
  });

  it('speaks distances in the chosen units, as words', () => {
    expect(spokenDistance(420, 'metric', 'en')).toBe('400 meters');
    expect(spokenDistance(1500, 'metric', 'pt-BR')).toBe('1,5 kilometers');
    expect(spokenDistance(2000, 'imperial', 'en')).toBe('1.2 miles');
    expect(spokenDistance(100, 'imperial', 'en')).toBe('350 feet');
  });

  it('speaks Portuguese, without the banner abbreviations', () => {
    expect(translate('In 400 meters, turn right onto Rua Uruguai.', 'pt')).toBe(
      'Em 400 metros, vire à direita na Rua Uruguai.',
    );
    expect(translate('Turn left now.', 'pt')).toBe('Vire à esquerda agora.');
    expect(translate('In 1,5 kilometers, you will arrive.', 'pt')).toBe(
      'Em 1,5 quilômetros, você chega ao destino.',
    );
    expect(translate('You are off the route.', 'pt')).toBe(
      'Você saiu da rota.',
    );
  });
});
