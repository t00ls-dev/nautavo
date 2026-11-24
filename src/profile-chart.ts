import { SVG_NS } from './dom';
/**
 * A profile chart over the along-track distance: one filled area per part
 * (GPX segments stay as breaks), a guide line for the cursor and the ratio
 * of a pointer position across it. Shared by the Elevation row and the
 * activity view's charts. DOM only; no data or map.
 */

export const CHART_WIDTH = 300;
/** Height of a tick at the base of a chart, in chart units. */
const TICK = 12;

export interface ChartPoint {
  /** Along-track meters. */
  at: number;
  value: number;
}

export function profileChart(options: {
  parts: ChartPoint[][];
  /** Along-track meters at the right edge. */
  total: number;
  min: number;
  max: number;
  height: number;
  pad: number;
  className: string;
  /** Along-track meters marked by a short tick at the base (stops). */
  ticks?: number[];
}): {
  svg: SVGSVGElement;
  /** Along-track meters to a chart x. */
  x: (at: number) => number;
  /** Along-track meters under a pointer event (`x` reversed). */
  atPointer: (event: PointerEvent) => number;
  /** Shows the guide at along-track meters, or hides it with null. */
  guide: (at: number | null) => void;
} {
  const { parts, total, min, max, height, pad } = options;
  const span = Math.max(1e-9, max - min);
  const x = (at: number) => pad + (at / (total || 1)) * (CHART_WIDTH - 2 * pad);
  const y = (value: number) =>
    pad + (1 - (value - min) / span) * (height - 2 * pad);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('chart-svg', options.className);
  for (const part of parts) {
    if (!part.length) continue;
    const line = part.map(
      (p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`,
    );
    const area = document.createElementNS(SVG_NS, 'path');
    area.setAttribute(
      'd',
      `M${x(part[0].at).toFixed(1)},${height} L${line.join(' L')} L${x(part.at(-1)!.at).toFixed(1)},${height} Z`,
    );
    area.classList.add('chart-area');
    const stroke = document.createElementNS(SVG_NS, 'path');
    stroke.setAttribute('d', `M${line.join(' L')}`);
    stroke.classList.add('chart-line');
    svg.append(area, stroke);
  }
  for (const at of options.ticks ?? []) {
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.classList.add('chart-tick');
    tick.setAttribute('x1', x(at).toFixed(1));
    tick.setAttribute('x2', x(at).toFixed(1));
    tick.setAttribute('y1', String(height - TICK));
    tick.setAttribute('y2', String(height));
    svg.append(tick);
  }
  const guide = document.createElementNS(SVG_NS, 'line');
  guide.classList.add('chart-guide');
  guide.setAttribute('y1', '0');
  guide.setAttribute('y2', String(height));
  guide.style.display = 'none';
  svg.append(guide);
  return {
    svg,
    x,
    atPointer: (event) =>
      Math.min(
        total,
        Math.max(
          0,
          ((pointerRatio(event, svg) * CHART_WIDTH - pad) /
            (CHART_WIDTH - 2 * pad)) *
            total,
        ),
      ),
    guide: (at) => {
      if (at === null) {
        guide.style.display = 'none';
        return;
      }
      guide.setAttribute('x1', x(at).toFixed(1));
      guide.setAttribute('x2', x(at).toFixed(1));
      guide.style.display = '';
    },
  };
}

/** Where a pointer is across an element, from 0 (left) to 1 (right). */
function pointerRatio(event: PointerEvent, element: Element): number {
  const box = element.getBoundingClientRect();
  return Math.min(
    1,
    Math.max(0, (event.clientX - box.left) / (box.width || 1)),
  );
}

/** A chart with its highest and lowest values labeled at the left. */
export function chartFrame(
  svg: SVGSVGElement,
  top: string,
  bottom: string,
): HTMLDivElement {
  const labels = document.createElement('div');
  labels.className = 'chart-labels';
  labels.setAttribute('aria-hidden', 'true');
  for (const value of [top, bottom]) {
    const label = document.createElement('span');
    label.textContent = value;
    labels.append(label);
  }
  const frame = document.createElement('div');
  frame.className = 'chart-frame';
  frame.append(svg, labels);
  return frame;
}

/** The distance axis under a chart: its start and end. */
export function chartAxis(start: string, end: string): HTMLParagraphElement {
  const axis = document.createElement('p');
  axis.className = 'chart-axis hint';
  for (const value of [start, end]) {
    const label = document.createElement('span');
    label.textContent = value;
    axis.append(label);
  }
  return axis;
}
