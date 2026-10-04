import { describe, expect, it } from 'vitest';
import type { Design, Edge, Nail } from '@/contracts/design';
import { sampleDesign } from '@/contracts/fixtures';
import { emptyDesign } from '@/contracts/defaults';
import { bakeLayerInDesign, mergeNails, resolveDesign } from './index';
import { expectGuarantees, makeRegistry } from './testUtils';

const n = (id: string, x: number, y: number): Nail => ({ id, x, y });
const e = (id: string, a: string, b: string, groupId = 'g'): Edge => ({ id, a, b, groupId, sag: 0 });

describe('mergeNails', () => {
  it('merges within tolerance, first occurrence survives, alias map correct', () => {
    const nails = [n('a', 0, 0), n('b', 10, 0), n('a2', 0.2, 0.1), n('b2', 10.3, 0), n('c', 20, 0)];
    const edges = [e('e1', 'a', 'b'), e('e2', 'a2', 'b2'), e('e3', 'b', 'c'), e('e4', 'a', 'a2')];
    const r = mergeNails(nails, edges, 0.5);
    expect(r.nails.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.alias).toEqual({ a2: 'a', b2: 'b' });
    // e2 becomes a duplicate of e1, e4 a self-loop
    expect(r.edges.map((x) => x.id)).toEqual(['e1', 'e3']);
    expect(r.nails[0]).toEqual(nails[0]);
  });

  it('keeps the first survivor when a nail is near several', () => {
    const r = mergeNails([n('a', 0, 0), n('b', 0.8, 0), n('c', 0.4, 0)], [], 0.5);
    expect(r.nails.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.alias).toEqual({ c: 'a' });
  });

  it('is stable: the survivor set depends only on order of first occurrence', () => {
    const base = [n('a', 1, 1), n('b', 5, 5), n('c', 9, 9)];
    const dupes = [n('a2', 1.1, 1), n('b2', 5, 5.2), n('c2', 9.3, 9)];
    const r1 = mergeNails([...base, ...dupes], [], 0.5);
    const r2 = mergeNails([...base, ...dupes.slice().reverse()], [], 0.5);
    expect(r1.nails).toEqual(r2.nails);
    expect(r1.alias).toEqual(r2.alias);
    // swapping survivors swaps the alias direction
    const r3 = mergeNails([dupes[0], base[0]], [], 0.5);
    expect(r3.alias).toEqual({ a: 'a2' });
  });

  it('dedupes edges by unordered pair within a group only', () => {
    const nails = [n('a', 0, 0), n('b', 10, 0)];
    const r = mergeNails(nails, [e('1', 'a', 'b'), e('2', 'b', 'a'), e('3', 'a', 'b', 'other')], 0.5);
    expect(r.edges.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('handles many nails quickly and merges grid neighbours across cell borders', () => {
    const nails: Nail[] = [];
    for (let i = 0; i < 20000; i++) nails.push(n(`p${i}`, (i % 200) * 2, Math.floor(i / 200) * 2));
    nails.push(n('dup', 0.49 * 2 * 0 + 1.999, 0.001)); // near p1 (2,0)
    const t0 = performance.now();
    const r = mergeNails(nails, [], 0.5);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.nails.length).toBe(20000);
    expect(r.alias.dup).toBe('p1');
  });

  it('tolerance 0 merges only coincident nails', () => {
    const r = mergeNails([n('a', 1, 1), n('b', 1, 1), n('c', 1, 1.0001)], [], 0);
    expect(r.alias).toEqual({ b: 'a' });
  });
});

describe('resolveDesign', () => {
  it('meets the guarantees for sampleDesign()', () => {
    const reg = makeRegistry();
    const d = sampleDesign();
    const r = resolveDesign(d, reg);
    expectGuarantees(r);
    // triangle hand nails first, then layer nails
    expect(r.nails.slice(0, 3).map((x) => x.id)).toEqual(['A', 'B', 'C']);
    expect(r.nails.slice(3).every((x) => x.layerId === 'L1')).toBe(true);
    expect(r.nails[3].id).toBe('L1/n0');
    expect(r.nails[3]).toMatchObject({ x: 50, y: 24 });
    // 6 spokes + 6 ring edges, junk dropped
    const layerEdges = r.edges.filter((x) => x.layerId === 'L1');
    expect(layerEdges).toHaveLength(12);
    expect(layerEdges.every((x) => x.groupId === 'g-red')).toBe(true);
    expect(layerEdges[0]).toMatchObject({ id: 'L1/e0', sag: 0.2 });
    expect(layerEdges[6]).toMatchObject({ id: 'L1/e6', sag: 0.4 });
    expect(r.pins).toEqual(d.pins);
  });

  it('excludes hidden layers and unknown generators, drops dangling edges and pins', () => {
    const reg = makeRegistry();
    const d = sampleDesign();
    d.layers[0].visible = false;
    d.layers.push({ ...d.layers[0], id: 'L2', generatorId: 'nope', visible: true });
    d.edges.push(e('h1', 'A', 'L1/n0', 'g-jute'));
    d.pins.push({ id: 'p-h1', edgeId: 'h1', t: 0.5 }, { id: 'p-x', edgeId: 'missing', t: 0.2 });
    const r = resolveDesign(d, reg);
    expectGuarantees(r);
    expect(r.nails.map((x) => x.id)).toEqual(['A', 'B', 'C']);
    expect(r.edges.map((x) => x.id)).toEqual(['e-ab', 'e-bc', 'e-ca']);
    expect(r.pins.map((p) => p.id)).toEqual(['p1']);
  });

  it('hand edges may reference layer nails', () => {
    const d = sampleDesign();
    d.edges.push(e('h1', 'A', 'L1/n0', 'g-jute'));
    const r = resolveDesign(d, makeRegistry());
    expect(r.edges.some((x) => x.id === 'h1')).toBe(true);
    expectGuarantees(r);
  });

  it('two layers sharing a nail position merge into one nail (lower layer wins)', () => {
    const reg = makeRegistry();
    const d = emptyDesign({}, 0);
    const g = d.groups[0].id;
    const base = { name: 'r', generatorId: 'ring', params: { count: 4 }, seed: 1, groupId: g, sag: 0, visible: true, locked: false };
    // ring A centred at (20,20) r=10: nail 0 at (30,20). ring B centred at (40,20) r=10: nail 2 at (30,20).
    d.layers = [
      { ...base, id: 'A', transform: { x: 20, y: 20, scaleX: 10, scaleY: 10, rotation: 0 } },
      { ...base, id: 'B', transform: { x: 40, y: 20, scaleX: 10, scaleY: 10, rotation: 0 } },
    ];
    const r = resolveDesign(d, reg);
    expectGuarantees(r);
    expect(r.nails).toHaveLength(7);
    expect(r.nails.some((x) => x.id === 'B/n2')).toBe(false);
    const bEdges = r.edges.filter((x) => x.layerId === 'B');
    expect(bEdges.filter((x) => x.a === 'A/n0' || x.b === 'A/n0')).toHaveLength(2);
  });

  it('caches layer generation and stays pure for callers', () => {
    const reg = makeRegistry();
    const d = sampleDesign();
    const r1 = resolveDesign(d, reg);
    r1.nails[3].x = 999; // caller mutation must not leak into cache
    const r2 = resolveDesign(d, reg);
    expect(reg.calls['spider-web']).toBe(1);
    expect(r2.nails[3].x).toBe(50);
    resolveDesign({ ...d, layers: [{ ...d.layers[0], seed: 7 }] }, reg);
    expect(reg.calls['spider-web']).toBe(2);
    // param order does not matter for the cache
    resolveDesign({ ...d, layers: [{ ...d.layers[0], params: { spokes: 6 } }] }, reg);
    expect(reg.calls['spider-web']).toBe(2);
  });

  it('baking keeps resolved geometry identical', () => {
    const reg = makeRegistry();
    const d: Design = sampleDesign();
    const g = d.groups[0].id;
    // second layer overlapping L1 so baking must respect merge order
    d.layers.push({
      id: 'L2', name: 'ring', generatorId: 'ring', params: { count: 6 }, seed: 1, groupId: g, sag: 0.1,
      visible: true, locked: false, transform: { x: 50, y: 24, scaleX: 16, scaleY: 16, rotation: 0 },
    });
    d.edges.push(e('h1', 'A', 'L2/n0', g));
    const before = resolveDesign(d, reg);
    for (const id of ['L2', 'L1']) {
      const baked = bakeLayerInDesign(d, reg, id);
      expect(baked.layers.some((l) => l.id === id)).toBe(false);
      const after = resolveDesign(baked, reg);
      expect(after.nails.map((x) => [x.id, x.x, x.y])).toEqual(before.nails.map((x) => [x.id, x.x, x.y]));
      expect(after.edges.map((x) => [x.id, x.a, x.b, x.groupId, x.sag]).sort()).toEqual(
        before.edges.map((x) => [x.id, x.a, x.b, x.groupId, x.sag]).sort(),
      );
    }
  });
});
