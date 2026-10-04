/**
 * Organic net: seeded Poisson-disc-ish scatter inside a boundary, optional Lloyd relaxation,
 * Delaunay triangulation, then thinned (a spanning tree is always kept so it stays connected).
 */
import { Delaunay } from 'd3-delaunay';
import type { ParamValues, Vec2 } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { createRng } from '@/lib/rng';
import { Builder, centredTransform, readParams } from './util';

const schema: ParamSchema = [
  { key: 'count', label: 'Nails', kind: 'int', min: 8, max: 200, default: 40, hint: 'How many nails to scatter' },
  { key: 'density', label: 'Density', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.55, hint: 'Share of extra strands kept' },
  {
    key: 'boundary',
    label: 'Boundary',
    kind: 'select',
    options: [
      { value: 'circle', label: 'Circle' },
      { value: 'rect', label: 'Rectangle' },
      { value: 'blob', label: 'Blob' },
    ],
    default: 'blob',
  },
  { key: 'relax', label: 'Relaxation', kind: 'int', min: 0, max: 5, default: 2, hint: 'Evens out the spacing' },
];

function boundaryFn(kind: string, seed: number): { inside: (p: Vec2) => boolean; area: number } {
  if (kind === 'rect') return { inside: (p) => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 0.75, area: 3 };
  if (kind === 'circle') return { inside: (p) => p.x * p.x + p.y * p.y <= 1, area: Math.PI };
  const rng = createRng(seed ^ 0x5bd1e995);
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const a1 = rng.range(0.08, 0.15);
  const a2 = rng.range(0.03, 0.07);
  const R = (t: number) => 0.78 + a1 * Math.sin(3 * t + p1) + a2 * Math.sin(5 * t + p2);
  return { inside: (p) => Math.hypot(p.x, p.y) <= R(Math.atan2(p.y, p.x)), area: Math.PI * 0.78 * 0.78 };
}

function polygonCentroid(poly: ArrayLike<[number, number]> & { length: number }): Vec2 | null {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[i + 1];
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-12) return null;
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function generate(params: ParamValues, seed: number) {
  const p = readParams(schema, params);
  const count = p.num('count');
  const density = p.num('density');
  const relax = p.num('relax');
  const rng = createRng(seed);
  const { inside, area } = boundaryFn(p.str('boundary'), seed);

  // Dart throwing with a minimum spacing.
  const minD = Math.max(0.05, 0.8 * Math.sqrt(area / count));
  let pts: Vec2[] = [];
  for (let attempt = 0; attempt < count * 40 && pts.length < count; attempt++) {
    const q = { x: rng.range(-1, 1), y: rng.range(-1, 1) };
    if (!inside(q)) continue;
    if (pts.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= minD)) pts.push(q);
  }

  for (let it = 0; it < relax && pts.length >= 3; it++) {
    const vor = Delaunay.from(pts, (q) => q.x, (q) => q.y).voronoi([-1, -1, 1, 1]);
    pts = pts.map((q, i) => {
      const poly = vor.cellPolygon(i);
      const c = poly ? polygonCentroid(poly) : null;
      return c && inside(c) ? c : q;
    });
  }

  const b = new Builder();
  const idx = pts.map((q) => b.nail(q.x, q.y));
  if (pts.length < 3) return b.output(true);

  // Candidate strands: Delaunay edges whose midpoint is inside the boundary.
  const del = Delaunay.from(pts, (q) => q.x, (q) => q.y);
  const { triangles, halfedges } = del;
  const cand: { a: number; b: number; len: number }[] = [];
  for (let e = 0; e < triangles.length; e++) {
    const opp = halfedges[e];
    if (opp !== -1 && opp < e) continue;
    const a = idx[triangles[e]];
    const c = idx[triangles[e % 3 === 2 ? e - 2 : e + 1]];
    if (a === c) continue;
    const pa = b.nails[a], pc = b.nails[c];
    if (!inside({ x: (pa.x + pc.x) / 2, y: (pa.y + pc.y) / 2 })) continue;
    cand.push({ a, b: c, len: Math.hypot(pa.x - pc.x, pa.y - pc.y) });
  }
  cand.sort((u, v) => u.len - v.len);

  // Kruskal spanning forest keeps it connected.
  const parent = b.nails.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const rest: { a: number; b: number; w: number }[] = [];
  for (const e of cand) {
    const ra = find(e.a), rb = find(e.b);
    if (ra !== rb) {
      parent[ra] = rb;
      b.edge(e.a, e.b);
    } else rest.push({ a: e.a, b: e.b, w: e.len * rng.range(0.7, 1.3) });
  }
  rest.sort((u, v) => u.w - v.w);
  const keep = Math.round(rest.length * density);
  for (let i = 0; i < keep; i++) b.edge(rest[i].a, rest[i].b);
  return b.output(true);
}

export const organic: Generator = {
  id: 'organic',
  label: 'Organic',
  description: 'Scattered nails joined like a natural net (Delaunay, thinned).',
  schema,
  suggestTransform: centredTransform,
  generate,
};
