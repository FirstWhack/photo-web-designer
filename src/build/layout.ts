import type { Units } from '@/contracts/design';
import type { MeasureOrigin } from '@/contracts/ui';
import type { CoordRow } from './coords';

export type MarkOrder = 'rows' | 'columns' | 'number';

/** How far apart (wall units) two nails can be and still count as the same row or column. */
export const clusterTolerance = (units: Units) => (units === 'cm' ? 1.5 : 0.5);

/** Allowed error when checking a measurement against the plan: 1/8" or 3 mm. */
export const checkTolerance = (units: Units) => (units === 'cm' ? 0.3 : 0.125);

/**
 * Marking order. Rows and columns sweep in a snake so you never walk back across the wall;
 * x and y are already measured from the chosen datum corner.
 */
export function markOrder(rows: CoordRow[], by: MarkOrder, tol: number): CoordRow[] {
  if (by === 'number') return [...rows];
  const major = by === 'rows' ? 'y' : 'x';
  const minor = by === 'rows' ? 'x' : 'y';
  const sorted = [...rows].sort((a, b) => a[major] - b[major] || a[minor] - b[minor]);
  const out: CoordRow[] = [];
  let cluster: CoordRow[] = [];
  let flip = false;
  const flush = () => {
    cluster.sort((a, b) => a[minor] - b[minor]);
    if (flip) cluster.reverse();
    out.push(...cluster);
    cluster = [];
    flip = !flip;
  };
  for (const r of sorted) {
    if (cluster.length && r[major] - cluster[cluster.length - 1][major] > tol) flush();
    cluster.push(r);
  }
  flush();
  return out;
}

export type LayoutItem = { kind: 'nail'; row: CoordRow } | { kind: 'check'; a: CoordRow; b: CoordRow; distance: number };

const dist = (a: CoordRow, b: CoordRow) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The marking sequence with a recommended distance check after every `every` nails and at the end:
 * the nail just marked against the marked nail farthest from it.
 */
export function buildItems(order: CoordRow[], every = 10, minDistance = 0): LayoutItem[] {
  const items: LayoutItem[] = [];
  order.forEach((row, i) => {
    items.push({ kind: 'nail', row });
    const atEnd = i === order.length - 1;
    if (i < 1 || !((i + 1) % every === 0 || atEnd)) return;
    let far = order[0];
    for (let j = 1; j < i; j++) if (dist(row, order[j]) > dist(row, far)) far = order[j];
    const distance = dist(row, far);
    if (distance > minDistance) items.push({ kind: 'check', a: far, b: row, distance });
  });
  return items;
}

/** `17 1/4"` (nearest 1/16) for inches, `43.8 cm` for centimetres. */
export function formatLength(value: number, units: Units): string {
  if (units === 'cm') return `${value.toFixed(1)} cm`;
  const sixteenths = Math.round(Math.abs(value) * 16);
  const whole = Math.trunc(sixteenths / 16);
  let num = sixteenths % 16;
  let den = 16;
  while (num !== 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const sign = value < 0 && sixteenths > 0 ? '-' : '';
  if (num === 0) return `${sign}${whole}"`;
  return `${sign}${whole === 0 ? '' : whole + ' '}${num}/${den}"`;
}

/** Parses `41.5`, `41 3/8`, `3/8` or `41-3/8` (a trailing `"` or `cm` is ignored). Null when unreadable. */
export function parseLength(text: string): number | null {
  const t = text.trim().replace(/(cm|in|")$/i, '').trim();
  if (!t) return null;
  const mixed = /^(\d+)[\s-]+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : null;
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  return /^\d*\.?\d+$/.test(t) ? Number(t) : null;
}

export interface CheckResult {
  ok: boolean;
  /** measured − expected, in wall units. */
  diff: number;
}

export const checkMeasurement = (measured: number, expected: number, tol: number): CheckResult => ({
  ok: Math.abs(measured - expected) <= tol + 1e-9,
  diff: measured - expected,
});

export const DATUM_WORDS: Record<MeasureOrigin, { corner: string; across: string; down: string }> = {
  'top-left': { corner: 'top-left', across: 'from the left edge', down: 'down from the top edge' },
  'top-right': { corner: 'top-right', across: 'from the right edge', down: 'down from the top edge' },
  'bottom-left': { corner: 'bottom-left', across: 'from the left edge', down: 'up from the bottom edge' },
  'bottom-right': { corner: 'bottom-right', across: 'from the right edge', down: 'up from the bottom edge' },
};
