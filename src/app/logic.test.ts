import { describe, expect, it } from 'vitest';
import type { DesignActions, DesignStore } from '@/contracts/actions';
import type { ResolvedDesign } from '@/contracts/design';
import { emptyDesign, defaultAnalyzeOptions } from '@/contracts/defaults';
import { createDesignStore, deserializeDesign, resolveDesign, resolveDetailed } from '@/model';
import { registry } from '@/generators';
import { analyze, planBuild } from '@/plan';
import { autoFillPins } from './autofill';
import { guardActions, liveSelection, sharedNailLayers, type Mode } from './guard';

const G = { id: 'g', name: 'Jute', color: '#c8a165', thickness: 2 };

it('resolves and builds imported IDs that match JavaScript object properties', () => {
  const design = emptyDesign();
  design.groups = [{ ...G, id: '__proto__' }];
  design.nails = [{ id: 'constructor', x: 1, y: 1 }, { id: 'toString', x: 41, y: 1 }];
  design.edges = [{ id: '__proto__', a: 'constructor', b: 'toString', groupId: '__proto__', sag: 0 }];
  const resolved = resolveDesign(deserializeDesign(JSON.stringify(design)), registry);
  expect(resolved.edges[0].a).toBe('constructor');
  expect(resolved.edges[0].b).toBe('toString');
  const plan = planBuild(resolved);
  expect(plan.runs).toHaveLength(1);
  expect(plan.totals.cutLengthByGroup.__proto__).toBeGreaterThan(40);
  const report = analyze(resolved);
  expect(report.nailLoad.toString).toBe(1);
  expect(report.photoSlots.__proto__).toBeGreaterThan(0);
});

describe('autoFillPins', () => {
  const resolved: ResolvedDesign = {
    wall: { width: 72, height: 48, units: 'in' },
    groups: [G],
    nails: [
      { id: 'a', x: 4, y: 10 },
      { id: 'b', x: 40, y: 12 }, // long, nearly level: photo slots
      { id: 'c', x: 42, y: 40 }, // b→c is steep: no slots
      { id: 'd', x: 50, y: 12 }, // b→d is level but short: no slots
    ],
    edges: [
      { id: 'level', a: 'a', b: 'b', groupId: 'g', sag: 0.1 },
      { id: 'steep', a: 'b', b: 'c', groupId: 'g', sag: 0 },
      { id: 'short', a: 'b', b: 'd', groupId: 'g', sag: 0 },
    ],
    pins: [],
  };
  const opts = defaultAnalyzeOptions('in');

  it('creates pins on eligible edges only, spread evenly inside the end clearance', () => {
    const report = analyze(resolved, opts);
    expect(report.photoSlots.level).toBeGreaterThan(1);
    expect(report.photoSlots.steep).toBeGreaterThan(0);
    expect(report.photoSlots.short).toBe(0);

    const pins = autoFillPins(resolved, report, opts);
    expect(pins).toHaveLength(report.stats.photoSlots);
    expect(new Set(pins.map((p) => p.edgeId))).toEqual(new Set(['level', 'steep']));
    const ts = pins.filter((p) => p.edgeId === 'level').map((p) => p.t);
    expect([...ts].sort((x, y) => x - y)).toEqual(ts);
    const L = Math.hypot(36, 2);
    for (const t of ts) {
      expect(t * L).toBeGreaterThanOrEqual(opts.endClearance);
      expect((1 - t) * L).toBeGreaterThanOrEqual(opts.endClearance);
    }
    // even spacing
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 2);
  });

  it('orders by edge score and keeps existing photos', () => {
    const r2: ResolvedDesign = {
      ...resolved,
      nails: [...resolved.nails, { id: 'e', x: 4, y: 30 }, { id: 'f', x: 40, y: 44 }],
      edges: [...resolved.edges, { id: 'tilted', a: 'e', b: 'f', groupId: 'g', sag: 0 }],
      pins: [{ id: 'old', edgeId: 'level', t: 0.5, photo: { dataUrl: 'data:x', aspect: 1 } }],
    };
    const report = analyze(r2, opts);
    expect(report.edgeScore.level).toBeGreaterThan(report.edgeScore.tilted);
    const pins = autoFillPins(r2, report, opts);
    expect(pins[0].edgeId).toBe('level');
    expect(pins[pins.length - 1].edgeId).not.toBe('level');
    expect(pins[0].photo?.dataUrl).toBe('data:x');
  });
});

describe('guardActions', () => {
  it('keeps baked strands after removing the live frame they shared nails with', () => {
    const store = createDesignStore({ registry, initial: emptyDesign(), storageKey: null });
    const base = store.getState();
    const rows = base.addLayer({ generatorId: 'frame', seed: 1 });
    const columns = base.addLayer({ generatorId: 'frame', seed: 1, params: { pattern: 'columns', outline: false } });
    const before = resolveDesign(store.getState().design, registry).edges.filter((e) => e.layerId === columns);
    expect(before.length).toBeGreaterThan(0);
    base.bakeLayer(columns);
    base.removeLayer(rows);
    const after = resolveDesign(store.getState().design, registry);
    expect(after.edges.map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort());
    expect(after.nails.length).toBeGreaterThan(0);
  });

  it('protects shared endpoints materialized by baking when their live owner is locked', () => {
    const store = createDesignStore({ registry, initial: emptyDesign(), storageKey: null });
    const base = store.getState();
    base.addLayer({ generatorId: 'frame', seed: 1, locked: true });
    const columns = base.addLayer({ generatorId: 'frame', seed: 1, params: { pattern: 'columns', outline: false } });
    base.bakeLayer(columns);
    const detail = resolveDetailed(store.getState().design, registry);
    const nail = detail.resolved.nails[0];
    const before = store.getState().design;
    const guarded = guardActions(base, () => ({ design: before, selection: store.getState().selection, resolved: detail.resolved, nailLayers: sharedNailLayers(detail), mode: 'refine' }));
    guarded.moveNails([nail.id], { x: 2, y: 0 });
    expect(store.getState().design).toBe(before);
  });

  function setup(mode: Mode = 'refine') {
    const store: DesignStore = createDesignStore({ registry, initial: emptyDesign(), storageKey: null });
    const base: DesignActions = store.getState();
    const id = base.addLayer({ generatorId: 'spider-web', seed: 3 });
    const ctx = { mode };
    const guarded = guardActions(base, () => {
      const st = store.getState();
      return { design: st.design, selection: st.selection, resolved: resolveDesign(st.design, registry), mode: ctx.mode };
    });
    const nail = () => resolveDesign(store.getState().design, registry).nails.find((n) => n.layerId === id)!;
    return { store, base, guarded, id, nail, ctx };
  }

  it('blocks moving nails of a locked layer', () => {
    const { store, base, guarded, id, nail } = setup();
    base.updateLayer(id, { locked: true });
    const before = store.getState().design;
    const n = nail();
    guarded.moveNails([n.id], { x: 5, y: 0 });
    expect(store.getState().design).toBe(before);
    expect(store.getState().design.layers.map((l) => l.id)).toEqual([id]); // not baked

    base.updateLayer(id, { locked: false });
    guarded.moveNails([n.id], { x: 5, y: 0 });
    const moved = store.getState().design.nails.find((x) => x.id === n.id);
    expect(moved?.x).toBeCloseTo(n.x + 5); // unlocked: the move goes through (and bakes)
  });

  it.each(['move', 'delete'] as const)('protects a locked frame sharing nails with an unlocked frame (%s)', (operation) => {
    const store = createDesignStore({ registry, initial: emptyDesign(), storageKey: null });
    const base = store.getState();
    base.addLayer({ generatorId: 'frame', seed: 1 });
    base.addLayer({ generatorId: 'frame', seed: 1, locked: true, groupId: base.addGroup() });
    const guarded = guardActions(base, () => {
      const st = store.getState();
      const detail = resolveDetailed(st.design, registry);
      return { design: st.design, selection: st.selection, resolved: detail.resolved, nailLayers: sharedNailLayers(detail), mode: 'refine' };
    });
    const nail = resolveDesign(store.getState().design, registry).nails[0];
    base.setSelection({ nails: [nail.id] });
    const before = store.getState().design;
    if (operation === 'move') guarded.moveNails([nail.id], { x: 2, y: 0 });
    else guarded.deleteSelection();
    expect(store.getState().design).toBe(before);
  });

  it('blocks deleting a locked layer’s nails and edges', () => {
    const { store, base, guarded, id, nail } = setup();
    base.updateLayer(id, { locked: true });
    const edge = resolveDesign(store.getState().design, registry).edges[0];
    base.setSelection({ nails: [nail().id], edges: [edge.id] });
    const before = store.getState().design;
    guarded.deleteSelection();
    expect(store.getState().design).toBe(before);
  });

  it('in Explore, dragging a live layer’s nail moves the whole layer instead of baking it', () => {
    const { store, guarded, id, nail } = setup('explore');
    const t0 = store.getState().design.layers[0].transform;
    guarded.moveNails([nail().id], { x: 2, y: -1 });
    guarded.moveNails([nail().id], { x: 1, y: 0 });
    const d = store.getState().design;
    expect(d.layers.map((l) => l.id)).toEqual([id]);
    expect(d.nails).toHaveLength(0);
    expect(d.layers[0].transform.x).toBeCloseTo(t0.x + 3);
    expect(d.layers[0].transform.y).toBeCloseTo(t0.y - 1);
  });

  it('filters stale selection ids', () => {
    const { store, base } = setup();
    const r = resolveDesign(store.getState().design, registry);
    const sel = { nails: [r.nails[0].id, 'gone'], edges: ['nope'], pins: [] };
    expect(liveSelection(sel, r)).toEqual({ nails: [r.nails[0].id], edges: [], pins: [] });
    const ok = { nails: [r.nails[0].id], edges: [], pins: [] };
    expect(liveSelection(ok, r)).toBe(ok);
    void base;
  });
});
