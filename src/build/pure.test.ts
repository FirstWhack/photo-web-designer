import { describe, expect, it } from 'vitest';
import { plusPlan, spider, triangle, trianglePlan, JUTE } from '@/contracts/fixtures';
import { clipSegment } from './clip';
import { coordCsv, coordRows, measureFrom } from './coords';
import { buildTemplateDoc, exportTemplatePdf, templateLayout } from './pdf';
import { buyableTwine, groupTotals, nailSpares } from './shopping';
import { computeTiles, rowName } from './tiles';
import { buildScreens, stepText } from './walk';
import { devPlan } from './devPlan';
import { nailLabels } from '@/lib/labels';

describe('computeTiles', () => {
  it('picks the orientation with fewer sheets: 1 m square on letter vs A4', () => {
    // letter portrait 6x5=30, landscape 4x7=28; A4 portrait 6x5=30, landscape 4x8=32
    const letter = computeTiles({ width: 1000, height: 1000 }, 'letter', 10, 10);
    expect(letter.orientation).toBe('landscape');
    expect([letter.cols, letter.rows, letter.tiles.length]).toEqual([4, 7, 28]);
    const a4 = computeTiles({ width: 1000, height: 1000 }, 'a4', 10, 10);
    expect(a4.orientation).toBe('portrait');
    expect([a4.cols, a4.rows, a4.tiles.length]).toEqual([6, 5, 30]);
  });

  it('a small wall fits on one sheet', () => {
    const l = computeTiles({ width: 150, height: 150 }, 'a4', 10);
    expect(l.tiles).toHaveLength(1);
    expect(l.tiles[0].id).toBe('A1');
  });

  it.each(['letter', 'a4'] as const)('covers the whole wall with exact overlaps (%s)', (paper) => {
    const wall = { width: 1828.8, height: 1219.2 };
    const l = computeTiles(wall, paper, 12, 10);
    const right = Math.max(...l.tiles.map((t) => t.x + t.w));
    const bottom = Math.max(...l.tiles.map((t) => t.y + t.h));
    expect(right).toBeGreaterThanOrEqual(wall.width);
    expect(bottom).toBeGreaterThanOrEqual(wall.height);
    // One fewer column/row would not cover it.
    expect((l.cols - 2) * (l.contentW - 10) + l.contentW).toBeLessThan(wall.width);
    for (const t of l.tiles) {
      const nb = l.tiles.find((u) => u.row === t.row && u.col === t.col + 1);
      if (nb) expect(t.x + t.w - nb.x).toBeCloseTo(10);
      const dn = l.tiles.find((u) => u.col === t.col && u.row === t.row + 1);
      if (dn) expect(t.y + t.h - dn.y).toBeCloseTo(10);
    }
    expect(l.tiles[0].id).toBe('A1');
    expect(l.tiles[l.cols].id).toBe('B1');
    // Fits on the paper.
    expect(l.contentX + l.contentW).toBeLessThanOrEqual(l.pageW - 12 + 1e-9);
  });

  it('names rows A..Z, AA..', () => {
    expect([rowName(0), rowName(25), rowName(26), rowName(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
  });
});

describe('coordinates', () => {
  const wall = { width: 72, height: 48 };
  it('converts top-left wall coords for all four origins', () => {
    const p = { x: 40, y: 10 };
    expect(measureFrom(p, wall, 'top-left')).toEqual({ x: 40, y: 10 });
    expect(measureFrom(p, wall, 'top-right')).toEqual({ x: 32, y: 10 });
    expect(measureFrom(p, wall, 'bottom-left')).toEqual({ x: 40, y: 38 });
    expect(measureFrom(p, wall, 'bottom-right')).toEqual({ x: 32, y: 38 });
  });
  it('rows are sorted by label and CSV is numeric', () => {
    const rows = coordRows(spider, 'bottom-right');
    expect(rows.map((r) => Number(r.label))).toEqual(rows.map((_, i) => i + 1));
    const tri = coordRows(triangle, 'bottom-left');
    expect(tri.map((r) => [r.label, r.x, r.y])).toEqual([
      ['1', 10, 38],
      ['2', 40, 38],
      ['3', 10, 8],
    ]);
    expect(coordCsv(tri, 'in', 'bottom-left').split('\n')).toEqual([
      'nail,x (in from bottom-left side),y (in from bottom-left side)',
      '1,10,38',
      '2,40,38',
      '3,10,8',
    ]);
  });
});

describe('clipSegment', () => {
  it('clips to a rectangle', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(clipSegment({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(clipSegment({ x: -5, y: -5 }, { x: -1, y: 20 }, r)).toBeNull();
  });
});

describe('walk model', () => {
  it('flattens runs with start, interstitial and done screens', () => {
    expect(buildScreens(plusPlan).map((s) => s.kind)).toEqual(['start', 'step', 'step', 'complete', 'start', 'step', 'step', 'done']);
    expect(buildScreens({ runs: [], totals: trianglePlan.totals }).length).toBe(0);
  });
  it('words wraps', () => {
    const labels = nailLabels(triangle.nails);
    expect(trianglePlan.runs[0].steps.map((s) => stepText(s, labels))).toEqual([
      '#1 → #2, wrap clockwise',
      '#2 → #3, wrap clockwise',
      '#3 → #1, tie off at #1',
    ]);
    expect(stepText({ ...trianglePlan.runs[0].steps[0], wrap: 'ccw' }, labels)).toBe('#1 → #2, wrap counter-clockwise');
  });
});

describe('shopping', () => {
  it('rounds twine up to buyable amounts', () => {
    expect(buyableTwine(127, 'in')).toBe(132);
    expect(buyableTwine(120, 'in')).toBe(120);
    expect(buyableTwine(101, 'cm')).toBe(150);
  });
  it('spares are 10% with at least 2', () => {
    expect([nailSpares(3), nailSpares(40), nailSpares(0)]).toEqual([2, 4, 0]);
  });
  it('group totals equal plan totals', () => {
    const t = groupTotals(triangle, trianglePlan);
    expect(t).toHaveLength(1);
    expect(t[0].cut).toBeCloseTo(trianglePlan.totals.cutLengthByGroup[JUTE.id]);
    expect(t[0].raw).toBeCloseTo(trianglePlan.runs[0].rawLength);
  });
  it('dev plan covers every spider edge once', () => {
    const p = devPlan(spider);
    expect(p.runs.flatMap((r) => r.steps.map((s) => s.edgeId)).sort()).toEqual(spider.edges.map((e) => e.id).sort());
  });
});

describe('template PDF', () => {
  const opts = { paper: 'letter', margin: 10, origin: 'top-left' } as const;
  it('page count = assembly map + one sheet per tile', () => {
    const l = templateLayout(triangle, opts);
    // 72 x 48 in = 1828.8 x 1219.2 mm on letter (portrait 10 x 6 beats landscape 8 x 9)
    expect(l.layout.orientation).toBe('portrait');
    expect(l.layout.tiles).toHaveLength(60);
    expect(l.pageCount).toBe(61);
    expect(l.calibration.sizeMm).toBe(25.4);
    expect(buildTemplateDoc(triangle, opts).getNumberOfPages()).toBe(61);
  });
  it('uses a 5 cm calibration square for metric walls', () => {
    const cm = { ...triangle, wall: { width: 60, height: 40, units: 'cm' as const } };
    const l = templateLayout(cm, { ...opts, paper: 'a4' });
    expect(l.calibration.sizeMm).toBe(50);
    expect(l.wallMm).toEqual({ width: 600, height: 400 });
  });
  it('every nail lands on at least one sheet', () => {
    const l = templateLayout(spider, opts);
    for (const n of spider.nails) {
      const p = { x: n.x * l.k, y: n.y * l.k };
      expect(l.layout.tiles.some((t) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h)).toBe(true);
    }
  });
  it('exports a non-empty PDF blob', async () => {
    const blob = await exportTemplatePdf(triangle, { ...opts, paper: 'a4', origin: 'bottom-right', title: 'Test' });
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toBe('application/pdf');
    const head = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5));
    expect(head).toBe('%PDF-');
  });
});
