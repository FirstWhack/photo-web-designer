import { describe, expect, it } from 'vitest';
import { alignDelta, normalizeMoves, contentBounds, fillTransform, fillWallSize, orient, overflow, presetSize, shapeOf, sizeOf, sizePresets, transformBounds, withSize, photoSpec } from './sizing';
import { coverPlacement } from './WallDialog';

const wall = { width: 72, height: 48, units: 'in' as const };

describe('sizing', () => {
  it('reads half-extents as width × height', () => {
    expect(sizeOf({ scaleX: 18, scaleY: 12 })).toEqual({ w: 36, h: 24 });
    const t = withSize({ x: 10, y: 10, scaleX: 5, scaleY: 5, rotation: 0 }, { w: 36, h: 24 });
    expect([t.scaleX, t.scaleY, t.x]).toEqual([18, 12, 10]);
  });

  it('orients and equalises', () => {
    expect(shapeOf({ w: 36, h: 24 })).toBe('landscape');
    expect(orient({ w: 36, h: 24 }, 'portrait')).toEqual({ w: 24, h: 36 });
    expect(orient({ w: 36, h: 24 }, 'square')).toEqual({ w: 24, h: 24 });
    expect(presetSize({ w: 36, h: 24 }, 'portrait')).toEqual({ w: 24, h: 36 });
    expect(presetSize({ w: 36, h: 36 }, 'portrait')).toEqual({ w: 36, h: 36 });
  });

  it('has inch and cm presets plus fill-wall with a margin', () => {
    expect(sizePresets('in').map((p) => p.label)).toEqual(['24 × 24', '36 × 36', '36 × 24', '48 × 36', '60 × 40']);
    expect(sizePresets('cm').map((p) => p.label)).toEqual(['60 × 60', '90 × 90', '90 × 60', '120 × 90']);
    expect(fillWallSize(wall)).toEqual({ w: 60, h: 36 });
  });

  it('aligns to the wall edges with a margin and reports overflow', () => {
    const b = transformBounds({ x: 30, y: 20, scaleX: 10, scaleY: 5, rotation: 0 });
    expect(alignDelta(b, wall, 'left').dx).toBe(6 - 20);
    expect(alignDelta(b, wall, 'right').dx).toBe(72 - 6 - 40);
    expect(alignDelta(b, wall, undefined, 'middle').dy).toBe(24 - 20);
    expect(overflow(b, wall)).toBe(0);
    expect(overflow({ minX: -3, minY: 0, maxX: 10, maxY: 10 }, wall)).toBeCloseTo(3);
  });

  it('converts photo presets to wall units', () => {
    expect(photoSpec('5x7', 'in')).toEqual({ width: 5, height: 7, gap: 2 });
    expect(photoSpec('4x6', 'cm').width).toBeCloseTo(10.16);
  });

  it('cover-fits a background photo over the wall', () => {
    const p = coverPlacement(1000, 500, 72, 48);
    expect(p.height).toBeCloseTo(48);
    expect(p.width).toBeCloseTo(96);
    expect(p.x).toBeCloseTo(-12);
  });
});

describe('fillTransform', () => {
  const circle = Array.from({ length: 24 }, (_, i) => ({ x: 0.7 * Math.cos((i / 24) * 2 * Math.PI), y: 0.7 * Math.sin((i / 24) * 2 * Math.PI) }));
  it('fills the wall margin box with the actual content, centred', () => {
    const t = fillTransform({ x: 5, y: 5, scaleX: 3, scaleY: 3, rotation: 0 }, circle, wall);
    const b = contentBounds(t, circle)!;
    expect(b.minX).toBeCloseTo(6);
    expect(b.maxX).toBeCloseTo(66);
    expect(b.minY).toBeCloseTo(6);
    expect(b.maxY).toBeCloseTo(42);
  });
  it('stays inside the margin box and centred when rotated', () => {
    const pts = [{ x: -1, y: -0.3 }, { x: 1, y: 0.3 }, { x: -1, y: 0.3 }, { x: 1, y: -0.3 }];
    const t = fillTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 30 }, pts, wall);
    const b = contentBounds(t, pts)!;
    expect(b.minX).toBeGreaterThan(5.9);
    expect(b.maxX).toBeLessThan(66.1);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(36);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(24);
  });
});

describe('normalizeMoves', () => {
  it('snaps to the step, skips aligned nails and counts collisions', () => {
    const { moves, collisions } = normalizeMoves(
      [
        { id: 'a', x: 1.2, y: 2.9 },
        { id: 'b', x: 3, y: 4 },
        { id: 'c', x: 1.1, y: 3.1 },
      ],
      0.5,
    );
    expect(moves.map((m) => m.id)).toEqual(['a', 'c']);
    expect(moves[0].dx).toBeCloseTo(-0.2);
    expect(moves[0].dy).toBeCloseTo(0.1);
    expect(collisions).toBe(1);
    expect(normalizeMoves([{ id: 'a', x: 1.2, y: 3 }, { id: 'b', x: 3, y: 3 }], 1).collisions).toBe(0);
  });
});
