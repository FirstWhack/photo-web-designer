import { describe, expect, it } from 'vitest';
import type { ParamValues } from '@/contracts/design';
import type { Generator, GeneratorOutput, ParamDef } from '@/contracts/generator';
import { createRng } from '@/lib/rng';
import { registry } from './index';

function checkOutput(out: GeneratorOutput) {
  expect(out.edges.length).toBeLessThanOrEqual(2000);
  const n = out.nails.length;
  for (const p of out.nails) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(1.0001);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(1.0001);
  }
  const keys = new Set<string>();
  for (const e of out.edges) {
    expect(Number.isInteger(e.a) && Number.isInteger(e.b)).toBe(true);
    expect(e.a >= 0 && e.a < n && e.b >= 0 && e.b < n).toBe(true);
    expect(e.a).not.toBe(e.b);
    const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
    expect(keys.has(k)).toBe(false);
    keys.add(k);
    if (e.sag !== undefined) expect(e.sag >= 0 && e.sag <= 1).toBe(true);
  }
  let minD = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      minD = Math.min(minD, Math.hypot(out.nails[i].x - out.nails[j].x, out.nails[i].y - out.nails[j].y));
  expect(minD).toBeGreaterThanOrEqual(0.03);
}

function checkDeterministic(g: Generator, params: ParamValues, seed: number) {
  const a = g.generate(params, seed);
  const b = g.generate(params, seed);
  expect(b).toEqual(a);
  checkOutput(a);
  return a;
}

/** Every combination of select/bool values, with all numbers at min, then at max. */
function corners(g: Generator): ParamValues[] {
  let combos: ParamValues[] = [{}];
  for (const d of g.schema) {
    const vals = d.kind === 'select' ? d.options.map((o) => o.value) : d.kind === 'bool' ? [true, false] : null;
    if (!vals) continue;
    combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [d.key]: v })));
  }
  const out: ParamValues[] = [];
  for (const end of ['min', 'max'] as const)
    for (const c of combos) {
      const p: ParamValues = { ...c };
      for (const d of g.schema) if (d.kind === 'number' || d.kind === 'int') p[d.key] = d[end];
      out.push(p);
    }
  return out;
}

function randomParam(d: ParamDef, rng: ReturnType<typeof createRng>) {
  switch (d.kind) {
    case 'number':
      return rng.range(d.min, d.max);
    case 'int':
      return rng.int(d.min, d.max);
    case 'bool':
      return rng.chance(0.5);
    case 'select':
      return rng.pick(d.options).value;
  }
}

describe('registry', () => {
  it('lists every generator in order', () => {
    expect(registry.list().map((g) => g.id)).toEqual([
      'frame',
      'spider-web',
      'string-art',
      'star',
      'curve-stitch',
      'lattice',
      'organic',
      'swag',
    ]);
    expect(registry.get('star')?.id).toBe('star');
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.defaults('nope')).toEqual({});
  });

  it('defaults come from the schema and every param is labelled', () => {
    for (const g of registry.list()) {
      const d = registry.defaults(g.id);
      expect(Object.keys(d).sort()).toEqual(g.schema.map((s) => s.key).sort());
      for (const s of g.schema) {
        expect(s.label.length).toBeGreaterThan(0);
        expect(d[s.key]).toBe(s.default);
      }
      // missing params == defaults
      expect(g.generate({}, 7)).toEqual(g.generate(d, 7));
    }
  });

  it('suggestTransform centres on the wall', () => {
    const wall = { width: 72, height: 48, units: 'in' as const };
    for (const g of registry.list()) {
      const t = g.suggestTransform!(wall);
      expect(t.x).toBeCloseTo(36);
      expect(t.rotation).toBe(0);
      if (g.id === 'frame') {
        // Landscape 3:2 on a landscape wall, slightly above centre, inside a 6-unit margin.
        expect(t.scaleX / t.scaleY).toBeCloseTo(1.5);
        expect(t.scaleX).toBeCloseTo(0.3 * 72);
        expect(t.y).toBeLessThan(24);
        expect(t.y - t.scaleY).toBeGreaterThanOrEqual(6);
        expect(t.y + t.scaleY).toBeLessThanOrEqual(48 - 6);
      } else if (g.id === 'swag') {
        expect(t.scaleX).toBeGreaterThan(t.scaleY);
        expect(t.y).toBeLessThan(24);
      } else {
        expect(t.y).toBeCloseTo(24);
        expect(t.scaleX).toBeCloseTo(0.38 * 48);
      }
    }
  });
});

for (const g of registry.list()) {
  describe(g.id, () => {
    it('defaults are valid with a sensible nail count', () => {
      const out = checkDeterministic(g, {}, 1);
      expect(out.nails.length).toBeGreaterThanOrEqual(12);
      expect(out.nails.length).toBeLessThanOrEqual(80);
      expect(out.edges.length).toBeGreaterThan(0);
    });

    it('schema corners are valid', () => {
      for (const p of corners(g)) checkDeterministic(g, p, 42);
    }, 60_000); // the frame generator has ~500 select/bool combinations

    it('random params over 20 seeds are valid', () => {
      const rng = createRng(1234 + g.id.length);
      for (let s = 0; s < 20; s++) {
        const p: ParamValues = {};
        for (const d of g.schema) p[d.key] = randomParam(d, rng);
        checkDeterministic(g, p, s * 7919 + 1);
        checkDeterministic(g, {}, s);
      }
    });

    it('ignores out-of-range and junk params', () => {
      const p: ParamValues = {};
      for (const d of g.schema) p[d.key] = d.kind === 'select' ? 'junk' : 1e9;
      checkDeterministic(g, p, 3);
    });
  });
}

describe('known shapes', () => {
  it('star {5/2} is a pentagram', () => {
    const out = registry.get('star')!.generate({ points: 5, skip: 2, copies: 1, outline: false }, 1);
    expect(out.nails).toHaveLength(5);
    expect(out.edges).toHaveLength(5);
    const deg = new Array(5).fill(0);
    for (const e of out.edges) {
      deg[e.a]++;
      deg[e.b]++;
    }
    expect(deg).toEqual([2, 2, 2, 2, 2]);
  });

  it('string-art N=10, k=2 connects i to 2i mod 10', () => {
    const out = registry.get('string-art')!.generate({ nails: 10, multiplier: 2, offset: 0, outline: false }, 1);
    const got = out.edges.map((e) => [Math.min(e.a, e.b), Math.max(e.a, e.b)].join('-')).sort();
    const want = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const j = (2 * i) % 10;
      if (i !== j) want.add([Math.min(i, j), Math.max(i, j)].join('-'));
    }
    expect(got).toEqual([...want].sort());
    expect(got).toHaveLength(9);
  });

  it('spider-web anchors share nails with a matching string-art ring', () => {
    const web = registry.get('spider-web')!.generate({ spokes: 8 }, 5);
    const ring = registry.get('string-art')!.generate({ nails: 48 }, 5);
    const shared = web.nails.filter((p) => ring.nails.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9));
    expect(shared).toHaveLength(8);
  });

  it('swag edges droop', () => {
    const out = registry.get('swag')!.generate({}, 1);
    expect(out.edges.every((e) => (e.sag ?? 0) >= 0.5)).toBe(true);
  });
});

describe('frame shapes', () => {
  const frame = registry.get('frame')!;
  const degrees = (out: GeneratorOutput) => {
    const deg = new Array<number>(out.nails.length).fill(0);
    for (const e of out.edges) {
      deg[e.a]++;
      deg[e.b]++;
    }
    return deg;
  };
  /** Interior horizontal line spanning the full width (not part of the outline). */
  const isRow = (out: GeneratorOutput, e: { a: number; b: number }) => {
    const p = out.nails[e.a], q = out.nails[e.b];
    return Math.abs(p.y - q.y) < 1e-9 && Math.abs(p.x - q.x) > 1.99 && Math.abs(p.y) < 0.999;
  };

  it('a 5 × 3 border has 12 nails and 12 edges', () => {
    const out = frame.generate({ pattern: 'border', nailsX: 5, nailsY: 3 }, 1);
    expect(out.nails).toHaveLength(12);
    expect(out.edges).toHaveLength(12);
    expect(degrees(out).every((d) => d === 2)).toBe(true);
  });

  it('defaults are photo rows: 5 drooping lines inside a taut outline', () => {
    const d = registry.defaults('frame');
    expect(d.pattern).toBe('rows');
    expect(d.outline).toBe(true);
    const out = frame.generate({}, 1);
    const rows = out.edges.filter((e) => isRow(out, e));
    expect(rows).toHaveLength(5);
    expect(rows.every((e) => (e.sag ?? 0) >= 0.05 && (e.sag ?? 0) <= 0.15)).toBe(true);
    // the rest is the outline: 2·9 + 2·7 − 4 = 28 ring edges, all taut
    expect(out.edges).toHaveLength(5 + 28);
    expect(out.edges.filter((e) => !rows.includes(e)).every((e) => e.sag === 0)).toBe(true);
  });

  it('rows with nailsY = 7 give 5 horizontal lines plus the outline', () => {
    const out = frame.generate({ pattern: 'rows', nailsX: 4, nailsY: 7 }, 1);
    expect(out.edges.filter((e) => isRow(out, e))).toHaveLength(5);
    expect(out.edges).toHaveLength(5 + (2 * 4 + 2 * 7 - 4));
  });

  it('never duplicates corner nails', () => {
    for (const pattern of ['border', 'rows', 'grid', 'zigzag', 'diamond', 'corners', 'string-art', 'nested'])
      for (const [nailsX, nailsY] of [
        [2, 2],
        [5, 3],
        [9, 7],
        [40, 40],
      ]) {
        const out = frame.generate({ pattern, nailsX, nailsY }, 1);
        for (const cx of [-1, 1])
          for (const cy of [-1, 1])
            expect(out.nails.filter((p) => Math.hypot(p.x - cx, p.y - cy) < 1e-6)).toHaveLength(1);
        if (pattern === 'border') expect(out.nails).toHaveLength(2 * nailsX + 2 * nailsY - 4);
      }
  });

  it('the sunburst centre-nail anchor has degree = total − 1', () => {
    for (const outline of [true, false]) {
      const out = frame.generate({ pattern: 'sunburst', anchor: 'centre-nail', nailsX: 8, nailsY: 6, outline }, 1);
      const hub = out.nails.findIndex((p) => p.x === 0 && p.y === 0);
      expect(hub).toBeGreaterThanOrEqual(0);
      expect(degrees(out)[hub]).toBe(out.nails.length - 1);
    }
  });

  it('an edge sunburst starts at the exact centre and rays to every nail off its own side', () => {
    for (const nailsX of [8, 9]) {
      const out = frame.generate({ pattern: 'sunburst', anchor: 'top-centre', nailsX, nailsY: 6 }, 1);
      const hub = out.nails.findIndex((p) => Math.abs(p.x) < 1e-9 && p.y === -1);
      expect(hub).toBeGreaterThanOrEqual(0);
      const offSide = out.nails.filter((p) => p.y > -1).length;
      // plus its two neighbours along the top, via the outline
      expect(degrees(out)[hub]).toBe(offSide + 2);
    }
  });

  it('accent patterns with the same counts reuse the perimeter nails', () => {
    const base = frame.generate({ pattern: 'rows', nailsX: 9, nailsY: 7 }, 1);
    for (const pattern of ['corners', 'diamond', 'grid', 'string-art']) {
      const acc = frame.generate({ pattern, nailsX: 9, nailsY: 7, outline: false }, 1);
      expect(acc.edges.length).toBeGreaterThan(4);
      for (const p of acc.nails) expect(base.nails.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9)).toBe(true);
    }
  });

  it('nested adds an inner rectangle with spokes; geometric patterns are taut, garlands droop', () => {
    const out = frame.generate({ pattern: 'nested', nailsX: 6, nailsY: 5, insetSize: 0.5 }, 1);
    const inner = out.nails.filter((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) < 0.51);
    expect(inner).toHaveLength(2 * 6 + 2 * 5 - 4);
    expect(out.edges.length).toBe(2 * 18 + 18);
    for (const pattern of ['border', 'columns', 'grid', 'diamond', 'corners', 'sunburst', 'string-art', 'nested'])
      expect(frame.generate({ pattern }, 1).edges.every((e) => e.sag === 0)).toBe(true);
    const zig = frame.generate({ pattern: 'zigzag', tiers: 3, outline: false }, 1);
    expect(zig.edges.every((e) => (e.sag ?? 0) >= 0.05 && (e.sag ?? 0) <= 0.15)).toBe(true);
  });

  it('suggestTransform fits portrait, square and metric walls with a 6-unit margin', () => {
    for (const wall of [
      { width: 36, height: 60, units: 'in' as const },
      { width: 48, height: 48, units: 'in' as const },
      { width: 300, height: 200, units: 'cm' as const },
    ]) {
      const t = frame.suggestTransform!(wall);
      expect(t.x).toBeCloseTo(wall.width / 2);
      expect(t.y).toBeLessThanOrEqual(wall.height / 2);
      expect(t.x - t.scaleX).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(t.y - t.scaleY).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(t.y + t.scaleY).toBeLessThanOrEqual(wall.height - 6 + 1e-9);
      if (wall.width > wall.height) expect(t.scaleX).toBeGreaterThan(t.scaleY);
      else expect(t.scaleY).toBeGreaterThan(t.scaleX);
    }
  });
});
