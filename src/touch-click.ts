/**
 * Drops the click that follows a press whose own action already ran on
 * release: browsers send that click after the finger lifts, aimed at whatever
 * is at that point by then, so once the action moved the page (a list closed,
 * the sheet opened or closed) it would press another control (#256). The next
 * press, or a second without any click, ends the wait, so a deliberate tap or
 * a later keyboard click is never lost.
 */
export function swallowNextClick(): void {
  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('pointerdown', stop, true);
  };
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  const timer = setTimeout(stop, 1000);
  document.addEventListener('click', swallow, true);
  document.addEventListener('pointerdown', stop, true);
}
