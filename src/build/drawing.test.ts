import { describe, expect, it } from 'vitest';
import { plus, plusPlan, spider, triangle, trianglePlan, triangleReport } from '@/contracts/fixtures';
import { formatTwine } from '@/lib/units';
import { coordRows } from './coords';
import { devPlan } from './devPlan';
import { denseFixture } from './devDense';
import { buildPlanDrawing, chooseScale, routeText, SCALES, SHEET_MM, textWidth, type PlanPaper } from './drawing';
import { exportPlanPdf } from './planPdf';

const DATE = '2026-01-02';
const texts = (d: ReturnType<typeof buildPlanDrawing>, sheet = 0) =>
  d.sheets[sheet].items.flatMap((p) => (p.kind === 'text' ? [p.text] : []));

describe('buildPlanDrawing', () => {
  it('draws every nail once, one tag per run, and matching schedules', () => {
    const d = buildPlanDrawing(triangle, trianglePlan, { report: triangleReport, date: DATE, title: 'Tri' });
    expect(d.nails.map((n) => n.id).sort()).toEqual(['A', 'B', 'C']);
    expect(new Set(d.nails.map((n) => n.label)).size).toBe(3);
    expect(d.nails.every((n) => n.labelled)).toBe(true);
    expect(d.tags.map((t) => t.letter)).toEqual(['A']);
    const rows = coordRows(triangle, 'top-left');
    expect(d.nailRows.map((r) => [r.label, r.x, r.y])).toEqual(rows.map((r) => [r.label, `${r.x}"`, `${r.y}"`]));
    expect(d.runRows).toEqual([
      { letter: 'A', name: 'Natural jute', color: '#c8a165', route: '1–2–3–1', cut: formatTwine(trianglePlan.runs[0].cutLength, 'in'), sheet: 1 },
    ]);
    expect(d.sheets).toHaveLength(1);
    const t = texts(d);
    for (const s of ['NAIL SCHEDULE', 'TWINE SCHEDULE', 'BILL OF MATERIALS', 'GENERAL NOTES', 'DATUM', 'TRI', 'SHEET 1 OF 1', 'DRAWN: Photo Web Designer', DATE, `SCALE 1:${d.scale.den}`])
      expect(t).toContain(s);
    expect(t).toContain('72"'); // overall width
    expect(t).toContain('48"'); // overall height
    expect(t).toContain('CLOTHESPINS');
  });

  it.each(['tabloid', 'a3', 'letter', 'a4'] as PlanPaper[])('picks a standard scale that fits the sheet (%s)', (paper) => {
    const d = buildPlanDrawing(spider, devPlan(spider), { paper, date: DATE });
    expect(SCALES.in).toContain(d.scale.den);
    expect(d.width).toBe(SHEET_MM[paper].w);
    expect(d.wall.x).toBeGreaterThanOrEqual(d.field.x);
    expect(d.wall.y).toBeGreaterThanOrEqual(d.field.y);
    expect(d.wall.x + d.wall.w).toBeLessThanOrEqual(d.field.x + d.field.w);
    expect(d.wall.y + d.wall.h).toBeLessThanOrEqual(d.field.y + d.field.h);
    // and the next larger drawing scale would not have fitted as well
    const i = SCALES.in.indexOf(d.scale.den);
    if (i > 0) expect(d.wall.w * (d.scale.den / SCALES.in[i - 1])).toBeGreaterThan(d.field.w * 0.5);
    for (const sheet of d.sheets)
      for (const p of sheet.items) if (p.kind === 'text') expect(p.x).toBeLessThanOrEqual(d.width);
  });

  it('a 72 × 48 in wall is drawn at 1:8 on tabloid', () => {
    expect(buildPlanDrawing(triangle, trianglePlan, { date: DATE }).scale.label).toBe('1:8');
    expect(chooseScale('cm', { width: 200, height: 100 }, { w: 250, h: 200 })).toBe(10);
  });

  it('uses one letter tag and dash pattern per run', () => {
    const plan = devPlan(spider);
    const d = buildPlanDrawing(spider, plan, { date: DATE });
    expect(d.tags.map((t) => t.runId)).toEqual(plan.runs.map((r) => r.id));
    expect(d.runRows.map((r) => r.letter)).toEqual(plan.runs.map((_, i) => String.fromCharCode(65 + i)));
    const twine = d.sheets[0].items.filter((p) => p.kind === 'poly' && !p.closed);
    expect(twine).toHaveLength(plan.runs.length);
    expect(new Set(twine.map((p) => JSON.stringify(p.kind === 'poly' ? p.dash : null))).size).toBe(plan.runs.length);
  });

  it('dense designs overflow the schedules to sheet 2 and keep every row', () => {
    const dense = denseFixture();
    const plan = devPlan(dense);
    expect(dense.edges.length).toBeGreaterThan(1500);
    const d = buildPlanDrawing(dense, plan, { date: DATE });
    expect(d.sheets.length).toBeGreaterThanOrEqual(2);
    expect(d.nailRows.map((r) => r.label)).toEqual(dense.nails.map((_, i) => String(i + 1)));
    expect(d.nailRows.filter((r) => r.sheet === 1).length).toBeLessThanOrEqual(60);
    expect(d.runRows).toHaveLength(plan.runs.length);
    expect(d.tags).toHaveLength(plan.runs.length);
    expect(d.dims.x.dense).toBe(true);
    expect(texts(d).some((t) => /SEE SHEET 2/.test(t))).toBe(true);
    expect(texts(d, 1)).toContain(`SHEET 2 OF ${d.sheets.length}`);
    expect(new Set(d.nails.map((n) => n.id)).size).toBe(dense.nails.length);
  });

  it('measures schedules from the chosen datum', () => {
    const d = buildPlanDrawing(plus, plusPlan, { origin: 'bottom-right', date: DATE });
    const rows = coordRows(plus, 'bottom-right');
    expect(d.nailRows.map((r) => r.x)).toEqual(rows.map((r) => `${r.x}"`));
    expect(d.origin).toBe('bottom-right');
  });
});

describe('routeText', () => {
  it('lists short routes in full and truncates long ones with a count', () => {
    expect(routeText(['1', '5', '9', '13', '1'], 2, 100)).toBe('1–5–9–13–1');
    const long = Array.from({ length: 40 }, (_, i) => String(i + 1));
    const r = routeText(long, 2, 40);
    expect(r).toMatch(/^1–2–.*–…–40 \(40 nails\)$/);
    expect(textWidth(r, 2)).toBeLessThanOrEqual(40);
  });
});

describe('exportPlanPdf', () => {
  it('returns a non-empty PDF blob', async () => {
    const blob = await exportPlanPdf(triangle, trianglePlan, { paper: 'tabloid', origin: 'top-left', title: 'Test', report: triangleReport });
    expect(blob.size).toBeGreaterThan(2000);
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
    expect(head).toBe('%PDF-');
  });

  it('writes one landscape page per sheet', async () => {
    const dense = denseFixture();
    const plan = devPlan(dense);
    const sheets = buildPlanDrawing(dense, plan, { paper: 'letter' }).sheets.length;
    const blob = await exportPlanPdf(dense, plan, { paper: 'letter', origin: 'bottom-left' });
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(sheets);
  });
});
