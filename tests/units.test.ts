import { expect, it } from 'vitest';
import {
  distanceLabel,
  durationLabel,
  precipitationLabel,
  shortDistanceLabel,
  speedLabel,
  temperatureLabel,
} from '../src/units';
it('converts metric to miles with consistent precision and locale', () => {
  expect(distanceLabel(1609.344, 'imperial')).toBe('1\u00a0mi');
  expect(distanceLabel(42000, 'imperial')).toBe('26.1\u00a0mi');
  expect(distanceLabel(42150, 'metric', 'pt-BR')).toBe('42,2\u00a0km');
  expect(shortDistanceLabel(100, 'imperial')).toBe('328\u00a0ft');
});
it('converts weather temperature and precipitation with the temperature units', () => {
  expect(temperatureLabel(24.1, 'celsius', 'pt-BR')).toBe('24,1\u00a0°C');
  expect(temperatureLabel(24.1, 'fahrenheit')).toBe('75.4\u00a0°F');
  expect(temperatureLabel(-40, 'fahrenheit')).toBe('-40\u00a0°F');
  expect(temperatureLabel(null, 'fahrenheit')).toBe('-\u00a0°F');
  expect(precipitationLabel(0.2, 'celsius', 'pt-BR')).toBe('0,2\u00a0mm');
  expect(precipitationLabel(12.7, 'fahrenheit')).toBe('0.5\u00a0in');
  expect(precipitationLabel(0.2, 'fahrenheit', 'pt-BR')).toBe('0,01\u00a0in');
  expect(precipitationLabel(null)).toBe('-\u00a0mm');
});
it('shows a recorded speed with one decimal in the distance units', () => {
  expect(speedLabel(41.2 / 3.6, 'metric', 'pt-BR')).toBe('41,2\u00a0km/h');
  expect(speedLabel(5)).toBe('18\u00a0km/h');
  expect(speedLabel(20, 'imperial')).toBe('44.7\u00a0mph');
});
it('keeps every number with its unit, so a line never breaks between them', () => {
  // A no-break space: "1,308 m" never ends a line at "1,308".
  expect(distanceLabel(1308, 'metric', 'en', 2)).toBe('1.31\u00a0km');
  expect(durationLabel(18 * 60)).toBe('18\u00a0min');
  // A line may break between the hours and the minutes.
  expect(durationLabel(108 * 60)).toBe('1h 48\u00a0min');
});
