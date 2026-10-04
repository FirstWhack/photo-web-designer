import { describe, expect, it } from 'vitest';
import type { Wall } from '@/contracts/design';
import { applyTransform } from '@/lib/geom';
import { registry } from './index';
import { ACCENTS } from './surprise';

const walls: Wall[] = [
  { width: 72, height: 48, units: 'in' },
  { width: 36, height: 60, units: 'in' },
  { width: 300, height: 200, units: 'cm' },
  { width: 48, height: 48, units: 'in' },
];

describe('surprise', () => {
  it('is deterministic', () => {
    for (let s = 0; s < 10; s++) expect(registry.surprise(s, walls[0])).toEqual(registry.surprise(s, walls[0]));
  });

  it('produces 1–3 valid layers inside the wall with a matching palette', () => {
    const recipes = new Set<string>();
    for (const wall of walls)
      for (let s = 0; s < 60; s++) {
        const r = registry.surprise(s * 31 + 1, wall);
        expect(r.layers.length).toBeGreaterThanOrEqual(1);
        expect(r.layers.length).toBeLessThanOrEqual(3);
        expect(r.palette).toHaveLength(r.layers.length);
        expect(new Set(r.palette).size).toBe(r.palette.length);
        expect(r.palette.filter((c) => ACCENTS.includes(c)).length).toBeLessThanOrEqual(2);
        recipes.add(r.layers.map((l) => l.generatorId).join('+'));
        const margin = 0.02 * Math.min(wall.width, wall.height);
        for (const layer of r.layers) {
          expect(layer.name.length).toBeGreaterThan(0);
          const g = registry.get(layer.generatorId)!;
          expect(g).toBeDefined();
          const out = g.generate(layer.params, layer.seed);
          expect(out.edges.length).toBeGreaterThan(0);
          for (const n of out.nails) {
            const p = applyTransform(n, layer.transform);
            expect(p.x).toBeGreaterThanOrEqual(margin);
            expect(p.x).toBeLessThanOrEqual(wall.width - margin);
            expect(p.y).toBeGreaterThanOrEqual(margin);
            expect(p.y).toBeLessThanOrEqual(wall.height - margin);
          }
        }
      }
    expect(recipes.size).toBeGreaterThan(5);
  });

  it('sometimes makes layers share nails', () => {
    let sharing = 0;
    for (let s = 0; s < 40; s++) {
      const r = registry.surprise(s, walls[0]);
      if (r.layers.length < 2) continue;
      const pts = r.layers.map((l) =>
        registry
          .get(l.generatorId)!
          .generate(l.params, l.seed)
          .nails.map((n) => applyTransform(n, l.transform)),
      );
      const shared = pts[0].some((p) => pts[1].some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01));
      if (shared) sharing++;
    }
    expect(sharing).toBeGreaterThan(5);
  });
});
