/**
 * Real-world sizing helpers for layers, walls and photos (pure; no React).
 * Layer transforms store HALF extents: width = 2·scaleX, height = 2·scaleY.
 */
import type { LayerTransform, Units, Wall } from '@/contracts/design';
import type { PhotoSpec } from '@/contracts/plan';
import { applyTransform, bbox } from '@/lib/geom';
import { convert, formatLength } from '@/lib/units';

export type Shape = 'square' | 'landscape' | 'portrait';

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SizePreset extends Size {
  id: string;
  label: string;
}

const IN_PRESETS: [number, number][] = [
  [24, 24],
  [36, 36],
  [36, 24],
  [48, 36],
  [60, 40],
];
const CM_PRESETS: [number, number][] = [
  [60, 60],
  [90, 90],
  [90, 60],
  [120, 90],
];

/** Pattern size presets in canonical (w ≥ h) form. */
export function sizePresets(units: Units): SizePreset[] {
  const list = units === 'cm' ? CM_PRESETS : IN_PRESETS;
  return list.map(([w, h]) => ({ id: `${w}x${h}`, label: `${w} × ${h}`, w, h }));
}

/** Margin kept from the wall edges for "fill wall" and the align buttons. */
export const wallMargin = (units: Units) => (units === 'cm' ? 15 : 6);

export const fillWallSize = (wall: Pick<Wall, 'width' | 'height' | 'units'>): Size => {
  const m = wallMargin(wall.units);
  return { w: Math.max(1, wall.width - 2 * m), h: Math.max(1, wall.height - 2 * m) };
};

export const sizeOf = (t: Pick<LayerTransform, 'scaleX' | 'scaleY'>): Size => ({ w: 2 * Math.abs(t.scaleX), h: 2 * Math.abs(t.scaleY) });

export function shapeOf(size: Size, tol = 1e-6): Shape {
  if (Math.abs(size.w - size.h) <= tol * Math.max(1, size.w, size.h)) return 'square';
  return size.w > size.h ? 'landscape' : 'portrait';
}

/** Re-orient a size: square equalises (to the shorter side), landscape/portrait swap as needed. */
export function orient(size: Size, shape: Shape): Size {
  const lo = Math.min(size.w, size.h);
  const hi = Math.max(size.w, size.h);
  if (shape === 'square') return { w: lo, h: lo };
  return shape === 'landscape' ? { w: hi, h: lo } : { w: lo, h: hi };
}

/** Apply a preset in a given orientation. Square presets stay square. */
export function presetSize(p: Size, shape: Shape): Size {
  if (p.w === p.h) return { w: p.w, h: p.h };
  return orient(p, shape === 'square' ? 'landscape' : shape);
}

/** A transform patch that resizes a layer (keeping its centre and sign of scale). */
export function withSize(t: LayerTransform, size: Size): LayerTransform {
  const sx = Math.sign(t.scaleX) || 1;
  const sy = Math.sign(t.scaleY) || 1;
  return { ...t, scaleX: (sx * size.w) / 2, scaleY: (sy * size.h) / 2 };
}

/** Axis-aligned extent of the transform's −1..1 box on the wall (rotation aware). */
export function transformBounds(t: LayerTransform): Bounds {
  const r = (t.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const hx = Math.abs(t.scaleX) * c + Math.abs(t.scaleY) * s;
  const hy = Math.abs(t.scaleX) * s + Math.abs(t.scaleY) * c;
  return { minX: t.x - hx, maxX: t.x + hx, minY: t.y - hy, maxY: t.y + hy };
}

export type AlignX = 'left' | 'center' | 'right';
export type AlignY = 'top' | 'middle' | 'bottom';

/** Shift needed to align `b` to the wall (with margin). */
export function alignDelta(b: Bounds, wall: Pick<Wall, 'width' | 'height' | 'units'>, ax?: AlignX, ay?: AlignY) {
  const m = wallMargin(wall.units);
  let dx = 0;
  let dy = 0;
  if (ax === 'left') dx = m - b.minX;
  else if (ax === 'center') dx = wall.width / 2 - (b.minX + b.maxX) / 2;
  else if (ax === 'right') dx = wall.width - m - b.maxX;
  if (ay === 'top') dy = m - b.minY;
  else if (ay === 'middle') dy = wall.height / 2 - (b.minY + b.maxY) / 2;
  else if (ay === 'bottom') dy = wall.height - m - b.maxY;
  return { dx, dy };
}

/** How far (wall units) `b` pokes outside the wall, 0 if inside. */
export function overflow(b: Bounds, wall: Pick<Wall, 'width' | 'height'>, eps = 1e-6): number {
  return Math.max(0, -b.minX - eps, -b.minY - eps, b.maxX - wall.width - eps, b.maxY - wall.height - eps);
}

type P = { x: number; y: number };

/** Wall-space bounds of generator output (local −1..1 points) under a transform; null when empty. */
export function contentBounds(t: LayerTransform, local: P[]): Bounds | null {
  return bbox(local.map((p) => applyTransform(p, t)));
}

/**
 * Transform that makes the pattern's actual nails fill the wall (minus margin), centred.
 * Patterns rarely touch the ±1 box (a circle's nails sit inside it), so sizing by the box alone
 * leaves the result small and off-centre. Keeps rotation and the sign of the scales.
 */
export function fillTransform(t: LayerTransform, local: P[], wall: Pick<Wall, 'width' | 'height' | 'units'>): LayerTransform {
  const target = fillWallSize(wall);
  let cur: LayerTransform = { ...t, scaleX: (Math.sign(t.scaleX) || 1) * (target.w / 2), scaleY: (Math.sign(t.scaleY) || 1) * (target.h / 2) };
  if (local.length < 2) return { ...cur, x: wall.width / 2, y: wall.height / 2 };
  // Rotation couples the axes, so refine a few times (exact in one pass when unrotated).
  for (let i = 0; i < 6; i++) {
    const b = contentBounds({ ...cur, x: 0, y: 0 }, local);
    if (!b) break;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    cur = {
      ...cur,
      scaleX: w > 1e-9 ? cur.scaleX * (target.w / w) : cur.scaleX,
      scaleY: h > 1e-9 ? cur.scaleY * (target.h / h) : cur.scaleY,
    };
  }
  const b = contentBounds({ ...cur, x: 0, y: 0 }, local);
  if (!b) return { ...cur, x: wall.width / 2, y: wall.height / 2 };
  return { ...cur, x: wall.width / 2 - (b.minX + b.maxX) / 2, y: wall.height / 2 - (b.minY + b.maxY) / 2 };
}

export function formatSize(size: Size, units: Units): string {
  return `${formatLength(size.w, units)} × ${formatLength(size.h, units)}`;
}

/** Compact wall label, e.g. `72″ × 48″ wall`. */
export const wallLabel = (wall: Pick<Wall, 'width' | 'height' | 'units'>) => `${formatSize({ w: wall.width, h: wall.height }, wall.units)} wall`;

// ── walls ─────────────────────────────────────────────

export interface WallPreset extends Size {
  id: string;
  label: string;
  /** Natural orientation of the space. */
  shape: Shape;
}

const WALLS_IN: WallPreset[] = [
  { id: 'sofa', label: 'Above a sofa', w: 72, h: 40, shape: 'landscape' },
  { id: 'bed', label: 'Over a bed', w: 60, h: 36, shape: 'landscape' },
  { id: 'feature', label: 'Feature wall', w: 96, h: 72, shape: 'landscape' },
  { id: 'nook', label: 'Cosy nook', w: 36, h: 36, shape: 'square' },
  { id: 'hall', label: 'Hallway', w: 36, h: 60, shape: 'portrait' },
  { id: 'stairs', label: 'Tall stairwell', w: 48, h: 84, shape: 'portrait' },
];

export function wallPresets(units: Units): WallPreset[] {
  if (units === 'in') return WALLS_IN;
  return WALLS_IN.map((p) => ({ ...p, w: roundCm(convert(p.w, 'in', 'cm')), h: roundCm(convert(p.h, 'in', 'cm')) }));
}

const roundCm = (v: number) => Math.round(v / 5) * 5;

// ── photos ────────────────────────────────────────────

export interface PhotoPreset {
  id: string;
  label: string;
  /** Inches, as hung (width along the twine). */
  w: number;
  h: number;
}

export const PHOTO_PRESETS: PhotoPreset[] = [
  { id: '4x6', label: '4×6', w: 4, h: 6 },
  { id: '5x7', label: '5×7', w: 5, h: 7 },
  { id: 'instax', label: 'Instax mini', w: 2.13, h: 3.39 },
  { id: 'polaroid', label: 'Polaroid', w: 3.5, h: 4.2 },
];

export const PHOTO_GAP_IN = 2;

export function photoSpec(id: string, units: Units): PhotoSpec {
  const p = PHOTO_PRESETS.find((x) => x.id === id) ?? PHOTO_PRESETS[0];
  return { width: convert(p.w, 'in', units), height: convert(p.h, 'in', units), gap: convert(PHOTO_GAP_IN, 'in', units) };
}
