import { describe, expect, it } from 'vitest';
import { applyTransform, chordAngleDeg, pointOnSag, sagLength, turn } from './geom';
import { createRng } from './rng';
import { formatMeasure, formatTwine } from './units';
import { nailLabels } from './labels';
import { fixtures, triangle, trianglePlan, triangleReport } from '@/contracts/fixtures';

describe('geom', () => {
  it('taut sag length is the chord', () => {
    expect(sagLength({ x: 0, y: 0 }, { x: 3, y: 4 }, 0)).toBe(5);
  });
  it('sag makes twine longer and droops down', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(sagLength(a, b, 1)).toBeGreaterThan(10);
    expect(pointOnSag(a, b, 1, 0.5).y).toBeCloseTo(1.5);
  });
  it('turn sign: clockwise on screen is positive', () => {
    const t = turn({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
    expect(t.cross).toBeGreaterThan(0);
    expect(t.angleDeg).toBeCloseTo(90);
  });
  it('transform rotates clockwise and scales', () => {
    const p = applyTransform({ x: 1, y: 0 }, { x: 10, y: 10, scaleX: 5, scaleY: 5, rotation: 90 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(15);
  });
  it('chord angle', () => {
    expect(chordAngleDeg({ x: 0, y: 0 }, { x: -5, y: 5 })).toBeCloseTo(45);
  });
});

describe('rng', () => {
  it('is deterministic', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});

describe('units', () => {
  it('formats', () => {
    expect(formatMeasure(12.375, 'in')).toBe('12 3/8"');
    expect(formatTwine(41, 'in')).toBe('3 ft 5 in');
  });
});

describe('labels', () => {
  it('numbers nails in reading order', () => {
    const l = nailLabels([
      { id: 'b', x: 5, y: 0.2 },
      { id: 'a', x: 1, y: 0.4 },
      { id: 'c', x: 0, y: 3 },
    ]);
    expect(l).toEqual({ a: '1', b: '2', c: '3' });
  });
});

describe('fixtures are self-consistent', () => {
  it('every edge references existing nails', () => {
    for (const r of Object.values(fixtures)) {
      const ids = new Set(r.nails.map((n) => n.id));
      for (const e of r.edges) expect(ids.has(e.a) && ids.has(e.b)).toBe(true);
    }
  });
  it('triangle plan uses each edge once and lengths match', () => {
    const used = trianglePlan.runs.flatMap((r) => r.steps.map((s) => s.edgeId)).sort();
    expect(used).toEqual(triangle.edges.map((e) => e.id).sort());
    expect(trianglePlan.runs[0].rawLength).toBeCloseTo(triangleReport.stats.twineLength);
  });
});
