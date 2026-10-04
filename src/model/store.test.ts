import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleDesign } from '@/contracts/fixtures';
import { emptyDesign } from '@/contracts/defaults';
import { createDesignStore, resolveDesign, serializeDesign } from './index';
import { expectGuarantees, makeRegistry } from './testUtils';

const reg = makeRegistry();
const mk = (initial = sampleDesign()) => createDesignStore({ registry: reg, initial, storageKey: null });

describe('design store', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts from initial with clean history', () => {
    const s = mk();
    const st = s.getState();
    expect(st.design.meta.name).toBe('Sample web');
    expect(st.activeGroupId).toBe('g-jute');
    expect(st.canUndo).toBe(false);
    expect(st.canRedo).toBe(false);
  });

  it('undo/redo restores design and keeps flags accurate; selection is not history', () => {
    const s = mk();
    const id = s.getState().addNail({ x: 1, y: 2 });
    expect(s.getState().canUndo).toBe(true);
    s.getState().setSelection({ nails: [id] });
    s.getState().setActiveGroup('g-red');
    s.getState().undo();
    expect(s.getState().design.nails.some((x) => x.id === id)).toBe(false);
    expect(s.getState().canUndo).toBe(false);
    expect(s.getState().canRedo).toBe(true);
    expect(s.getState().selection.nails).toEqual([id]);
    expect(s.getState().activeGroupId).toBe('g-red');
    s.getState().redo();
    expect(s.getState().design.nails.some((x) => x.id === id)).toBe(true);
    expect(s.getState().canRedo).toBe(false);
    s.getState().undo();
    s.getState().addNail({ x: 3, y: 3 }); // new change clears redo
    expect(s.getState().canRedo).toBe(false);
  });

  it('updates meta.updatedAt on mutation', () => {
    const s = mk();
    expect(s.getState().design.meta.updatedAt).toBe(0);
    s.getState().renameDesign('Hello');
    expect(s.getState().design.meta.name).toBe('Hello');
    expect(s.getState().design.meta.updatedAt).toBeGreaterThan(0);
  });

  it('respects historyLimit', () => {
    const s = createDesignStore({ registry: reg, initial: sampleDesign(), storageKey: null, historyLimit: 3 });
    for (let i = 0; i < 6; i++) s.getState().addNail({ x: i, y: i });
    for (let i = 0; i < 10; i++) s.getState().undo();
    expect(s.getState().design.nails).toHaveLength(3 + 3);
  });

  it('collapses a gesture into one undo step', () => {
    const s = mk();
    const before = s.getState().design;
    s.getState().beginGesture();
    for (let i = 0; i < 5; i++) s.getState().moveNails(['A'], { x: 1, y: 0 });
    s.getState().endGesture();
    expect(s.getState().design.nails.find((x) => x.id === 'A')!.x).toBe(15);
    s.getState().undo();
    expect(s.getState().design).toBe(before);
    expect(s.getState().canUndo).toBe(false);
    s.getState().redo();
    expect(s.getState().design.nails.find((x) => x.id === 'A')!.x).toBe(15);
  });

  it('an empty gesture adds no history', () => {
    const s = mk();
    s.getState().beginGesture();
    s.getState().endGesture();
    expect(s.getState().canUndo).toBe(false);
  });

  it('moveNails on a live layer nail bakes the layer, preserving ids', () => {
    const s = mk();
    const before = resolveDesign(s.getState().design, reg);
    s.getState().moveNails(['L1/n0'], { x: 0, y: 2 });
    const d = s.getState().design;
    expect(d.layers).toHaveLength(0);
    const after = resolveDesign(d, reg);
    expect(after.nails.map((x) => x.id)).toEqual(before.nails.map((x) => x.id));
    expect(after.edges.map((x) => x.id).sort()).toEqual(before.edges.map((x) => x.id).sort());
    expect(after.nails.find((x) => x.id === 'L1/n0')).toMatchObject({ x: 50, y: 26 });
    // one undo step brings the layer back
    s.getState().undo();
    expect(s.getState().design.layers).toHaveLength(1);
  });

  it('connect returns null for a===b and duplicates in the same group', () => {
    const s = mk();
    expect(s.getState().connect('A', 'A')).toBeNull();
    expect(s.getState().connect('A', 'B')).toBeNull(); // e-ab exists in g-jute
    expect(s.getState().connect('B', 'A', 'g-jute')).toBeNull();
    const id = s.getState().connect('A', 'B', 'g-red');
    expect(id).not.toBeNull();
    expect(s.getState().connect('B', 'A', 'g-red')).toBeNull();
    // layer edges count too
    expect(s.getState().connect('L1/n1', 'L1/n0', 'g-red')).toBeNull();
    const h = s.getState().connect('A', 'L1/n0');
    expect(h).not.toBeNull();
    expectGuarantees(resolveDesign(s.getState().design, reg));
  });

  it('deleteSelection removes nails with their edges and pins', () => {
    const s = mk();
    s.getState().setSelection({ nails: ['A'] });
    s.getState().deleteSelection();
    const d = s.getState().design;
    expect(d.nails.map((x) => x.id)).toEqual(['B', 'C']);
    expect(d.edges.map((x) => x.id)).toEqual(['e-bc']);
    expect(d.pins).toHaveLength(0); // p1 was on e-ab
    expect(s.getState().selection.nails).toEqual([]);
  });

  it('deleteSelection on layer items bakes the layer first', () => {
    const s = mk();
    const pin = s.getState().addPin('L1/e7', 0.5);
    s.getState().setSelection({ nails: ['L1/n1'], edges: ['L1/e3'], pins: ['p1'] });
    s.getState().deleteSelection();
    const d = s.getState().design;
    expect(d.layers).toHaveLength(0);
    expect(d.nails.some((x) => x.id === 'L1/n1')).toBe(false);
    expect(d.nails.some((x) => x.id === 'L1/n2')).toBe(true);
    const ids = new Set(d.edges.map((x) => x.id));
    expect(ids.has('L1/e0')).toBe(false); // spoke to n1
    expect(ids.has('L1/e3')).toBe(false); // selected
    expect(ids.has('L1/e6')).toBe(false); // n1-n2 ring
    expect(ids.has('L1/e7')).toBe(true);
    expect(d.pins.map((p) => p.id)).toEqual([pin]);
    expectGuarantees(resolveDesign(d, reg));
  });

  it('groups: add, remove reassigns, last group is kept', () => {
    const s = mk();
    s.getState().setActiveGroup('g-red');
    s.getState().removeGroup('g-jute');
    let d = s.getState().design;
    expect(d.groups.map((g) => g.id)).toEqual(['g-red']);
    expect(d.edges.every((x) => x.groupId === 'g-red')).toBe(true);
    s.getState().removeGroup('g-red');
    d = s.getState().design;
    expect(d.groups).toHaveLength(1);
    const gid = s.getState().addGroup({ color: '#ff0000' });
    expect(s.getState().design.groups.find((g) => g.id === gid)).toMatchObject({ color: '#ff0000' });
  });

  it('addLayer fills defaults from registry and active group', () => {
    const s = mk(emptyDesign({}, 0));
    const id = s.getState().addLayer({ generatorId: 'ring' });
    const l = s.getState().design.layers.find((x) => x.id === id)!;
    expect(l).toMatchObject({ name: 'Ring', params: { count: 6 }, groupId: 'g-natural', sag: 0.15, visible: true });
    expect(l.transform).toMatchObject({ x: 36, y: 24, rotation: 0 });
    expect(l.transform.scaleX).toBeCloseTo(19.2);
    expect(l.transform.scaleY).toBeCloseTo(19.2);
    expect(Number.isFinite(l.seed)).toBe(true);
    const id2 = s.getState().addLayer({ generatorId: 'spider-web', params: { spokes: 8 } });
    const l2 = s.getState().design.layers.find((x) => x.id === id2)!;
    expect(l2.transform.scaleX).toBe(10);
    expect(l2.params).toEqual({ spokes: 8 });
  });

  it('layer ops: update, move, duplicate, remove, bake', () => {
    const s = mk(emptyDesign({}, 0));
    const a = s.getState().addLayer({ generatorId: 'ring' });
    const b = s.getState().duplicateLayer(a);
    expect(s.getState().design.layers.map((l) => l.id)).toEqual([a, b]);
    s.getState().moveLayer(b, 0);
    expect(s.getState().design.layers.map((l) => l.id)).toEqual([b, a]);
    s.getState().updateLayer(a, { sag: 0.5 });
    expect(s.getState().design.layers[1].sag).toBe(0.5);
    s.getState().removeLayer(b);
    expect(s.getState().design.layers.map((l) => l.id)).toEqual([a]);
    s.getState().bakeLayer(a);
    expect(s.getState().design.layers).toHaveLength(0);
    expect(s.getState().design.nails).toHaveLength(6);
  });

  it('applySurprise creates groups from the palette and can replace', () => {
    const s = mk();
    const r = reg.surprise(5, s.getState().design.wall);
    const ids = s.getState().applySurprise(r, false);
    expect(ids).toHaveLength(2);
    let d = s.getState().design;
    expect(d.layers).toHaveLength(3);
    const g0 = d.groups.find((g) => g.color === '#3f6e8c')!;
    const g1 = d.groups.find((g) => g.color === '#123456')!;
    expect(d.layers.find((l) => l.id === ids[0])!.groupId).toBe(g0.id);
    expect(d.layers.find((l) => l.id === ids[1])!.groupId).toBe(g1.id);
    const ids2 = s.getState().applySurprise(r, true);
    d = s.getState().design;
    expect(d.layers.map((l) => l.id)).toEqual(ids2);
    expect(d.groups.filter((g) => g.color === '#3f6e8c')).toHaveLength(1);
    expectGuarantees(resolveDesign(d, reg));
  });

  it('pins and updateEdges (bakes layer edges)', () => {
    const s = mk();
    const p = s.getState().addPin('e-bc', 2);
    expect(s.getState().design.pins.find((x) => x.id === p)!.t).toBe(1);
    s.getState().updatePin(p, { t: 0.25 });
    expect(s.getState().design.pins.find((x) => x.id === p)!.t).toBe(0.25);
    s.getState().removePin(p);
    expect(s.getState().design.pins.some((x) => x.id === p)).toBe(false);
    s.getState().updateEdges(['e-ab', 'L1/e0'], { sag: 0.9 });
    const d = s.getState().design;
    expect(d.layers).toHaveLength(0);
    expect(d.edges.find((x) => x.id === 'L1/e0')!.sag).toBe(0.9);
    expect(d.edges.find((x) => x.id === 'e-ab')!.sag).toBe(0.9);
    s.getState().setPins([]);
    expect(s.getState().design.pins).toEqual([]);
  });

  it('setWall, newDesign, loadDesign', () => {
    const s = mk();
    s.getState().setWall({ width: 100 });
    expect(s.getState().design.wall.width).toBe(100);
    s.getState().newDesign({ units: 'cm' });
    expect(s.getState().design.layers).toHaveLength(0);
    expect(s.getState().design.mergeTolerance).toBe(1.25);
    s.getState().loadDesign(sampleDesign());
    expect(s.getState().design.meta.name).toBe('Sample web');
    expect(s.getState().activeGroupId).toBe('g-jute');
  });

  it('autosaves (debounced) and loads the autosave on creation', () => {
    vi.useFakeTimers();
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    const s = createDesignStore({ registry: reg, initial: sampleDesign() });
    s.getState().renameDesign('one');
    s.getState().renameDesign('two');
    expect(mem.size).toBe(0);
    vi.advanceTimersByTime(450);
    expect(JSON.parse(mem.get('photo-web:autosave')!).meta.name).toBe('two');
    const s2 = createDesignStore({ registry: reg });
    expect(s2.getState().design.meta.name).toBe('two');
    mem.set('photo-web:autosave', '{garbage');
    const s3 = createDesignStore({ registry: reg });
    expect(s3.getState().design.meta.name).toBe('Untitled web');
  });

  it('works without localStorage', () => {
    vi.useFakeTimers();
    const s = createDesignStore({ registry: reg });
    s.getState().addNail({ x: 1, y: 1 });
    vi.advanceTimersByTime(1000);
    expect(s.getState().design.nails).toHaveLength(1);
    expect(serializeDesign(s.getState().design)).toContain('"version":1');
  });
});
