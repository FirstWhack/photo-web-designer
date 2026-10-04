/**
 * String art by modular multiplication: N nails around a perimeter, i → round(k·i + offset) mod N.
 * k = 2 draws a cardioid, k = 3 a nephroid; fractional k morphs between figures.
 */
import type { ParamValues } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { Builder, centredTransform, readParams, samplePerimeter, type PerimeterShape } from './util';

const schema: ParamSchema = [
  { key: 'nails', label: 'Nails', kind: 'int', min: 10, max: 150, default: 60, hint: 'Nails around the edge' },
  {
    key: 'multiplier',
    label: 'Multiplier k',
    kind: 'number',
    min: 1,
    max: 50,
    step: 0.01,
    default: 2,
    hint: '2 = cardioid, 3 = nephroid; try fractions',
  },
  { key: 'offset', label: 'Offset', kind: 'int', min: 0, max: 149, default: 0, hint: 'Shifts every target nail' },
  {
    key: 'shape',
    label: 'Shape',
    kind: 'select',
    options: [
      { value: 'circle', label: 'Circle' },
      { value: 'ellipse', label: 'Ellipse' },
      { value: 'rounded-square', label: 'Rounded square' },
    ],
    default: 'circle',
  },
  { key: 'outline', label: 'Outline', kind: 'bool', default: true, hint: 'Also string neighbouring nails' },
];

function generate(params: ParamValues) {
  const p = readParams(schema, params);
  const n = p.num('nails');
  const k = p.num('multiplier');
  const offset = p.num('offset');
  const pts = samplePerimeter(p.str('shape') as PerimeterShape, n);
  const b = new Builder();
  const idx = pts.map((q) => b.nail(q.x, q.y));
  for (let i = 0; i < n; i++) {
    const j = (((Math.round(k * i) + offset) % n) + n) % n;
    b.edge(idx[i], idx[j]);
  }
  if (p.bool('outline')) b.path(idx, undefined, true);
  return b.output();
}

export const stringArt: Generator = {
  id: 'string-art',
  label: 'String art',
  description: 'Times-table string art: cardioids, nephroids and morphing envelopes.',
  schema,
  suggestTransform: centredTransform,
  generate,
};
