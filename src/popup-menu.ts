/**
 * A button that opens a small menu of buttons beside it (the Export menu):
 * a choice, a click elsewhere or Escape closes it, and
 * Escape returns focus to the button. Returns the function that shows or
 * hides the menu, for callers that close it from elsewhere.
 */
export function popupMenu(
  toggle: HTMLElement,
  menu: HTMLElement,
  onOpen?: () => void,
): (open: boolean) => void {
  const show = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  };
  toggle.addEventListener('click', () => {
    const open = menu.hasAttribute('hidden');
    show(open);
    if (!open) return;
    onOpen?.();
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('button')) show(false);
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!menu.hidden && !menu.contains(target) && !toggle.contains(target))
      show(false);
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    show(false);
    toggle.focus();
  });
  return show;
}
