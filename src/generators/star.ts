/**
 * Star polygon {n/k} with optional nested, rotated, shrinking copies (mandala / spirograph).
 * The outer copy's points are ringPoint(i, n) so it shares nails with other ring layers.
 */
import type { ParamValues } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { Builder, MIN_NAIL_SPACING, centredTransform, readParams, ringPoint } from './util';

const schema: ParamSchema = [
  { key: 'points', label: 'Points', kind: 'int', min: 3, max: 36, default: 8, hint: 'n in {n/k}' },
  { key: 'skip', label: 'Skip', kind: 'int', min: 1, max: 17, default: 3, hint: 'k in {n/k}: how many nails each line jumps' },
  { key: 'copies', label: 'Copies', kind: 'int', min: 1, max: 12, default: 3, hint: 'Nested copies inside the first' },
  { key: 'rotationStep', label: 'Twist', kind: 'number', min: -60, max: 60, step: 0.5, default: 22.5, hint: 'Degrees each copy turns' },
  { key: 'scaleStep', label: 'Shrink', kind: 'number', min: 0.4, max: 0.95, step: 0.01, default: 0.62, hint: 'Size of each copy vs the previous' },
  { key: 'outline', label: 'Outline', kind: 'bool', default: false, hint: 'Also join neighbouring points' },
  { key: 'linkCopies', label: 'Link copies', kind: 'bool', default: false, hint: 'Join each point to the same point of the next copy' },
];

function generate(params: ParamValues) {
  const p = readParams(schema, params);
  const n = p.num('points');
  const k = Math.min(p.num('skip'), n - 1);
  const copies = p.num('copies');
  const rot = p.num('rotationStep');
  const shrink = p.num('scaleStep');
  const outline = p.bool('outline');
  const link = p.bool('linkCopies');

  const b = new Builder();
  const minR = (MIN_NAIL_SPACING * 1.3) / (2 * Math.sin(Math.PI / n));
  let prev: number[] | null = null;
  for (let c = 0; c < copies; c++) {
    const r = Math.pow(shrink, c);
    if (c > 0 && r < Math.max(minR, 0.06)) break;
    const ring = Array.from({ length: n }, (_, i) => {
      const q = ringPoint(i, n, r, rot * c);
      return b.nail(q.x, q.y);
    });
    for (let i = 0; i < n; i++) b.edge(ring[i], ring[(i + k) % n]);
    if (outline) b.path(ring, undefined, true);
    if (link && prev) for (let i = 0; i < n; i++) b.edge(prev[i], ring[i]);
    prev = ring;
  }
  return b.output();
}

export const star: Generator = {
  id: 'star',
  label: 'Star',
  description: 'Star polygons {n/k}, nested and twisted into mandalas.',
  schema,
  suggestTransform: centredTransform,
  generate,
};
