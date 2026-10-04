import type { NailId, ResolvedDesign, Wall } from '@/contracts/design';
import type { MeasureOrigin } from '@/contracts/ui';
import { nailLabels } from '@/lib/labels';

/**
 * Convert a wall point (origin top-left, y down) into distances measured from `origin`:
 * x = horizontal distance from the origin's side, y = vertical distance from the origin's side.
 * Both are positive inside the wall.
 */
export function measureFrom(p: { x: number; y: number }, wall: Pick<Wall, 'width' | 'height'>, origin: MeasureOrigin) {
  const fromRight = origin === 'top-right' || origin === 'bottom-right';
  const fromBottom = origin === 'bottom-left' || origin === 'bottom-right';
  return { x: fromRight ? wall.width - p.x : p.x, y: fromBottom ? wall.height - p.y : p.y };
}

export interface CoordRow {
  id: NailId;
  label: string;
  x: number;
  y: number;
}

/** One row per nail, sorted by its label number. */
export function coordRows(resolved: ResolvedDesign, origin: MeasureOrigin): CoordRow[] {
  const labels = nailLabels(resolved.nails);
  return resolved.nails
    .map((n) => ({ id: n.id, label: labels[n.id], ...measureFrom(n, resolved.wall, origin) }))
    .sort((a, b) => Number(a.label) - Number(b.label));
}

const num = (v: number) => String(Number(v.toFixed(3)));

export function coordCsv(rows: CoordRow[], units: string, origin: MeasureOrigin): string {
  const head = `nail,x (${units} from ${origin} side),y (${units} from ${origin} side)`;
  return [head, ...rows.map((r) => `${r.label},${num(r.x)},${num(r.y)}`)].join('\n');
}
