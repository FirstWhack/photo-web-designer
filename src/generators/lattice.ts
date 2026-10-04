/**
 * Lattice nets: square, triangular, hex (honeycomb) or diamond, with seeded strand removal
 * for a broken-net look and optional sine / pinch / bulge warps.
 */
import type { ParamValues, Vec2 } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { createRng } from '@/lib/rng';
import { Builder, centredTransform, fitPoints, readParams } from './util';

const schema: ParamSchema = [
  {
    key: 'pattern',
    label: 'Pattern',
    kind: 'select',
    options: [
      { value: 'triangular', label: 'Triangular' },
      { value: 'square', label: 'Square' },
      { value: 'hex', label: 'Honeycomb' },
      { value: 'diamond', label: 'Diamond' },
    ],
    default: 'triangular',
  },
  { key: 'rows', label: 'Rows', kind: 'int', min: 2, max: 20, default: 7 },
  { key: 'cols', label: 'Columns', kind: 'int', min: 2, max: 20, default: 7 },
  { key: 'removal', label: 'Broken strands', kind: 'number', min: 0, max: 0.6, step: 0.01, default: 0, hint: 'Chance each strand is left out' },
  {
    key: 'warp',
    label: 'Warp',
    kind: 'select',
    options: [
      { value: 'none', label: 'None' },
      { value: 'sine', label: 'Wave' },
      { value: 'pinch', label: 'Pinch' },
      { value: 'bulge', label: 'Bulge' },
    ],
    default: 'none',
  },
  { key: 'warpAmount', label: 'Warp amount', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.4 },
];

interface Net {
  pts: Vec2[];
  edges: [number, number][];
}

function squareNet(rows: number, cols: number, diagonals: 'none' | 'tri'): Net {
  const pts: Vec2[] = [];
  const edges: [number, number][] = [];
  const id = (r: number, c: number) => r * cols + c;
  const triangular = diagonals === 'tri';
  const h = triangular ? Math.sqrt(3) / 2 : 1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) pts.push({ x: c + (triangular && r % 2 ? 0.5 : 0), y: r * h });
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) edges.push([id(r, c), id(r, c + 1)]);
      if (r + 1 < rows) {
        edges.push([id(r, c), id(r + 1, c)]);
        if (triangular) {
          // Odd rows are shifted right: connect to the other diagonal neighbour.
          const c2 = r % 2 ? c + 1 : c - 1;
          if (c2 >= 0 && c2 < cols) edges.push([id(r, c), id(r + 1, c2)]);
        }
      }
    }
  return { pts, edges };
}

function diamondNet(rows: number, cols: number): Net {
  // Nails on a checkerboard; strands run diagonally (chain-link fence).
  const pts: Vec2[] = [];
  const edges: [number, number][] = [];
  const index = new Map<string, number>();
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++)
      if ((r + c) % 2 === 0) {
        index.set(`${r},${c}`, pts.length);
        pts.push({ x: c, y: r * 1.2 });
      }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols; c++) {
      const a = index.get(`${r},${c}`);
      if (a === undefined) continue;
      const dl = index.get(`${r + 1},${c - 1}`);
      const dr = index.get(`${r + 1},${c + 1}`);
      if (dl !== undefined) edges.push([a, dl]);
      if (dr !== undefined) edges.push([a, dr]);
    }
  return { pts, edges };
}

function hexNet(rows: number, cols: number): Net {
  // Pointy-top hexagon cells; shared corners are merged by key.
  const pts: Vec2[] = [];
  const edges: [number, number][] = [];
  const index = new Map<string, number>();
  const key = (p: Vec2) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const w = Math.sqrt(3);
  const seen = new Set<string>();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = c * w + (r % 2 ? w / 2 : 0);
      const cy = r * 1.5;
      const corner = Array.from({ length: 6 }, (_, k) => {
        const a = -Math.PI / 2 + (k * Math.PI) / 3;
        const p = { x: cx + Math.cos(a), y: cy + Math.sin(a) };
        const kk = key(p);
        let i = index.get(kk);
        if (i === undefined) {
          i = pts.length;
          index.set(kk, i);
          pts.push(p);
        }
        return i;
      });
      for (let k = 0; k < 6; k++) {
        const a = corner[k], b = corner[(k + 1) % 6];
        const ek = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!seen.has(ek)) {
          seen.add(ek);
          edges.push([a, b]);
        }
      }
    }
  return { pts, edges };
}

function warpPoint(p: Vec2, mode: string, amt: number): Vec2 {
  if (mode === 'sine') {
    return { x: p.x + 0.12 * amt * Math.sin(Math.PI * 1.5 * p.y), y: p.y + 0.12 * amt * Math.sin(Math.PI * 1.5 * p.x) };
  }
  if (mode === 'pinch' || mode === 'bulge') {
    const r = Math.hypot(p.x, p.y);
    if (r === 0) return p;
    const rn = r / Math.SQRT2; // 0..1 inside the box
    const e = mode === 'pinch' ? 1 + 0.8 * amt : 1 / (1 + 0.6 * amt);
    const k = (Math.pow(rn, e) * Math.SQRT2) / r;
    return { x: p.x * k, y: p.y * k };
  }
  return p;
}

function generate(params: ParamValues, seed: number) {
  const p = readParams(schema, params);
  const rows = p.num('rows');
  const cols = p.num('cols');
  const pattern = p.str('pattern');
  const removal = p.num('removal');
  const rng = createRng(seed);

  let net: Net;
  if (pattern === 'hex') net = hexNet(rows, cols);
  else if (pattern === 'diamond') net = diamondNet(rows, cols);
  else net = squareNet(rows, cols, pattern === 'triangular' ? 'tri' : 'none');

  let pts = fitPoints(net.pts, 1);
  pts = pts.map((q) => warpPoint(q, p.str('warp'), p.num('warpAmount')));
  pts = fitPoints(pts, 1);

  const b = new Builder();
  const idx = pts.map((q) => b.nail(q.x, q.y));
  for (const [a, c] of net.edges) {
    if (removal > 0 && rng.chance(removal)) continue;
    b.edge(idx[a], idx[c]);
  }
  return b.output(true);
}

export const lattice: Generator = {
  id: 'lattice',
  label: 'Lattice',
  description: 'Square, triangular, honeycomb or diamond nets — warp them or break a few strands.',
  schema,
  suggestTransform: centredTransform,
  generate,
};
