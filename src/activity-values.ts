import { valuesAt, type Activity, type ActivityValue } from './activity';
import { byId as $, text } from './dom';
import { iconControl } from './icons';
import { PREFERENCE, readPreference, writePreference } from './preferences';
import { speedFromKmh } from './travel-time';
import { distanceUnits, temperatureUnits } from './unit-preferences';
import { MISSING } from './units';

/**
 * The data page of the activity replay (#156), as bike computers show a
 * ride: in the bottom card, a grid of fields, each a short label over a large
 * value and its unit, in fixed places so nothing moves as digits change, and
 * the Values shown menu that picks them. The map above stays clear. The
 * choice is a device preference (`activity-values`, the fields hidden).
 */
type Field = ActivityValue | 'clock';
interface Kind {
  field: Field;
  /** Field label, short as on a bike computer. */
  short: string;
  /** Full name, for the menu and screen readers. */
  label: string;
}
const KINDS: Kind[] = [
  { field: 'speed', short: 'Spd.', label: 'Speed' },
  { field: 'hr', short: 'HR', label: 'Heart rate' },
  { field: 'cadence', short: 'Cad.', label: 'Cadence' },
  { field: 'power', short: 'Pwr.', label: 'Power' },
  { field: 'balance', short: 'L/R', label: 'Power balance' },
  { field: 'altitude', short: 'Alt.', label: 'Altitude' },
  { field: 'grade', short: 'Grd.', label: 'Grade' },
  { field: 'climb', short: 'Climb', label: 'Climb' },
  { field: 'temperature', short: 'Temp.', label: 'Temperature' },
  { field: 'clock', short: 'Clock', label: 'Time of day' },
];
const NAMES = new Set<string>(KINDS.map((k) => k.field));
/** Narrowest field, and below what width fields get tighter, CSS px. */
const FIELD_WIDTH = 80,
  DENSE_WIDTH = 110;
/** The navigation screen's sideways layout (style.css): turning the phone
    lays the fields out again. */
const SIDEWAYS = '(orientation: landscape) and (min-width: 560px)';
/** Hidden until chosen: the page keeps to six fields at first. */
const HIDDEN_BY_DEFAULT: Field[] = ['temperature', 'clock'];

function hiddenFields(): Set<Field> {
  const stored = readPreference(PREFERENCE.activityValues);
  if (stored === null) return new Set(HIDDEN_BY_DEFAULT);
  return new Set(stored.split(',').filter((v): v is Field => NAMES.has(v)));
}

/** The unit a value is shown in, with the device's units. */
export function unitOf(value: ActivityValue): string {
  const imperial = distanceUnits() === 'imperial';
  switch (value) {
    case 'speed':
      return imperial ? 'mph' : 'km/h';
    case 'hr':
      return 'bpm';
    case 'cadence':
      return 'rpm';
    case 'power':
      return 'W';
    case 'temperature':
      return temperatureUnits() === 'fahrenheit' ? '°F' : '°C';
    case 'balance':
    case 'grade':
      return '%';
    default:
      return imperial ? 'ft' : 'm';
  }
}
/** A recorded value (speed in m/s) in the device's units, as a number. */
export function valueLabel(value: ActivityValue, raw: number): string {
  const imperial = distanceUnits() === 'imperial';
  switch (value) {
    case 'speed':
      return String(Math.round(speedFromKmh(raw * 3.6, distanceUnits())));
    case 'temperature':
      return String(
        Math.round(
          temperatureUnits() === 'fahrenheit' ? (raw * 9) / 5 + 32 : raw,
        ),
      );
    case 'balance': {
      // Left / right, as bike computers write it.
      const left = Math.round(raw);
      return `${left}/${100 - left}`;
    }
    case 'grade':
      return `${raw > 0.5 ? '+' : ''}${Math.round(raw)}`;
    case 'altitude':
    case 'climb': {
      const meters = Math.round(imperial ? raw * 3.280839895 : raw);
      return value === 'climb' ? `+${meters}` : String(meters);
    }
    default:
      return String(Math.round(raw));
  }
}

export function activityValues(locale: () => string, onChange: () => void) {
  const page = $('nav-activity'),
    button = $<HTMLButtonElement>('nav-values'),
    menu = $('nav-values-menu');
  iconControl(button, 'settings', 'Values shown', true);
  let cells = new Map<Field, HTMLElement>();

  function setMenu(open: boolean) {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLElement>('input')?.focus();
  }
  button.onclick = () => setMenu(menu.hidden !== false);
  // A press anywhere else closes the menu; Escape too, before the screen.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    if (!menu.hidden && !target?.closest('#nav-values-menu, #nav-values'))
      setMenu(false);
  });
  // Turning the phone lays the fields out again, also while paused.
  matchMedia(SIDEWAYS).addEventListener('change', onChange);
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setMenu(false);
    button.focus();
  });

  /** Sets up the fields and menu for the values an activity has. */
  function build(activity: Activity) {
    const kinds = KINDS.filter((k) =>
      k.field === 'speed' || k.field === 'clock'
        ? true
        : k.field === 'altitude' || k.field === 'climb' || k.field === 'grade'
          ? !!activity.altitude
          : !!activity.values[k.field],
    );
    cells = new Map();
    page.replaceChildren(
      ...kinds.map((k) => {
        const cell = document.createElement('div');
        cell.className = `nav-activity-value nav-activity-${k.field}`;
        cell.setAttribute('role', 'group');
        cell.setAttribute('aria-label', k.label);
        const reading = document.createElement('span');
        reading.className = 'nav-activity-reading';
        reading.append(
          text('b', MISSING),
          text('small', k.field === 'clock' ? '' : unitOf(k.field)),
        );
        cell.append(text('span', k.short, 'nav-activity-label'), reading);
        cells.set(k.field, cell);
        return cell;
      }),
    );
    const hidden = hiddenFields();
    // Checkboxes as in Map layers' Route marks.
    menu.replaceChildren(
      ...kinds.map((k) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('role', 'menuitemcheckbox');
        input.checked = !hidden.has(k.field);
        input.setAttribute('aria-checked', String(input.checked));
        input.onchange = () => {
          const now = hiddenFields();
          if (input.checked) now.delete(k.field);
          else now.add(k.field);
          // Stored even when empty, so the default does not come back.
          writePreference(PREFERENCE.activityValues, [...now].join(','));
          input.setAttribute('aria-checked', String(input.checked));
          onChange();
        };
        wrapper.append(input, text('span', k.label));
        return wrapper;
      }),
    );
    button.hidden = false;
  }

  /** The fields at a recorded time, in the places the traveler keeps. */
  function render(activity: Activity, time: number) {
    const values = valuesAt(activity, time);
    const hidden = hiddenFields();
    let count = 0,
      last: HTMLElement | null = null;
    for (const [field, cell] of cells) {
      cell.hidden = hidden.has(field);
      cell.style.gridColumn = '';
      if (cell.hidden) continue;
      count++;
      last = cell;
      let shown: string;
      if (field === 'clock')
        shown = new Date(time).toLocaleTimeString(locale(), {
          hour: '2-digit',
          minute: '2-digit',
        });
      else {
        const raw = values[field];
        shown = raw === undefined ? MISSING : valueLabel(field, raw);
        const unit = cell.querySelector('small')!;
        if (unit.textContent !== unitOf(field))
          unit.textContent = unitOf(field);
      }
      const number = cell.querySelector('b')!;
      if (number.textContent !== shown) number.textContent = shown;
    }
    // As few lines as the width allows (a field needs about 80 px, four at
    // most), the fields shared evenly among them.
    const most = Math.min(
      4,
      Math.max(2, Math.floor(page.clientWidth / FIELD_WIDTH)),
    );
    const lines = Math.ceil(count / most) || 1;
    const columns = Math.ceil(count / lines) || 1;
    page.style.setProperty('--columns', String(columns));
    page.classList.toggle('dense', page.clientWidth / columns < DENSE_WIDTH);
    // The last field takes what its row leaves, so no empty place shows.
    const left = count % columns;
    if (last && left) last.style.gridColumn = `span ${columns - left + 1}`;
    page.hidden = !count;
  }

  function end() {
    setMenu(false);
    button.hidden = true;
    page.hidden = true;
    page.replaceChildren();
    menu.replaceChildren();
    cells = new Map();
  }

  return { build, render, end };
}
