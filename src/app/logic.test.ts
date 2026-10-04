import { describe, expect, it } from 'vitest';
import type { DesignActions, DesignStore } from '@/contracts/actions';
import type { ResolvedDesign } from '@/contracts/design';
import { emptyDesign, defaultAnalyzeOptions } from '@/contracts/defaults';
import { createDesignStore, resolveDesign } from '@/model';
import { registry } from '@/generators';
import { analyze } from '@/plan';
import { autoFillPins } from './autofill';
import { guardActions, liveSelection, type Mode } from './guard';

const G = { id: 'g', name: 'Jute', color: '#c8a165', thickness: 2 };

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
    expect(report.photoSlots.steep).toBe(0);
    expect(report.photoSlots.short).toBe(0);

    const pins = autoFillPins(resolved, report, opts);
    expect(pins).toHaveLength(report.stats.photoSlots);
    expect(new Set(pins.map((p) => p.edgeId))).toEqual(new Set(['level']));
    const ts = pins.map((p) => p.t);
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
    expect(pins[pins.length - 1].edgeId).toBe('tilted');
    expect(pins[0].photo?.dataUrl).toBe('data:x');
  });
});

describe('guardActions', () => {
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
