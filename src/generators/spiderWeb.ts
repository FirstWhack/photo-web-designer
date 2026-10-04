/**
 * Spider web: spokes from a hub plus a spiral or concentric rings.
 * Nails sit at every spoke/ring crossing so the twine can turn there.
 * Outer anchors sit exactly on the unit circle at ringPoint(j, spokes) so the web
 * shares nails with string-art / star / curve-stitch rings of matching counts.
 */
import type { Generator, ParamSchema } from '@/contracts/generator';
import { createRng } from '@/lib/rng';
import { Builder, centredTransform, readParams, ringPoint } from './util';

const schema: ParamSchema = [
  { key: 'spokes', label: 'Spokes', kind: 'int', min: 3, max: 24, default: 8, hint: 'Radial threads from the hub' },
  { key: 'rings', label: 'Rings', kind: 'int', min: 1, max: 12, default: 5, hint: 'Rings, or turns of the spiral' },
  {
    key: 'style',
    label: 'Capture thread',
    kind: 'select',
    options: [
      { value: 'spiral', label: 'Spiral' },
      { value: 'rings', label: 'Concentric rings' },
    ],
    default: 'spiral',
  },
  {
    key: 'spacing',
    label: 'Ring spacing',
    kind: 'number',
    min: -1,
    max: 1,
    step: 0.05,
    default: 0.3,
    hint: '+ crowds rings toward the hub, − toward the rim',
  },
  {
    key: 'irregularity',
    label: 'Irregularity',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
    hint: 'Hand-made wobble (anchors stay put)',
  },
  { key: 'hubNail', label: 'Hub nail', kind: 'bool', default: true, hint: 'Nail at the centre, or a small open hub' },
];

const R_OUT = 0.86;
const MIN_GAP = 0.05;

function generate(params: Parameters<Generator['generate']>[0], seed: number) {
  const p = readParams(schema, params);
  const spokes = p.num('spokes');
  const rings = p.num('rings');
  const spiral = p.str('style') === 'spiral';
  const spacing = p.num('spacing');
  const irr = p.num('irregularity');
  const hubNail = p.bool('hubNail');
  const rng = createRng(seed);

  // Hub radius big enough that hub-ring nails keep their spacing.
  const rHub = Math.max(0.1, 0.035 / (2 * Math.sin(Math.PI / spokes)) + 0.01);
  // Radii levels R[0] = hub, R[1..L] = rings (spiral needs one extra level for its turns).
  const L = spiral ? rings + 1 : rings;
  const raw = Array.from({ length: L }, (_, k) => Math.exp(spacing * 2 * (L > 1 ? k / (L - 1) : 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const total = R_OUT - rHub;
  const gaps = raw.map((g) => MIN_GAP + (total - L * MIN_GAP) * (g / sum));
  const R = [rHub];
  for (const g of gaps) R.push(R[R.length - 1] + g);
  const radiusAt = (level: number) => {
    const k = Math.min(Math.floor(level), R.length - 2);
    const f = level - k;
    return R[k] + (R[k + 1] - R[k]) * f;
  };
  const gapAt = (level: number) => gaps[Math.min(Math.max(Math.floor(level), 0), gaps.length - 1)];

  const step = (2 * Math.PI) / spokes;
  const spokeAngle = Array.from({ length: spokes }, (_, j) => -Math.PI / 2 + j * step + (rng.next() - 0.5) * irr * 0.5 * step);

  const b = new Builder();
  const crossings: { r: number; idx: number }[][] = Array.from({ length: spokes }, () => []);
  const place = (j: number, level: number) => {
    const r = radiusAt(level) + (rng.next() - 0.5) * irr * 0.3 * gapAt(level);
    const a = spokeAngle[j] + (rng.next() - 0.5) * irr * 0.15 * step;
    const idx = b.nail(r * Math.cos(a), r * Math.sin(a));
    crossings[j].push({ r, idx });
    return idx;
  };

  const centre = hubNail ? b.nail(0, 0) : -1;
  const anchors = Array.from({ length: spokes }, (_, j) => {
    const q = ringPoint(j, spokes);
    return b.nail(q.x, q.y);
  });

  if (!hubNail) {
    const hub = Array.from({ length: spokes }, (_, j) => place(j, 0));
    b.path(hub, undefined, true);
  }

  if (spiral) {
    const path: number[] = [];
    for (let s = 0; s <= rings * spokes; s++) path.push(place(s % spokes, 1 + s / spokes));
    b.path(path);
  } else {
    for (let k = 1; k <= rings; k++) {
      b.path(
        Array.from({ length: spokes }, (_, j) => place(j, k)),
        undefined,
        true,
      );
    }
  }

  for (let j = 0; j < spokes; j++) {
    const list = crossings[j].slice().sort((u, v) => u.r - v.r).map((c) => c.idx);
    const chain = hubNail ? [centre, ...list, anchors[j]] : [...list, anchors[j]];
    b.path(chain);
  }
  return b.output();
}

export const spiderWeb: Generator = {
  id: 'spider-web',
  label: 'Spider web',
  description: 'Spokes from a hub with a spiral or rings of capture thread.',
  schema,
  suggestTransform: centredTransform,
  generate,
};
