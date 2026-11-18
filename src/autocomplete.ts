import { photonSearch, type SearchResult } from './search';
import { parseCoordinates, type Coord } from './core';
import { icon, type IconName } from './icons';

/** A choice listed above the suggestions: My location, Choose on map. */
export interface SearchAction {
  label: string;
  icon: IconName;
  run: () => void;
  /** A short note at the end of the row, such as a distance. */
  detail?: string | undefined;
  /** A second line below the label, such as a favorite's address. */
  note?: string;
  /** A section title shown above this choice, such as Favorite places. */
  heading?: string | undefined;
}
/** The first part of a result's name as its title, the rest below it. */
export function splitPlace(name: string): [string, string] {
  const parts = name.split(',').map((part) => part.trim());
  return [parts[0], parts.slice(1).filter(Boolean).join(', ')];
}

export function addressAutocomplete(
  input: HTMLInputElement,
  list: HTMLElement,
  config: {
    base: () => string;
    center: () => Coord;
    valid: () => boolean;
    choose: (result: SearchResult) => void;
    pending: () => void;
    completed: (count: number) => void;
    failed: () => void;
    /** Choices shown first while the field has focus (none when read-only). */
    actions?: () => SearchAction[];
    /** A short distance label for a result, or null. */
    distance?: (coord: Coord) => string | null;
  },
): () => void {
  let timer: ReturnType<typeof setTimeout>;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let version = 0,
    active = -1;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  list.setAttribute('role', 'listbox');
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.setAttribute('autocorrect', 'off');
  input.inputMode = 'search';
  const close = () => {
    version++;
    clearTimeout(timer);
    controller?.abort();
    list.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
  };
  const option = (id: string, onChoose: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `${list.id}-${id}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    let pressed = false,
      done = false;
    const choose = () => {
      if (done) return;
      done = true;
      close();
      onChoose();
    };
    // The field keeps focus where the browser allows it. On phones the
    // keyboard closes and the panel moves under the finger before a click
    // arrives, so a touch chooses when it lifts on the same option.
    button.onpointerdown = (event) => {
      event.preventDefault();
      pressed = true;
    };
    button.onpointerleave = () => (pressed = false);
    button.onpointerup = (event) => {
      if (!pressed || event.pointerType === 'mouse') return;
      event.preventDefault();
      choose();
    };
    button.onclick = choose;
    list.append(button);
    return button;
  };
  /** The actions alone, as the field gets focus or its text changes. */
  const showActions = () => {
    if (input.readOnly || !config.actions) return;
    config.actions().forEach((action, i) => {
      if (action.heading) {
        const heading = document.createElement('div');
        heading.className = 'suggestion-heading';
        heading.setAttribute('role', 'presentation');
        heading.textContent = action.heading;
        list.append(heading);
      }
      const button = option(`action-${i}`, action.run);
      // A choice with a second line reads as a place (a favorite), not as
      // one of the field's commands.
      button.className = action.note
        ? 'suggestion-place suggestion-saved'
        : 'suggestion-action';
      const label = document.createElement('span');
      if (action.note) {
        const name = document.createElement('b');
        name.textContent = action.label;
        const more = document.createElement('small');
        more.textContent = action.note;
        label.append(name, more);
      } else label.textContent = action.label;
      button.append(icon(action.icon), label);
      if (action.detail) {
        const detail = document.createElement('em');
        detail.textContent = action.detail;
        button.append(detail);
      }
      const spoken = [action.label, action.note, action.detail].filter(Boolean);
      if (spoken.length > 1)
        button.setAttribute('aria-label', spoken.join(', '));
    });
    input.setAttribute('aria-expanded', String(list.children.length > 0));
  };
  input.addEventListener('focus', () => {
    clearTimeout(blurTimer);
    if (!list.children.length) showActions();
  });
  input.addEventListener('input', () => {
    close();
    showActions();
    const query = input.value.trim();
    if (
      query.length < 3 ||
      parseCoordinates(query) ||
      /^[\s()+\d.,;-]+$/.test(query) ||
      (/^[\s(+-]*\d/.test(query) && /[,;]/.test(query))
    )
      return;
    const requestVersion = version;
    timer = setTimeout(() => {
      config.pending();
      controller = new AbortController();
      void photonSearch(
        query,
        config.base(),
        config.center(),
        controller.signal,
      )
        .then((results) => {
          if (
            requestVersion !== version ||
            !config.valid() ||
            !input.isConnected ||
            input.value.trim() !== query ||
            document.activeElement !== input
          )
            return;
          results.forEach((result, i) =>
            placeOption(
              option(String(i), () => config.choose(result)),
              result,
              config.distance,
            ),
          );
          input.setAttribute('aria-expanded', String(list.children.length > 0));
          config.completed(results.length);
        })
        .catch((error: unknown) => {
          if (
            requestVersion === version &&
            (error as Error | null)?.name !== 'AbortError' &&
            config.valid()
          )
            config.failed();
        });
    }, 300);
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const options = [
      ...list.querySelectorAll<HTMLButtonElement>('[role=option]'),
    ];
    if (
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      options.length
    ) {
      event.preventDefault();
      active =
        active < 0
          ? event.key === 'ArrowDown'
            ? 0
            : options.length - 1
          : (active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) %
            options.length;
      options.forEach((option, i) =>
        option.setAttribute('aria-selected', String(i === active)),
      );
      input.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && active >= 0 && options[active]) {
      event.preventDefault();
      options[active].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  // Losing focus closes the list a moment later, so a choice on its way
  // (a tap that blurred the field first) still lands.
  input.addEventListener('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (document.activeElement !== input) close();
    }, 300);
  });
  return close;
}
/**
 * One place in a list of places: pin, name, the rest of its address and the
 * distance, with the whole name as its accessible name. Suggestions while
 * typing and the results of an Enter search share it (#214).
 */
export function placeOption(
  button: HTMLButtonElement,
  result: SearchResult,
  distance?: (coord: Coord) => string | null,
): HTMLButtonElement {
  button.classList.add('suggestion-place');
  const [title, detail] = splitPlace(result.display_name);
  const text = document.createElement('span');
  const name = document.createElement('b');
  name.textContent = title;
  text.append(name);
  if (detail) {
    const more = document.createElement('small');
    more.textContent = detail;
    text.append(more);
  }
  button.append(icon('pin'), text);
  const coord = parseCoordinates(`${result.lat},${result.lon}`);
  const away = coord && distance?.(coord);
  if (away) {
    const label = document.createElement('em');
    label.textContent = away;
    button.append(label);
  }
  button.setAttribute(
    'aria-label',
    away ? `${result.display_name}, ${away}` : result.display_name,
  );
  return button;
}
