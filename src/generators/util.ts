/**
 * Shared helpers for generators: param reading, a nail/edge builder that merges
 * close nails and drops self-loops / duplicate edges, and shape sampling.
 */
import type { LayerTransform, ParamValue, ParamValues, Vec2, Wall } from '@/contracts/design';
import type { GeneratorOutput, ParamDef, ParamSchema } from '@/contracts/generator';
import { clamp } from '@/lib/geom';

/** Nails closer than this (local units) are merged by the builder. */
export const MIN_NAIL_SPACING = 0.035;
/** Hard ceiling on edges per generator output. */
export const MAX_EDGES = 2000;

// ── params ────────────────────────────────────────────────

export function schemaDefaults(schema: ParamSchema): ParamValues {
  const out: ParamValues = {};
  for (const d of schema) out[d.key] = d.default;
  return out;
}

function coerce(def: ParamDef, raw: ParamValue | undefined): ParamValue {
  switch (def.kind) {
    case 'number':
    case 'int': {
      const v = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(v)) return def.default;
      const c = clamp(v, def.min, def.max);
      return def.kind === 'int' ? Math.round(c) : c;
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : def.default;
    case 'select':
      return typeof raw === 'string' && def.options.some((o) => o.value === raw) ? raw : def.default;
  }
}

export interface Params {
  num(key: string): number;
  bool(key: string): boolean;
  str(key: string): string;
}

/** Reads params with schema defaults and clamping to schema bounds. */
export function readParams(schema: ParamSchema, params: ParamValues | undefined): Params {
  const find = (key: string) => {
    const d = schema.find((s) => s.key === key);
    if (!d) throw new Error(`unknown param ${key}`);
    return coerce(d, params?.[key]);
  };
  return {
    num: (k) => find(k) as number,
    bool: (k) => find(k) as boolean,
    str: (k) => find(k) as string,
  };
}

// ── builder ───────────────────────────────────────────────

export class Builder {
  readonly nails: Vec2[] = [];
  readonly edges: { a: number; b: number; sag?: number }[] = [];
  private readonly edgeKeys = new Set<string>();
  private readonly grid = new Map<string, number[]>();

  constructor(private readonly minSpacing = MIN_NAIL_SPACING) {}

  private cell(x: number, y: number): [number, number] {
    return [Math.floor(x / this.minSpacing), Math.floor(y / this.minSpacing)];
  }

  /** Adds a nail (or returns the index of an existing nail within min spacing). */
  nail(x: number, y: number): number {
    const [cx, cy] = this.cell(x, y);
    let best = -1;
    let bestD = this.minSpacing;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.grid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const i of bucket) {
          const d = Math.hypot(this.nails[i].x - x, this.nails[i].y - y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    if (best >= 0) return best;
    const idx = this.nails.length;
    this.nails.push({ x, y });
    const key = `${cx},${cy}`;
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(idx);
    else this.grid.set(key, [idx]);
    return idx;
  }

  /** Adds an undirected edge; ignores self-loops, duplicates and edges past the cap. */
  edge(a: number, b: number, sag?: number): boolean {
    if (a === b || a < 0 || b < 0) return false;
    if (this.edges.length >= MAX_EDGES) return false;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (this.edgeKeys.has(key)) return false;
    this.edgeKeys.add(key);
    this.edges.push(sag === undefined ? { a, b } : { a, b, sag });
    return true;
  }

  /** Path through the given nail indices. */
  path(indices: number[], sag?: number, closed = false) {
    for (let i = 1; i < indices.length; i++) this.edge(indices[i - 1], indices[i], sag);
    if (closed && indices.length > 2) this.edge(indices[indices.length - 1], indices[0], sag);
  }

  output(dropOrphans = false): GeneratorOutput {
    if (!dropOrphans) {
      return { nails: this.nails.map((p) => ({ x: p.x, y: p.y })), edges: this.edges.map((e) => ({ ...e })) };
    }
    const used = new Array<boolean>(this.nails.length).fill(false);
    for (const e of this.edges) used[e.a] = used[e.b] = true;
    const remap = new Array<number>(this.nails.length).fill(-1);
    const nails: Vec2[] = [];
    this.nails.forEach((p, i) => {
      if (used[i]) {
        remap[i] = nails.length;
        nails.push({ x: p.x, y: p.y });
      }
    });
    return { nails, edges: this.edges.map((e) => ({ ...e, a: remap[e.a], b: remap[e.b] })) };
  }
}

// ── geometry helpers ──────────────────────────────────────

/** Point on the unit circle; i = 0 at the top, increasing clockwise on screen. */
export function ringPoint(i: number, n: number, r = 1, phaseDeg = 0): Vec2 {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n + (phaseDeg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export type PerimeterShape = 'circle' | 'ellipse' | 'rounded-square';

function perimeterPoint(shape: PerimeterShape, t: number): Vec2 {
  // t in [0, 1): parameter around the shape, starting at the top, clockwise on screen.
  const a = -Math.PI / 2 + 2 * Math.PI * t;
  if (shape === 'circle') return { x: Math.cos(a), y: Math.sin(a) };
  if (shape === 'ellipse') return { x: Math.cos(a), y: 0.7 * Math.sin(a) };
  // rounded square via superellipse |x|^p + |y|^p = 1
  const p = 5;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: Math.sign(c) * Math.pow(Math.abs(c), 2 / p),
    y: Math.sign(s) * Math.pow(Math.abs(s), 2 / p),
  };
}

/** N points evenly spaced by arc length around a closed shape, first point at the top. */
export function samplePerimeter(shape: PerimeterShape, n: number): Vec2[] {
  if (shape === 'circle') return Array.from({ length: n }, (_, i) => ringPoint(i, n));
  const M = 4000;
  const pts: Vec2[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= M; i++) pts.push(perimeterPoint(shape, i / M));
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[M];
  const out: Vec2[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / n;
    while (j < M && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1];
    const f = seg > 0 ? (target - cum[j - 1]) / seg : 0;
    out.push({
      x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * f,
      y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * f,
    });
  }
  return out;
}

/** Uniformly scales + centres points to fit in [-extent, extent]². */
export function fitPoints(points: Vec2[], extent = 1): Vec2[] {
  if (points.length === 0) return points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  const k = span > 0 ? (2 * extent) / span : 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return points.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k }));
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Centred on the wall at 38% of the short side. */
export function centredTransform(wall: Wall): LayerTransform {
  const s = 0.38 * Math.min(wall.width, wall.height);
  return { x: wall.width / 2, y: wall.height / 2, scaleX: s, scaleY: s, rotation: 0 };
}
