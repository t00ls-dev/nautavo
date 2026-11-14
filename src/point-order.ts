// Reordering route points in the editor: drag a row by its grip (mouse,
// touch or pen), or focus the grip and use the up and down arrow keys. Rows
// make room while one is dragged and every number follows its new position;
// the points are reordered only on drop, through `moved`.

/**
 * Where a row dragged from `from` lands, given its current center and the
 * resting centers of all rows (in the same coordinates).
 */
export function dropIndex(
  center: number,
  centers: number[],
  from: number,
): number {
  // A row makes room once the dragged center passes the middle between it
  // and its neighbor on the dragged row's side.
  let to = from;
  while (
    to < centers.length - 1 &&
    center > (centers[to] + centers[to + 1]) / 2
  )
    to++;
  while (to > 0 && center < (centers[to - 1] + centers[to]) / 2) to--;
  return to;
}

/** Moves one item in place, keeping the others in order. */
export function moveItem<T>(items: T[], from: number, to: number): void {
  if (from === to) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

/** The scroll container of `element`: the nearest that scrolls vertically. */
function scrollParent(element: HTMLElement): HTMLElement {
  for (let e = element.parentElement; e; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if (/(auto|scroll)/.test(overflow) && e.scrollHeight > e.clientHeight)
      return e;
  }
  return document.scrollingElement as HTMLElement;
}

const EDGE = 48; // px from the scroll edge where dragging scrolls the list
const SPEED = 10; // px per frame

export function setupPointOrder(
  list: HTMLElement,
  options: {
    /** Whether the points may be reordered now (not locked). */
    enabled: () => boolean;
    /** Reorders the points (the list is drawn again). */
    moved: (from: number, to: number) => void;
    /** A drag starts: close suggestions and results. */
    start?: () => void;
  },
) {
  const rows = () => Array.from(list.children) as HTMLElement[];
  const gripOf = (index: number) =>
    rows()[index]?.querySelector<HTMLButtonElement>('.point-grip');
  const number = (row: HTMLElement, value: number) => {
    const n = row.querySelector('.point-number');
    if (n) n.textContent = String(value);
  };

  let drag: {
    pointer: number;
    grip: HTMLElement;
    rows: HTMLElement[];
    centers: number[];
    from: number;
    to: number;
    shift: number;
    startY: number;
    lastY: number;
    min: number;
    max: number;
    scroller: HTMLElement;
    scroll0: number;
    frame: number;
    lifted: boolean;
  } | null = null;

  const layout = () => {
    if (!drag) return;
    const d = drag;
    const scrolled = d.scroller.scrollTop - d.scroll0;
    const dy = Math.min(d.max, Math.max(d.min, d.lastY - d.startY + scrolled));
    d.to = dropIndex(d.centers[d.from] + dy, d.centers, d.from);
    d.rows.forEach((row, j) => {
      if (j === d.from) {
        row.style.transform = `translateY(${dy}px)`;
        number(row, d.to + 1);
        return;
      }
      const offset =
        j > d.from && j <= d.to
          ? -d.shift
          : j < d.from && j >= d.to
            ? d.shift
            : 0;
      row.style.transform = offset ? `translateY(${offset}px)` : '';
      number(row, j + 1 + (offset < 0 ? -1 : offset > 0 ? 1 : 0));
    });
  };
  const autoScroll = () => {
    if (!drag) return;
    const d = drag;
    const box =
      d.scroller === document.scrollingElement
        ? { top: 0, bottom: innerHeight }
        : d.scroller.getBoundingClientRect();
    const step =
      d.lastY < box.top + EDGE
        ? -SPEED
        : d.lastY > box.bottom - EDGE
          ? SPEED
          : 0;
    if (step) {
      const before = d.scroller.scrollTop;
      d.scroller.scrollTop += step;
      if (d.scroller.scrollTop !== before) layout();
    }
    d.frame = requestAnimationFrame(autoScroll);
  };
  const finish = (drop: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.frame);
    d.grip.releasePointerCapture?.(d.pointer);
    list.classList.remove('reordering');
    document.body.classList.remove('reordering-points');
    d.rows.forEach((row, j) => {
      row.classList.remove('dragging');
      row.style.transform = '';
      number(row, j + 1);
    });
    if (drop && d.lifted && d.to !== d.from && options.enabled())
      options.moved(d.from, d.to);
  };

  list.addEventListener('pointerdown', (event) => {
    const grip = (event.target as Element).closest<HTMLElement>('.point-grip');
    if (!grip || event.button !== 0 || drag || !options.enabled()) return;
    const all = rows();
    const from = all.findIndex((row) => row.contains(grip));
    if (from < 0 || all.length < 2) return;
    event.preventDefault();
    grip.setPointerCapture?.(event.pointerId);
    const rects = all.map((row) => row.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    const own = rects[from];
    drag = {
      pointer: event.pointerId,
      grip,
      rows: all,
      centers: rects.map((r) => r.top + r.height / 2),
      from,
      to: from,
      shift: own.height + gap,
      startY: event.clientY,
      lastY: event.clientY,
      min: rects[0].top - own.top,
      max: rects[rects.length - 1].bottom - own.bottom,
      scroller: scrollParent(list),
      scroll0: 0,
      frame: 0,
      lifted: false,
    };
    drag.scroll0 = drag.scroller.scrollTop;
  });
  list.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.lastY = event.clientY;
    if (!drag.lifted) {
      // A press without movement is not a drag.
      if (Math.abs(drag.lastY - drag.startY) < 4) return;
      drag.lifted = true;
      options.start?.();
      list.classList.add('reordering');
      document.body.classList.add('reordering-points');
      drag.rows[drag.from].classList.add('dragging');
      drag.frame = requestAnimationFrame(autoScroll);
    }
    layout();
  });
  list.addEventListener('pointerup', (event) => {
    if (drag && event.pointerId === drag.pointer) finish(true);
  });
  list.addEventListener('pointercancel', (event) => {
    if (drag && event.pointerId === drag.pointer) finish(false);
  });
  list.addEventListener('lostpointercapture', (event) => {
    if (drag && event.pointerId === drag.pointer) finish(true);
  });
  list.addEventListener('keydown', (event) => {
    const grip = (event.target as Element).closest<HTMLElement>('.point-grip');
    if (!grip) return;
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finish(false);
      return;
    }
    const delta =
      event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const all = rows();
    const from = all.findIndex((row) => row.contains(grip));
    const to = from + delta;
    if (from < 0 || to < 0 || to >= all.length || !options.enabled()) return;
    options.moved(from, to);
    gripOf(to)?.focus();
  });
}
