/**
 * Swag: draped garland tiers between a row (or arc) of nails — the plain, practical photo line.
 * Swag edges carry a high per-edge sag so they droop; the optional criss-cross between tiers is near-taut.
 */
import type { ParamValues, Wall } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { Builder, readParams } from './util';

const schema: ParamSchema = [
  { key: 'nails', label: 'Nails per tier', kind: 'int', min: 2, max: 16, default: 6 },
  { key: 'tiers', label: 'Tiers', kind: 'int', min: 1, max: 6, default: 3 },
  {
    key: 'layout',
    label: 'Layout',
    kind: 'select',
    options: [
      { value: 'row', label: 'Straight rows' },
      { value: 'arc', label: 'Arch' },
      { value: 'smile', label: 'Smile' },
    ],
    default: 'row',
  },
  { key: 'sag', label: 'Droop', kind: 'number', min: 0.3, max: 1, step: 0.01, default: 0.7, hint: 'How low each swag hangs' },
  { key: 'stagger', label: 'Stagger tiers', kind: 'bool', default: true, hint: 'Offset alternate tiers by half a swag' },
  { key: 'crissCross', label: 'Criss-cross', kind: 'bool', default: false, hint: 'Zig-zag strands between tiers' },
];

function generate(params: ParamValues) {
  const p = readParams(schema, params);
  const n = p.num('nails');
  const tiers = p.num('tiers');
  const layout = p.str('layout');
  const sag = p.num('sag');
  const stagger = p.bool('stagger') && n >= 3;
  const criss = p.bool('crissCross');

  const bow = layout === 'arc' ? 0.45 : layout === 'smile' ? -0.45 : 0;
  // Tier baselines leave room for the droop of the bottom tier.
  const top = -1 + Math.max(0, bow);
  const bottom = 0.75 + Math.min(0, bow);
  const b = new Builder();
  const rowsIdx: number[][] = [];
  for (let t = 0; t < tiers; t++) {
    const y0 = tiers === 1 ? (top + bottom) / 2 : top + ((bottom - top) * t) / (tiers - 1);
    const shifted = stagger && t % 2 === 1;
    const count = shifted ? n - 1 : n;
    const row: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = n === 1 ? 0 : -1 + (2 * (i + (shifted ? 0.5 : 0))) / (n - 1);
      // bow > 0: arch (middle higher, i.e. smaller y).
      const y = y0 - bow * (1 - x * x);
      row.push(b.nail(x, y));
    }
    b.path(row, sag);
    rowsIdx.push(row);
  }
  if (criss) {
    for (let t = 0; t + 1 < tiers; t++) {
      const A = rowsIdx[t], B = rowsIdx[t + 1];
      if (A.length === B.length) {
        for (let i = 0; i + 1 < A.length; i++) {
          b.edge(A[i], B[i + 1], 0.08);
          b.edge(A[i + 1], B[i], 0.08);
        }
      } else {
        // Staggered tiers: zig-zag between the longer and shorter row.
        const [L, S] = A.length > B.length ? [A, B] : [B, A];
        for (let i = 0; i < S.length; i++) {
          b.edge(L[i], S[i], 0.08);
          b.edge(S[i], L[i + 1], 0.08);
        }
      }
    }
  }
  return b.output();
}

export function swagTransform(wall: Wall) {
  return { x: wall.width / 2, y: wall.height * 0.3, scaleX: 0.45 * wall.width, scaleY: 0.2 * wall.height, rotation: 0 };
}

export const swag: Generator = {
  id: 'swag',
  label: 'Swag garland',
  description: 'Draped tiers of twine between nails — the classic photo line.',
  schema,
  suggestTransform: swagTransform,
  generate,
};
