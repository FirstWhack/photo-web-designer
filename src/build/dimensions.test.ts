import { describe, expect, it } from 'vitest';
import type { ResolvedDesign } from '@/contracts/design';
import type { MeasureOrigin } from '@/contracts/ui';
import { axisDimensions, baselineDims, clusterPositions, DENSE_POSITIONS, equalSpacingGroups, nailDimensions } from './dimensions';

describe('clusterPositions', () => {
  it('merges values within 1/16" and keeps the rest apart', () => {
    const out = clusterPositions([5, 1.05, 2, 1, 2.01, 1.03], 1 / 16);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo((1 + 1.03 + 1.05) / 3);
    expect(out[1]).toBeCloseTo(2.005);
    expect(out[2]).toBe(5);
  });

  it('handles empty input and metric tolerance', () => {
    expect(clusterPositions([], 0.15)).toEqual([]);
    expect(clusterPositions([10, 10.1, 10.4], 0.15)).toHaveLength(2);
  });
});

describe('equalSpacingGroups', () => {
  it('9 nails at 4 1/2" spacing are one EQ SP group', () => {
    const pos = Array.from({ length: 9 }, (_, i) => 10 + i * 4.5);
    const g = equalSpacingGroups(pos, 'in');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ count: 8, start: 10, end: 46 });
    expect(g[0].text).toBe('8 EQ SP @ 4 1/2" = 36"');
    expect(g[0].short).toEqual(['8 EQ SP @ 4 1/2"', '8 EQ SP']);
  });

  it('splits mixed spacings into groups and singles', () => {
    const g = equalSpacingGroups([0, 4, 8, 12, 15, 18, 25], 'in');
    expect(g.map((s) => s.text)).toEqual(['3 EQ SP @ 4" = 12"', '2 EQ SP @ 3" = 6"', '7"']);
    // the chain covers every gap exactly once
    expect(g.reduce((s, x) => s + x.count, 0)).toBe(6);
  });

  it('tolerates tiny wobble but not real differences', () => {
    expect(equalSpacingGroups([0, 4, 8.03, 12], 'in')).toHaveLength(1);
    expect(equalSpacingGroups([0, 4, 8.5, 12], 'in').length).toBeGreaterThan(1);
  });

  it('formats metric', () => {
    expect(equalSpacingGroups([0, 12.5, 25, 37.5], 'cm')[0].text).toBe('3 EQ SP @ 12.5 cm = 37.5 cm');
  });
});

describe('axisDimensions', () => {
  it('chains from the datum through every position to the far edge', () => {
    const d = axisDimensions([10, 14.5, 19, 23.5, 40], 72, 'in');
    expect(d.dense).toBe(false);
    expect(d.running.map((r) => r.text)).toEqual(['10"', '14 1/2"', '19"', '23 1/2"', '40"']);
    expect(d.chain[0]).toMatchObject({ start: 0, end: 10, count: 1 });
    expect(d.chain.some((s) => s.text === '3 EQ SP @ 4 1/2" = 13 1/2"')).toBe(true);
    expect(d.chain[d.chain.length - 1].end).toBe(72);
    expect(d.chain.reduce((s, x) => s + (x.end - x.start), 0)).toBeCloseTo(72);
    expect(d.overall.text).toBe('72"');
  });

  it('dense axes keep only key positions and EQ groups', () => {
    // 30 nails at 2" spacing, then 10 irregular ones.
    const vals = [...Array.from({ length: 30 }, (_, i) => 2 + i * 2), ...Array.from({ length: 10 }, (_, i) => 62 + i * 0.7 + (i % 3) * 0.2)];
    const d = axisDimensions(vals, 72, 'in');
    expect(d.positions.length).toBeGreaterThan(DENSE_POSITIONS);
    expect(d.dense).toBe(true);
    expect(d.running.length).toBeLessThan(10);
    expect(d.chain.some((s) => s.count >= 29 && /^\d+ EQ SP @ 2" = /.test(s.text))).toBe(true);
    expect(d.chain.reduce((s, x) => s + (x.end - x.start), 0)).toBeCloseTo(72);
  });

  it('baselineDims formats every position', () => {
    expect(baselineDims([0.5, 12.125], 'in').map((d) => d.text)).toEqual(['1/2"', '12 1/8"']);
  });
});

describe('nailDimensions', () => {
  const design: ResolvedDesign = {
    wall: { width: 72, height: 48, units: 'in' },
    groups: [],
    nails: [
      { id: 'a', x: 10, y: 5 },
      { id: 'b', x: 20, y: 5 },
      { id: 'c', x: 20, y: 30 },
    ],
    edges: [],
    pins: [],
  };
  const cases: [MeasureOrigin, number[], number[]][] = [
    ['top-left', [10, 20], [5, 30]],
    ['top-right', [52, 62], [5, 30]],
    ['bottom-left', [10, 20], [18, 43]],
    ['bottom-right', [52, 62], [18, 43]],
  ];
  it.each(cases)('measures from the %s datum', (origin, xs, ys) => {
    const d = nailDimensions(design, origin);
    expect(d.x.positions).toEqual(xs);
    expect(d.y.positions).toEqual(ys);
    expect(d.rows.map((r) => r.label)).toEqual(['1', '2', '3']);
  });
});
