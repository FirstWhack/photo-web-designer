import { describe, expect, it } from 'vitest';
import type { Edge, Nail, ResolvedDesign } from '@/contracts/design';
import type { BuildPlan, IssueKind } from '@/contracts/plan';
import { EXPECTED_RUNS, JUTE, RED, fixtures, plus, triangle, trianglePlan, triangleReport } from '@/contracts/fixtures';
import { createRng } from '@/lib/rng';
import { sagLength } from '@/lib/geom';
import { analyze, closeNailPairs, edgeLength, photoSlots, planBuild } from './index';

const WALL = { width: 72, height: 48, units: 'in' as const };
const nail = (id: string, x: number, y: number): Nail => ({ id, x, y });
const edge = (id: string, a: string, b: string, groupId = JUTE.id, sag = 0): Edge => ({ id, a, b, groupId, sag });
const design = (nails: Nail[], edges: Edge[], groups = [JUTE]): ResolvedDesign => ({
  wall: WALL,
  groups,
  nails,
  edges,
  pins: [],
});

/** Independent lower bound: Σ over group components of max(1, odd/2). */
function minRuns(d: ResolvedDesign): number {
  let total = 0;
  const groups = new Set(d.edges.map((e) => e.groupId));
  for (const g of groups) {
    const es = d.edges.filter((e) => e.groupId === g);
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      while (parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    const deg = new Map<string, number>();
    for (const e of es) {
      for (const v of [e.a, e.b]) {
        if (!parent.has(v)) parent.set(v, v);
        deg.set(v, (deg.get(v) ?? 0) + 1);
      }
      parent.set(find(e.a), find(e.b));
    }
    const odd = new Map<string, number>();
    for (const v of parent.keys()) {
      const r = find(v);
      odd.set(r, (odd.get(r) ?? 0) + (deg.get(v)! % 2));
    }
    for (const o of odd.values()) total += Math.max(1, o / 2);
  }
  return total;
}

function expectValidPlan(d: ResolvedDesign, plan: BuildPlan) {
  const pos = new Map(d.nails.map((p) => [p.id, p]));
  const byId = new Map(d.edges.map((e) => [e.id, e]));
  const seen = new Map<string, number>();
  const groupOrder = d.groups.map((g) => g.id);
  let lastGroup = -1;
  let lastSize = Infinity;
  const byGroup: Record<string, number> = {};
  plan.runs.forEach((run, ri) => {
    expect(run.id).toBe(`r${ri + 1}`);
    const gi = groupOrder.indexOf(run.groupId);
    if (gi !== lastGroup) {
      expect(gi).toBeGreaterThan(lastGroup);
      lastGroup = gi;
      lastSize = Infinity;
    }
    expect(run.steps.length).toBeLessThanOrEqual(lastSize);
    lastSize = run.steps.length;
    expect(run.steps.length).toBeGreaterThan(0);
    expect(run.nails.length).toBe(run.steps.length + 1);
    let raw = 0;
    run.steps.forEach((s, i) => {
      const e = byId.get(s.edgeId)!;
      expect(e.groupId).toBe(run.groupId);
      expect([e.a, e.b].sort()).toEqual([s.from, s.to].sort());
      expect(s.from).toBe(run.nails[i]);
      expect(s.to).toBe(run.nails[i + 1]);
      if (i < run.steps.length - 1) {
        expect(s.to).toBe(run.steps[i + 1].from);
        expect(s.wrap).not.toBe('tie-off');
      } else {
        expect(s.wrap).toBe('tie-off');
      }
      expect(s.length).toBeCloseTo(sagLength(pos.get(e.a)!, pos.get(e.b)!, e.sag), 9);
      raw += s.length;
      seen.set(s.edgeId, (seen.get(s.edgeId) ?? 0) + 1);
    });
    expect(run.rawLength).toBeCloseTo(raw, 6);
    expect(run.cutLength).toBeCloseTo((raw + 0.5 * (run.steps.length - 1) + 12) * 1.1, 6);
    byGroup[run.groupId] = (byGroup[run.groupId] ?? 0) + run.cutLength;
  });
  expect(seen.size).toBe(d.edges.length);
  for (const c of seen.values()) expect(c).toBe(1);
  expect(plan.totals.runs).toBe(plan.runs.length);
  expect(plan.totals.edges).toBe(d.edges.length);
  expect(plan.totals.nails).toBe(d.nails.length);
  let sum = 0;
  for (const [g, v] of Object.entries(plan.totals.cutLengthByGroup)) {
    expect(v).toBeCloseTo(byGroup[g] ?? 0, 6);
    sum += v;
  }
  expect(plan.totals.cutLength).toBeCloseTo(sum, 6);
}

describe('planBuild on fixtures', () => {
  for (const [name, d] of Object.entries(fixtures)) {
    it(`${name}: minimum runs and a valid plan`, () => {
      const plan = planBuild(d);
      expect(plan.runs.length).toBe(EXPECTED_RUNS[name as keyof typeof fixtures]);
      expectValidPlan(d, plan);
    });
  }

  it('is deterministic', () => {
    expect(planBuild(fixtures.combo)).toEqual(planBuild(fixtures.combo));
  });

  it('triangle matches the hand-checked plan (up to direction)', () => {
    const plan = planBuild(triangle);
    const run = plan.runs[0];
    const ref = trianglePlan.runs[0];
    expect(run.rawLength).toBeCloseTo(ref.rawLength, 9);
    expect(run.cutLength).toBeCloseTo(ref.cutLength, 9);
    expect(plan.totals.cutLength).toBeCloseTo(trianglePlan.totals.cutLength, 9);
    expect(plan.totals.cutLengthByGroup[JUTE.id]).toBeCloseTo(trianglePlan.totals.cutLengthByGroup[JUTE.id], 9);
    expect(run.nails[0]).toBe('A');
    const forward = run.nails[1] === 'B';
    const wraps = run.steps.map((s) => s.wrap);
    expect(wraps).toEqual(forward ? ['cw', 'cw', 'tie-off'] : ['ccw', 'ccw', 'tie-off']);
    if (forward) expect(run).toEqual({ ...ref, rawLength: run.rawLength, cutLength: run.cutLength, steps: run.steps });
    expect(run.steps.every((s) => !s.hairpin)).toBe(true);
  });

  it('plus: goes straight through O', () => {
    const plan = planBuild(plus);
    expect(plan.runs.length).toBe(2);
    for (const run of plan.runs) {
      expect(run.nails[1]).toBe('O');
      expect(run.steps[0].wrap).toBe('pass');
    }
    // Starts at the top-most / left-most end, like the fixture.
    expect(plan.runs.map((r) => r.nails)).toEqual([
      ['W', 'O', 'E'],
      ['N', 'O', 'S'],
    ]);
  });

  it('respects plan options', () => {
    const plan = planBuild(triangle, { wrapAllowance: 0, tail: 0, waste: 0 });
    expect(plan.runs[0].cutLength).toBeCloseTo(plan.runs[0].rawLength, 9);
  });

  it('handles empty designs and groups without edges', () => {
    const plan = planBuild(design([nail('A', 1, 1)], [], [JUTE, RED]));
    expect(plan.runs).toEqual([]);
    expect(plan.totals).toEqual({ runs: 0, nails: 1, edges: 0, cutLengthByGroup: { [JUTE.id]: 0, [RED.id]: 0 }, cutLength: 0 });
  });

  it('flags hairpins and wraps reversals', () => {
    // A path that must double back: A-B then B-C where C is almost back at A.
    const d = design([nail('A', 10, 10), nail('B', 30, 10), nail('C', 11, 11)], [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')]);
    const plan = planBuild(d);
    expect(plan.runs.length).toBe(1);
    const mid = plan.runs[0].steps[0];
    expect(mid.hairpin).toBe(true);
    expect(['cw', 'ccw']).toContain(mid.wrap);
    const report = analyze(d, {}, plan);
    const hp = report.issues.filter((i) => i.kind === 'hairpin');
    expect(hp).toHaveLength(1);
    expect(hp[0]).toMatchObject({ severity: 'info', nailIds: ['B'], edgeIds: [mid.edgeId, plan.runs[0].steps[1].edgeId] });
  });
});

describe('planBuild stress', () => {
  function randomDesign(seed: number, nNails: number, nEdges: number, groups = [JUTE, RED]): ResolvedDesign {
    const rng = createRng(seed);
    const nails = Array.from({ length: nNails }, (_, i) => nail(`n${i}`, rng.range(0, 72), rng.range(0, 48)));
    const keys = new Set<string>();
    const edges: Edge[] = [];
    while (edges.length < nEdges) {
      const a = rng.int(0, nNails - 1);
      const b = rng.int(0, nNails - 1);
      const g = rng.pick(groups).id;
      const k = `${g}:${Math.min(a, b)}-${Math.max(a, b)}`;
      if (a === b || keys.has(k)) continue;
      keys.add(k);
      edges.push(edge(`e${edges.length}`, `n${a}`, `n${b}`, g, rng.chance(0.3) ? rng.next() : 0));
    }
    return design(nails, edges, groups);
  }

  for (const [seed, nNails] of [
    [1, 300],
    [2, 1500],
    [3, 60],
    [4, 3000],
  ] as const) {
    it(`random 2000-edge graph (seed ${seed}, ${nNails} nails) is minimal, valid and fast`, () => {
      const d = randomDesign(seed, nNails, 2000);
      planBuild(d); // warm-up (JIT)
      const t0 = performance.now();
      const plan = planBuild(d);
      const ms = performance.now() - t0;
      expect(plan.runs.length).toBe(minRuns(d));
      expectValidPlan(d, plan);
      expect(ms).toBeLessThan(50);
    });
  }

  it('many small random graphs are minimal and valid', () => {
    for (let seed = 10; seed < 60; seed++) {
      const d = randomDesign(seed, 8, 12, [JUTE]);
      const plan = planBuild(d);
      expect(plan.runs.length).toBe(minRuns(d));
      expectValidPlan(d, plan);
    }
  });

  it('a high-degree hub stays fast', () => {
    const nails = [nail('hub', 36, 24)];
    const edges: Edge[] = [];
    for (let i = 0; i < 2000; i++) {
      const a = (i * 2 * Math.PI) / 2000;
      nails.push(nail(`p${i}`, 36 + 20 * Math.cos(a), 24 + 20 * Math.sin(a)));
      edges.push(edge(`e${i}`, 'hub', `p${i}`));
    }
    const d = design(nails, edges);
    planBuild(d);
    const t0 = performance.now();
    const plan = planBuild(d);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(plan.runs.length).toBe(1000);
    expectValidPlan(d, plan);
    // Opposite spokes pair up into straight runs through the hub.
    const straight = plan.runs.filter((r) => r.steps[0].wrap === 'pass').length;
    expect(straight / plan.runs.length).toBeGreaterThan(0.9);
  });
});

describe('analyze', () => {
  it('triangle matches the hand-checked report', () => {
    const r = analyze(triangle);
    expect(r.issues).toEqual(triangleReport.issues);
    expect(r.nailLoad).toEqual(triangleReport.nailLoad);
    expect(r.edgeScore).toEqual(triangleReport.edgeScore);
    expect(r.photoSlots).toEqual(triangleReport.photoSlots);
    expect(r.stats.twineLength).toBeCloseTo(triangleReport.stats.twineLength, 9);
    expect({ ...r.stats, twineLength: 0 }).toEqual({ ...triangleReport.stats, twineLength: 0 });
    // Also with the plan (no hairpins in a triangle).
    expect(analyze(triangle, {}, planBuild(triangle)).issues).toEqual([]);
  });

  it('photoSlots follows the formula', () => {
    const o = { maxPhotoAngleDeg: 90, endClearance: 3, photo: { width: 4, height: 6, gap: 2 } };
    expect(photoSlots({ x: 0, y: 0 }, { x: 30, y: 0 }, o)).toEqual({ slots: 4, score: 1 });
    const a15 = photoSlots({ x: 0, y: 0 }, { x: 40 * Math.cos(Math.PI / 12), y: 40 * Math.sin(Math.PI / 12) }, o);
    expect(a15.slots).toBe(5);
    expect(a15.score).toBeCloseTo(1 - (0.6 * 15) / 90, 9);
    // Vertical strands take photos too, spaced by photo height + gap.
    const vert = photoSlots({ x: 0, y: 0 }, { x: 0, y: 40 }, o);
    expect(vert.slots).toBe(4);
    expect(vert.score).toBeCloseTo(0.4, 9);
    // A cap still excludes steeper strands.
    expect(photoSlots({ x: 0, y: 0 }, { x: 0, y: 40 }, { ...o, maxPhotoAngleDeg: 30 })).toEqual({ slots: 0, score: 0 });
    expect(photoSlots({ x: 0, y: 0 }, { x: 5, y: 0 }, o)).toEqual({ slots: 0, score: 0 });
  });

  it('edgeLength is the sag length', () => {
    const e = edge('x', 'A', 'B', JUTE.id, 0.5);
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(edgeLength(e, a, b)).toBe(sagLength(a, b, 0.5));
    expect(edgeLength({ ...e, sag: 0 }, a, b)).toBe(10);
  });

  it('spatial hash finds exactly the close pairs', () => {
    const rng = createRng(7);
    const pts = Array.from({ length: 400 }, () => ({ x: rng.range(0, 20), y: rng.range(0, 20) }));
    const brute: [number, number][] = [];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 0.75) brute.push([i, j]);
    expect(brute.length).toBeGreaterThan(0);
    expect(closeNailPairs(pts, 0.75)).toEqual(brute);
  });

  it('triggers every issue kind', () => {
    const nails = [
      nail('hub', 20, 20),
      nail('near', 20.3, 20), // too close to hub, short edge
      nail('out', 80, 20), // outside the 72-wide wall
      ...Array.from({ length: 9 }, (_, i) => nail(`s${i}`, 20 + 10 * Math.cos(i), 20 + 10 * Math.sin(i))),
      nail('X', 50, 10),
      nail('Y', 60, 10),
      nail('Z', 51, 11), // X→Y→Z doubles back at Y
    ];
    const edges = [
      edge('e-near', 'hub', 'near'),
      edge('e-out', 'hub', 'out'),
      ...Array.from({ length: 9 }, (_, i) => edge(`e-s${i}`, 'hub', `s${i}`)),
      edge('e-xy', 'X', 'Y'),
      edge('e-yz', 'Y', 'Z'),
    ];
    const d = design(nails, edges);
    const report = analyze(d, {}, planBuild(d));
    const kinds = new Set(report.issues.map((i) => i.kind));
    const all: IssueKind[] = ['nails-too-close', 'nail-overload', 'edge-too-short', 'nail-outside-wall', 'hairpin'];
    for (const k of all) expect(kinds).toContain(k);
    expect(report.nailLoad.hub).toBe(11);
    expect(report.issues[0]).toMatchObject({ kind: 'nail-outside-wall', severity: 'error', nailIds: ['out'] });
    expect(report.issues.find((i) => i.kind === 'nails-too-close')).toMatchObject({
      id: 'nails-too-close:hub|near',
      severity: 'warn',
      nailIds: ['hub', 'near'],
    });
    expect(report.issues.find((i) => i.kind === 'nail-overload')).toMatchObject({ id: 'nail-overload:hub', severity: 'warn' });
    expect(report.issues.find((i) => i.kind === 'edge-too-short')).toMatchObject({ id: 'edge-too-short:e-near', edgeIds: ['e-near'] });
    // Severity order: errors, warnings, info. Ids unique, messages present.
    const rank = { error: 0, warn: 1, info: 2 };
    const ranks = report.issues.map((i) => rank[i.severity]);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(report.issues.map((i) => i.id)).size).toBe(report.issues.length);
    for (const i of report.issues) expect(i.message.length).toBeGreaterThan(10);

    // No photo space: only very short edges.
    const steep = design([nail('a', 10, 5), nail('b', 12, 10)], [edge('e', 'a', 'b')]);
    const r2 = analyze(steep);
    expect(r2.issues).toEqual([expect.objectContaining({ id: 'no-photo-space', kind: 'no-photo-space', severity: 'info' })]);
    expect(analyze(design([], [])).issues).toEqual([]);
    expect(analyze(design([], [])).stats.bbox).toBeNull();
  });

  it('options override defaults (cm defaults scale)', () => {
    const r = analyze(triangle, { maxNailLoad: 1 });
    expect(r.issues.filter((i) => i.kind === 'nail-overload')).toHaveLength(3);
    const cm = analyze({ ...triangle, wall: { ...triangle.wall, units: 'cm' } });
    // 30 cm edge: floor((30 - 2*7.62) / (15.24)) = 0 slots.
    expect(cm.photoSlots['e-ab']).toBe(0);
  });
});
