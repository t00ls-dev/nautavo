/**
 * Element lookup for every module: `byId` (imported as `$`) for elements the
 * page markup always provides, `optionalById` where an element may be
 * absent (created later, or on another page).
 */
export const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const optionalById = <T extends HTMLElement = HTMLElement>(
  id: string,
): T | null => document.getElementById(id) as T | null;
