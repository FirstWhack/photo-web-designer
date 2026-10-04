/**
 * Pure dimensioning maths for the engineering drawing: cluster nail coordinates into unique
 * positions, measured from a datum corner, and dimension them the way a carpenter would
 * (running dimensions from the datum + a chain compressed with "EQ SP" notation).
 */
import type { ResolvedDesign, Units } from '@/contracts/design';
import type { MeasureOrigin } from '@/contracts/ui';
import { formatMeasure } from '@/lib/units';
import { coordRows, type CoordRow } from './coords';

/** Positions closer than this (wall units) are treated as the same: 1/16″ or 1.5 mm. */
export const DIM_TOL: Record<Units, number> = { in: 1 / 16, cm: 0.15 };

/** Above this many unique positions on an axis, only key positions are dimensioned. */
export const DENSE_POSITIONS = 25;

/**
 * Sorted unique positions: values within `tol` of a cluster's first value join that cluster;
 * each cluster is represented by its mean.
 */
export function clusterPositions(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let start = NaN;
  let sum = 0;
  let n = 0;
  for (const v of sorted) {
    if (n > 0 && v - start > tol) {
      out.push(sum / n);
      n = 0;
      sum = 0;
    }
    if (n === 0) start = v;
    sum += v;
    n++;
  }
  if (n > 0) out.push(sum / n);
  return out;
}

/** One link of a dimension chain: `count` equal spaces from `start` to `end`. */
export interface ChainSegment {
  start: number;
  end: number;
  /** Number of equal spaces (1 = a plain dimension). */
  count: number;
  spacing: number;
  /** "8 EQ SP @ 4 1/2\" = 36\"" or "4 1/2\"". */
  text: string;
  /** Shorter fallbacks, longest first, for when `text` doesn't fit. */
  short: string[];
}

export function segmentText(count: number, spacing: number, units: Units): { text: string; short: string[] } {
  const sp = formatMeasure(spacing, units);
  if (count < 2) return { text: sp, short: [] };
  const total = formatMeasure(spacing * count, units);
  return { text: `${count} EQ SP @ ${sp} = ${total}`, short: [`${count} EQ SP @ ${sp}`, `${count} EQ SP`] };
}

/**
 * Split consecutive positions into runs of equal spacing (within `tol`). Every gap between
 * neighbouring positions belongs to exactly one segment.
 */
export function equalSpacingGroups(positions: number[], units: Units, tol = DIM_TOL[units]): ChainSegment[] {
  const out: ChainSegment[] = [];
  let i = 0;
  while (i < positions.length - 1) {
    const d0 = positions[i + 1] - positions[i];
    let j = i + 1;
    let sum = d0;
    while (j < positions.length - 1) {
      const d = positions[j + 1] - positions[j];
      if (Math.abs(d - sum / (j - i)) > tol) break;
      sum += d;
      j++;
    }
    const count = j - i;
    const spacing = (positions[j] - positions[i]) / count;
    out.push({ start: positions[i], end: positions[j], count, spacing, ...segmentText(count, spacing, units) });
    i = j;
  }
  return out;
}

export interface RunningDim {
  value: number;
  text: string;
}

/** Baseline (running) dimensions: each position's distance from the datum. */
export function baselineDims(positions: number[], units: Units): RunningDim[] {
  return positions.map((value) => ({ value, text: formatMeasure(value, units) }));
}

export interface AxisDims {
  /** Unique nail positions from the datum, ascending. */
  positions: number[];
  dense: boolean;
  /** Positions that get a running dimension (all of them unless dense). */
  running: RunningDim[];
  /** Chain from the datum (0) through the key positions to the far wall edge. */
  chain: ChainSegment[];
  overall: RunningDim;
}

const dedupe = (xs: number[], tol: number) => xs.filter((v, i) => i === 0 || v - xs[i - 1] > tol);

/** Dimension one axis. `values` are nail coordinates already measured from the datum. */
export function axisDimensions(values: number[], length: number, units: Units, tol = DIM_TOL[units]): AxisDims {
  const positions = clusterPositions(values, tol);
  const dense = positions.length > DENSE_POSITIONS;
  const full = dedupe([0, ...positions.filter((p) => p > tol && p < length - tol), length], tol);
  let chain = equalSpacingGroups(full, units, tol);
  let key = positions;
  if (dense) {
    // Keep only cluster extents and EQ SP groups: every boundary of a multi-space group, plus
    // the first and last nail; the spans in between become one plain dimension each.
    const keep = new Set<number>([0, length]);
    if (positions.length) {
      keep.add(positions[0]);
      keep.add(positions[positions.length - 1]);
    }
    let groups = chain.filter((s) => s.count >= 2);
    if (groups.length * 2 > DENSE_POSITIONS) groups = groups.filter((s) => s.count >= 3);
    if (groups.length * 2 > DENSE_POSITIONS) groups = [...groups].sort((a, b) => b.count - a.count).slice(0, DENSE_POSITIONS / 2);
    for (const g of groups) keep.add(g.start).add(g.end);
    const keys = dedupe([...keep].filter((p) => p >= 0 && p <= length).sort((a, b) => a - b), tol);
    const groupAt = new Map(groups.map((g) => [g.start, g]));
    chain = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const g = groupAt.get(keys[i]);
      if (g) {
        // A group swallows any key positions that fall inside it.
        chain.push(g);
        while (i < keys.length - 1 && keys[i + 1] < g.end - tol) i++;
        continue;
      }
      chain.push({ start: keys[i], end: keys[i + 1], count: 1, spacing: keys[i + 1] - keys[i], ...segmentText(1, keys[i + 1] - keys[i], units) });
    }
    key = keys.filter((p) => positions.some((q) => Math.abs(q - p) <= tol));
  }
  return { positions, dense, running: baselineDims(key, units), chain, overall: { value: length, text: formatMeasure(length, units) } };
}

export interface NailDimensions {
  rows: CoordRow[];
  x: AxisDims;
  y: AxisDims;
}

/** Nail coordinates from the datum corner plus X and Y dimensioning. */
export function nailDimensions(resolved: ResolvedDesign, origin: MeasureOrigin = 'top-left'): NailDimensions {
  const rows = coordRows(resolved, origin);
  const { width, height, units } = resolved.wall;
  return {
    rows,
    x: axisDimensions(rows.map((r) => r.x), width, units),
    y: axisDimensions(rows.map((r) => r.y), height, units),
  };
}
