/**
 * Element lookup for every module: `byId` (imported as `$`) for elements the
 * page markup always provides, `optionalById` where an element may be
 * absent (created later, or on another page); `text` creates an element
 * with its text, `classVariable` reads a custom property a class sets, and
 * `SVG_NS` is the namespace of every SVG element made in code.
 */
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const optionalById = <T extends HTMLElement = HTMLElement>(
  id: string,
): T | null => document.getElementById(id) as T | null;
/** A new element with its text and class. */
export const text = (tag: string, value: string, className = '') => {
  const e = document.createElement(tag);
  e.textContent = value;
  e.className = className;
  return e;
};

/**
 * A custom property's value under a class, such as a coloring's color, read
 * from the stylesheet through a hidden probe element.
 */
export function classVariable(className: string, property: string): string {
  const probe = document.createElement('i');
  probe.className = className;
  probe.hidden = true;
  document.body.append(probe);
  const value = getComputedStyle(probe).getPropertyValue(property).trim();
  probe.remove();
  return value;
}
