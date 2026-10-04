/**
 * Shared geometry. Every domain MUST use these helpers so lengths, sag curves and
 * transforms agree between rendering, planning and build output.
 * Coordinates are y-down (SVG / wall convention).
 */
import type { LayerTransform, Vec2 } from '@/contracts/design';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

/** Rotate by `deg` degrees, clockwise on screen (y-down). */
export function rotate(p: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Local generator space (−1..1) → wall units. See `LayerTransform`. */
export function applyTransform(p: Vec2, t: LayerTransform): Vec2 {
  const r = rotate({ x: p.x * t.scaleX, y: p.y * t.scaleY }, t.rotation);
  return { x: t.x + r.x, y: t.y + r.y };
}

/** Chord angle from horizontal, 0..90 degrees. */
export function chordAngleDeg(a: Vec2, b: Vec2): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Turn at `at` when travelling prev → at → next.
 * `cross > 0` means a clockwise turn on screen (y-down). `angleDeg` is 0 (straight) .. 180 (reversal).
 */
export function turn(prev: Vec2, at: Vec2, next: Vec2): { cross: number; angleDeg: number } {
  const d1 = sub(at, prev);
  const d2 = sub(next, at);
  const l = len(d1) * len(d2);
  if (l === 0) return { cross: 0, angleDeg: 0 };
  const c = cross(d1, d2);
  const angleDeg = (Math.atan2(Math.abs(c), dot(d1, d2)) * 180) / Math.PI;
  return { cross: c, angleDeg };
}

// ── sag (twine droop) ─────────────────────────────────────
// Modelled as a quadratic Bézier whose midpoint drops straight down by
// depth = sag * MAX_SAG_RATIO * chordLength.

export const MAX_SAG_RATIO = 0.3;

export function sagDepth(a: Vec2, b: Vec2, sag: number): number {
  return clamp(sag, 0, 1) * MAX_SAG_RATIO * dist(a, b);
}

/** Quadratic Bézier control point for the sag curve. */
export function sagControl(a: Vec2, b: Vec2, sag: number): Vec2 {
  const d = sagDepth(a, b, sag);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 2 * d };
}

export function pointOnSag(a: Vec2, b: Vec2, sag: number, t: number): Vec2 {
  const c = sagControl(a, b, sag);
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Unit tangent direction along the sag curve at t. */
export function tangentOnSag(a: Vec2, b: Vec2, sag: number, t: number): Vec2 {
  const c = sagControl(a, b, sag);
  const d = {
    x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x),
    y: 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y),
  };
  const l = len(d);
  return l === 0 ? { x: 1, y: 0 } : scale(d, 1 / l);
}

export function sagPoints(a: Vec2, b: Vec2, sag: number, segments = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) out.push(pointOnSag(a, b, sag, i / segments));
  return out;
}

const SAG_EPS = 1e-6;

/** Arc length of the sag curve (exact chord when taut). */
export function sagLength(a: Vec2, b: Vec2, sag: number): number {
  if (sag <= SAG_EPS) return dist(a, b);
  const pts = sagPoints(a, b, sag, 48);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** SVG path data for the sag curve. */
export function sagPath(a: Vec2, b: Vec2, sag: number): string {
  if (sag <= SAG_EPS) return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  const c = sagControl(a, b, sag);
  return `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
}

/** Proper intersection of segments p1p2 and p3p4 (shared endpoints do not count). */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function bbox(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Distance from point p to segment ab, and the closest parameter t (0..1). */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { dist: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { dist: dist(p, add(a, scale(ab, t))), t };
}
