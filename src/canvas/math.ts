/**
 * Canvas-only helpers: hit-testing, snapping, colour tweaks, playback step flattening.
 * All geometry goes through `@/lib/geom` so curves match planning and build output.
 */
import type { Edge, EdgeId, Nail, NailId, Pin, PinId, Units, Vec2 } from '@/contracts/design';
import type { BuildPlan, PhotoSpec, Step } from '@/contracts/plan';
import type { SnapOptions } from '@/contracts/ui';
import { clamp, lerp, pointOnSag, pointSegment, sagControl, sagPoints } from '@/lib/geom';
import { createRng } from '@/lib/rng';

export const MM_PER_UNIT: Record<Units, number> = { in: 25.4, cm: 10 };

/** Twine diameter (mm) → wall units. */
export function twineWidth(thicknessMm: number, units: Units): number {
  return Math.max(0, thicknessMm) / MM_PER_UNIT[units];
}

/** Real-world sizes used by the scene, in wall units. */
export function sizes(units: Units) {
  const k = units === 'cm' ? 2.54 : 1;
  return {
    nailR: 0.11 * k,
    pinLen: 1.35 * k,
    pinW: 0.28 * k,
    photoW: 3.4 * k,
    frameSide: 0.22 * k,
    frameBottom: 0.85 * k,
  };
}

export type NailMap = Map<NailId, Nail>;

export const nailMap = (nails: Nail[]): NailMap => new Map(nails.map((n) => [n.id, n]));

/** Stable small integer hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded tilt (degrees) and sway for a pinned photo, stable per pin id. */
export function pinTilt(id: string): number {
  return createRng(hashString(id)).range(-7, 7);
}

// ── colour ────────────────────────────────────────────────

function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/** Mix a colour toward white (amt > 0) or black (amt < 0). Unknown formats pass through. */
export function shade(color: string, amt: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const target = amt >= 0 ? 255 : 0;
  const k = Math.abs(amt);
  const [r, g, b] = rgb.map((v) => Math.round(lerp(v, target, k)));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Relative luminance 0..1 (approximate; unknown formats count as mid-grey). */
export function luminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0.5;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** Score 0..1 → red..amber..green. */
export const scoreColor = (s: number) => `hsl(${Math.round(clamp(s, 0, 1) * 120)} 62% 46%)`;

// ── partial curves ────────────────────────────────────────

/** SVG path for the sag curve from `a` toward `b`, cut at parameter t (de Casteljau). */
export function partialSagPath(a: Vec2, b: Vec2, sag: number, t: number): string {
  const tt = clamp(t, 0, 1);
  const end = pointOnSag(a, b, sag, tt);
  if (sag <= 1e-6) return `M${a.x} ${a.y}L${end.x} ${end.y}`;
  const c = sagControl(a, b, sag);
  const c1 = { x: lerp(a.x, c.x, tt), y: lerp(a.y, c.y, tt) };
  return `M${a.x} ${a.y}Q${c1.x} ${c1.y} ${end.x} ${end.y}`;
}

// ── hit-testing ───────────────────────────────────────────

export function hitNail(nails: Nail[], p: Vec2, tol: number, exclude?: Set<NailId>): Nail | null {
  let best: Nail | null = null;
  let bestD = tol;
  for (const n of nails) {
    if (exclude?.has(n.id)) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

const SAG_HIT_SEGMENTS = 12;

/**
 * Nearest edge within `tol`. Uses `pointSegment` on the chord; sagging edges are tested
 * against a short polyline of the sag curve so clicks land on the visible twine.
 * Returns the curve parameter t (0..1 from edge.a) of the nearest point.
 */
export function hitEdge(
  edges: Edge[],
  nails: NailMap,
  p: Vec2,
  tol: number,
): { edge: Edge; t: number; dist: number } | null {
  let best: { edge: Edge; t: number; dist: number } | null = null;
  for (const e of edges) {
    const a = nails.get(e.a);
    const b = nails.get(e.b);
    if (!a || !b) continue;
    // cheap reject: bounding box (sag droops by at most 0.15 * chord)
    const pad = tol + (e.sag > 0 ? 0.31 * Math.hypot(b.x - a.x, b.y - a.y) : 0);
    if (p.x < Math.min(a.x, b.x) - tol || p.x > Math.max(a.x, b.x) + tol) continue;
    if (p.y < Math.min(a.y, b.y) - tol || p.y > Math.max(a.y, b.y) + pad) continue;
    let d: number;
    let t: number;
    if (e.sag <= 1e-6) {
      ({ dist: d, t } = pointSegment(p, a, b));
    } else {
      const pts = sagPoints(a, b, e.sag, SAG_HIT_SEGMENTS);
      d = Infinity;
      t = 0;
      for (let i = 1; i < pts.length; i++) {
        const r = pointSegment(p, pts[i - 1], pts[i]);
        if (r.dist < d) {
          d = r.dist;
          t = (i - 1 + r.t) / SAG_HIT_SEGMENTS;
        }
      }
    }
    if (d <= tol && (!best || d < best.dist)) best = { edge: e, t, dist: d };
  }
  return best;
}

/** Pin anchor point on its edge. */
export function pinAnchor(pin: Pin, edges: Map<EdgeId, Edge>, nails: NailMap): Vec2 | null {
  const e = edges.get(pin.edgeId);
  const a = e && nails.get(e.a);
  const b = e && nails.get(e.b);
  if (!e || !a || !b) return null;
  return pointOnSag(a, b, e.sag, pin.t);
}

/** Axis-aligned box of the hanging photo (ignores the small tilt), relative to the anchor. */
export function photoBox(units: Units, aspect?: number, photo?: Pick<PhotoSpec, 'width' | 'height'>) {
  const s = sizes(units);
  const pw = photo?.width ?? s.photoW;
  const ratio = aspect !== undefined && Number.isFinite(aspect) && aspect > 0 ? aspect : photo ? photo.width / photo.height : 0.8;
  const ph = pw / ratio;
  const w = pw + 2 * s.frameSide;
  const h = ph + s.frameSide + s.frameBottom;
  const top = s.pinLen * 0.45;
  return { x: -w / 2, y: top, w, h, pw, ph };
}

export function hitPin(
  pins: Pin[],
  edges: Map<EdgeId, Edge>,
  nails: NailMap,
  units: Units,
  p: Vec2,
  tol: number,
  photo?: Pick<PhotoSpec, 'width' | 'height'>,
): PinId | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    const pin = pins[i];
    const at = pinAnchor(pin, edges, nails);
    if (!at) continue;
    const box = photoBox(units, pin.photo?.aspect, photo);
    const dx = p.x - at.x;
    const dy = p.y - at.y;
    if (Math.hypot(dx, dy) <= tol + sizes(units).pinLen * 0.4) return pin.id;
    if (dx >= box.x - tol && dx <= box.x + box.w + tol && dy >= box.y - tol && dy <= box.y + box.h + tol) return pin.id;
  }
  return null;
}

// ── snapping ──────────────────────────────────────────────

export interface SnapResult {
  p: Vec2;
  /** Alignment guides (wall units) to draw: vertical lines at x, horizontal at y. */
  guideX: number | null;
  guideY: number | null;
}

/**
 * Snap a point: to the grid (when snap.grid) and/or into alignment with other nails
 * (when snap.nails, within `tol`). Nail alignment wins over the grid on each axis.
 */
export function snapPoint(p: Vec2, snap: SnapOptions | undefined, nails: Nail[], tol: number, exclude?: Set<NailId>): SnapResult {
  const out: SnapResult = { p: { ...p }, guideX: null, guideY: null };
  if (!snap) return out;
  if (snap.grid && snap.gridSize > 0) {
    out.p.x = Math.round(p.x / snap.gridSize) * snap.gridSize;
    out.p.y = Math.round(p.y / snap.gridSize) * snap.gridSize;
  }
  if (snap.nails) {
    let bx = tol;
    let by = tol;
    for (const n of nails) {
      if (exclude?.has(n.id)) continue;
      const dx = Math.abs(n.x - p.x);
      const dy = Math.abs(n.y - p.y);
      if (dx < bx) {
        bx = dx;
        out.p.x = n.x;
        out.guideX = n.x;
      }
      if (dy < by) {
        by = dy;
        out.p.y = n.y;
        out.guideY = n.y;
      }
    }
  }
  return out;
}

// ── playback ──────────────────────────────────────────────

export interface FlatStep extends Step {
  groupId: string;
  index: number;
}

/** All steps across runs, in plan order (global step index = array index). */
export function flattenPlan(plan: BuildPlan): FlatStep[] {
  const out: FlatStep[] = [];
  for (const run of plan.runs) for (const s of run.steps) out.push({ ...s, groupId: run.groupId, index: out.length });
  return out;
}

// ── rulers ────────────────────────────────────────────────

/** Smallest "nice" step (1, 2, 5 × 10^n) that is at least `min`. */
export function niceStep(min: number): number {
  if (!(min > 0) || !isFinite(min)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(min)));
  for (const m of [1, 2, 5, 10]) if (m * p >= min) return m * p;
  return 10 * p;
}
