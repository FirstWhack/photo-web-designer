/**
 * Rectangle frame: nails around the perimeter of the local square −1..1 (the layer transform
 * gives it its real width, height and aspect), with stringing inside the frame.
 *
 * Nail layout: `nailsX` nails along the top and bottom, `nailsY` along the left and right.
 * Both counts include the corners, which are shared, so the perimeter holds
 * 2·nailsX + 2·nailsY − 4 nails. Perimeter order is clockwise from the top-left corner.
 * Two frame layers with the same transform and counts share every perimeter nail.
 */
import type { LayerTransform, ParamValues, Wall } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { clamp } from '@/lib/geom';
import { Builder, MIN_NAIL_SPACING, readParams } from './util';

const schema: ParamSchema = [
  {
    key: 'pattern',
    label: 'Pattern',
    kind: 'select',
    options: [
      { value: 'rows', label: 'Photo rows' },
      { value: 'zigzag', label: 'Zig-zag garland' },
      { value: 'border', label: 'Border only' },
      { value: 'columns', label: 'Columns' },
      { value: 'grid', label: 'Grid' },
      { value: 'diamond', label: 'Diamond lattice' },
      { value: 'corners', label: 'Stitched corners' },
      { value: 'sunburst', label: 'Sunburst' },
      { value: 'string-art', label: 'String art' },
      { value: 'nested', label: 'Nested frames' },
    ],
    default: 'rows',
  },
  { key: 'nailsX', label: 'Nails across', kind: 'int', min: 2, max: 40, default: 9, hint: 'Along the top and bottom, corners included' },
  { key: 'nailsY', label: 'Nails down', kind: 'int', min: 2, max: 40, default: 7, hint: 'Along the left and right, corners included' },
  { key: 'outline', label: 'Outline', kind: 'bool', default: true, hint: 'Also string the border' },
  { key: 'tiers', label: 'Tiers', kind: 'int', min: 1, max: 5, default: 2, hint: 'Zig-zag: stacked garlands between top and bottom' },
  {
    key: 'cornerSet',
    label: 'Corners',
    kind: 'select',
    options: [
      { value: 'all', label: 'All four' },
      { value: 'top', label: 'Top two' },
      { value: 'diagonal', label: 'Diagonal pair' },
    ],
    default: 'all',
    hint: 'Stitched corners: which corners get curves',
  },
  {
    key: 'anchor',
    label: 'Sunburst from',
    kind: 'select',
    options: [
      { value: 'bottom-centre', label: 'Bottom centre' },
      { value: 'top-centre', label: 'Top centre' },
      { value: 'corner', label: 'Corner' },
      { value: 'centre-nail', label: 'Centre nail' },
    ],
    default: 'bottom-centre',
    hint: 'Sunburst: where every ray starts',
  },
  {
    key: 'multiplier',
    label: 'Multiplier k',
    kind: 'number',
    min: 2,
    max: 12,
    step: 0.01,
    default: 2,
    hint: 'String art: nail i joins nail k·i around the frame',
  },
  { key: 'inset', label: 'Inner frame', kind: 'bool', default: false, hint: 'Border, corners: add a strung inner rectangle (nested always has one)' },
  { key: 'insetSize', label: 'Inner frame size', kind: 'number', min: 0.2, max: 0.9, step: 0.01, default: 0.55, hint: 'Inner rectangle as a fraction of the frame' },
];

/** Gentle droop for photo lines; geometric patterns are strung taut. */
const ROW_SAG = 0.08;
const ZIGZAG_SAG = 0.1;
const TAUT = 0;

const SIDE_TOP = 1, SIDE_RIGHT = 2, SIDE_BOTTOM = 4, SIDE_LEFT = 8;

/** n positions evenly spaced from lo to hi inclusive. */
function axis(n: number, lo = -1, hi = 1): number[] {
  return Array.from({ length: n }, (_, i) => (n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1)));
}

/** Inserts 0 into an even-length centred axis when there is room, so a centre nail exists. */
function withCentre(xs: number[]): number[] {
  if (xs.length % 2 === 1) return xs;
  const step = xs.length > 1 ? xs[1] - xs[0] : 2;
  if (step / 2 < MIN_NAIL_SPACING * 1.2) return xs;
  const mid = xs.length / 2;
  return [...xs.slice(0, mid), 0, ...xs.slice(mid)];
}

/** Index in `xs` nearest to 0 (first on a tie). */
function nearestCentre(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]) < Math.abs(xs[best]) - 1e-12) best = i;
  return best;
}

interface Rect {
  /** Left → right. */
  top: number[];
  bottom: number[];
  /** Top → bottom. */
  left: number[];
  right: number[];
  /** Clockwise from the top-left corner, every nail once. */
  ring: number[];
}

function rect(b: Builder, xsTop: number[], xsBottom: number[], ys: number[], h: number): Rect {
  const sx = (xs: number[]) => xs.map((x) => x * h);
  const top = sx(xsTop).map((x) => b.nail(x, -h));
  const bottom = sx(xsBottom).map((x) => b.nail(x, h));
  const left = ys.map((y) => b.nail(-h, y * h));
  const right = ys.map((y) => b.nail(h, y * h));
  // Corners are shared by construction (identical coordinates merge in the builder).
  const ring = [
    ...top,
    ...right.slice(1),
    ...bottom.slice().reverse().slice(1),
    ...left.slice().reverse().slice(1, -1),
  ];
  return { top, bottom, left, right, ring };
}

function generate(params: ParamValues) {
  const p = readParams(schema, params);
  const pattern = p.str('pattern');
  const nx = p.num('nailsX');
  const ny = p.num('nailsY');
  const outline = p.bool('outline');
  const tiers = p.num('tiers');
  const cornerSet = p.str('cornerSet');
  const anchor = p.str('anchor');
  const k = p.num('multiplier');
  const insetSize = p.num('insetSize');
  const inset = pattern === 'nested' || (p.bool('inset') && (pattern === 'border' || pattern === 'corners'));

  const b = new Builder();
  const xs = axis(nx);
  const ys = axis(ny);
  const sunTop = pattern === 'sunburst' && anchor === 'top-centre';
  const sunBottom = pattern === 'sunburst' && anchor === 'bottom-centre';
  const R = rect(b, sunTop ? withCentre(xs) : xs, sunBottom ? withCentre(xs) : xs, ys, 1);
  const { top, bottom, left, right, ring } = R;

  // Side membership (corners belong to two sides) and ring position, for collinearity checks.
  const sides = new Map<number, number>();
  const mark = (ids: number[], s: number) => ids.forEach((i) => sides.set(i, (sides.get(i) ?? 0) | s));
  mark(top, SIDE_TOP);
  mark(right, SIDE_RIGHT);
  mark(bottom, SIDE_BOTTOM);
  mark(left, SIDE_LEFT);
  const ringPos = new Map(ring.map((id, i) => [id, i]));
  const N = ring.length;
  const adjacent = (a: number, c: number) => {
    const d = Math.abs((ringPos.get(a) ?? -9) - (ringPos.get(c) ?? -9));
    return d === 1 || d === N - 1;
  };
  /** A chord between two nails on the same side lies along the border: only neighbours are sensible. */
  const chordOk = (a: number, c: number) => ((sides.get(a) ?? 0) & (sides.get(c) ?? 0)) === 0 || adjacent(a, c);

  const ringEdges = (r: number[]) => b.path(r, TAUT, true);

  switch (pattern) {
    case 'rows':
      for (let j = 1; j < ny - 1; j++) b.edge(left[j], right[j], ROW_SAG);
      break;
    case 'columns':
      for (let i = 1; i < nx - 1; i++) b.edge(top[i], bottom[i], TAUT);
      break;
    case 'grid':
      for (let j = 1; j < ny - 1; j++) b.edge(left[j], right[j], TAUT);
      for (let i = 1; i < nx - 1; i++) b.edge(top[i], bottom[i], TAUT);
      break;
    case 'zigzag': {
      // Levels from the top edge to the bottom edge; each tier zig-zags between two levels,
      // so neighbouring tiers share the nails of the level between them.
      const levels: number[][] = [];
      for (let t = 0; t <= tiers; t++) {
        if (t === 0) levels.push(top);
        else if (t === tiers) levels.push(bottom);
        else {
          const y = -1 + (2 * t) / tiers;
          levels.push(xs.map((x) => b.nail(x, y)));
        }
      }
      for (let t = 0; t < tiers; t++) {
        const path = xs.map((_, i) => (i % 2 === 0 ? levels[t][i] : levels[t + 1][i]));
        b.path(path, ZIGZAG_SAG);
      }
      break;
    }
    case 'diamond': {
      // Diagonals in nail-index space: every line i ± j = c meets the border at two nails.
      const at = (i: number, j: number) =>
        j === 0 ? top[i] : j === ny - 1 ? bottom[i] : i === 0 ? left[j] : right[j];
      for (let c = -(ny - 1); c <= nx - 1; c++) {
        const i0 = Math.max(0, c), j0 = Math.max(0, -c);
        const steps = Math.min(nx - 1 - i0, ny - 1 - j0);
        if (steps > 0) b.edge(at(i0, j0), at(i0 + steps, j0 + steps), TAUT);
      }
      for (let c = 0; c <= nx - 1 + ny - 1; c++) {
        const i0 = Math.min(c, nx - 1), j0 = c - i0;
        const steps = Math.min(i0, ny - 1 - j0);
        if (steps > 0) b.edge(at(i0, j0), at(i0 - steps, j0 + steps), TAUT);
      }
      break;
    }
    case 'corners': {
      const mA = Math.floor((nx - 1) / 2);
      const mB = Math.floor((ny - 1) / 2);
      const M = Math.max(mA, mB);
      /** Parabolic stitch between two arms listed outward from a shared corner. */
      const stitch = (A: number[], B: number[]) => {
        if (A.length === 0 || B.length === 0) return;
        for (let s = 1; s <= M; s++) {
          const a = A[Math.ceil((s * A.length) / M) - 1];
          const c = B[Math.ceil(((M + 1 - s) * B.length) / M) - 1];
          b.edge(a, c, TAUT);
        }
      };
      const rev = (a: number[]) => a.slice().reverse();
      const tl = () => stitch(top.slice(1, 1 + mA), left.slice(1, 1 + mB));
      const tr = () => stitch(rev(top).slice(1, 1 + mA), right.slice(1, 1 + mB));
      const br = () => stitch(rev(bottom).slice(1, 1 + mA), rev(right).slice(1, 1 + mB));
      const bl = () => stitch(bottom.slice(1, 1 + mA), rev(left).slice(1, 1 + mB));
      tl();
      if (cornerSet !== 'diagonal') tr();
      if (cornerSet === 'all' || cornerSet === 'diagonal') br();
      if (cornerSet === 'all') bl();
      break;
    }
    case 'sunburst': {
      let hub: number;
      if (anchor === 'centre-nail') hub = b.nail(0, 0);
      else if (anchor === 'corner') hub = bottom[0];
      else {
        const row = anchor === 'top-centre' ? top : bottom;
        const rowXs = row.map((i) => b.nails[i].x);
        hub = row[nearestCentre(rowXs)];
      }
      for (const id of ring) if (id !== hub && chordOk(hub, id)) b.edge(hub, id, TAUT);
      break;
    }
    case 'string-art':
      for (let i = 0; i < N; i++) {
        const j = Math.round(k * i) % N;
        if (chordOk(ring[i], ring[j])) b.edge(ring[i], ring[j], TAUT);
      }
      break;
    case 'nested':
    case 'border':
      break;
  }

  if (outline || pattern === 'border' || pattern === 'nested') ringEdges(ring);

  if (inset) {
    const s = insetSize;
    const fit = (n: number) => clamp(n, 2, Math.floor((2 * s) / (MIN_NAIL_SPACING * 1.3)) + 1);
    const ix = fit(nx), iy = fit(ny);
    const I = rect(b, axis(ix), axis(ix), axis(iy), s);
    ringEdges(I.ring);
    if (pattern === 'nested') {
      const spoke = (inner: number[], outer: number[]) =>
        inner.forEach((id, i) => b.edge(id, outer[Math.round((i * (outer.length - 1)) / (inner.length - 1))], TAUT));
      spoke(I.top, top);
      spoke(I.bottom, bottom);
      spoke(I.left, left);
      spoke(I.right, right);
    }
  }

  // Never hand back an empty layer (e.g. rows with no interior nails and the outline off).
  if (b.edges.length === 0) ringEdges(ring);
  return b.output(true);
}

/**
 * A rectangle centred horizontally, slightly above the vertical centre: landscape 3:2 on a wall
 * wider than tall, otherwise portrait 2:3. Width ≈ 60% of the wall, keeping ≥ 6 units of margin.
 * Returns half-extents.
 */
export function frameTransform(wall: Wall): LayerTransform {
  const W = wall.width;
  const H = wall.height;
  const margin = 6;
  const landscape = W > H;
  const aspect = landscape ? 3 / 2 : 2 / 3; // width / height
  let w = Math.min(0.6 * W, Math.max(W - 2 * margin, 0.3 * W));
  let h = w / aspect;
  const maxH = Math.max(H - 2 * margin, 0.3 * H);
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  const hh = h / 2;
  const lo = Math.min(hh + margin, H / 2);
  const hi = Math.max(H - margin - hh, H / 2);
  const y = clamp(0.45 * H, lo, hi);
  return { x: W / 2, y, scaleX: w / 2, scaleY: hh, rotation: 0 };
}

export const frame: Generator = {
  id: 'frame',
  label: 'Rectangle frame',
  description: 'A rectangle of nails with photo rows, garlands or geometric stringing inside.',
  schema,
  suggestTransform: frameTransform,
  generate,
};
