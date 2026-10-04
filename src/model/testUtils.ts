/** Test helpers: a fake generator registry (never import @/generators here) and a guarantees checker. */
import { expect } from 'vitest';
import type { ParamValues, ResolvedDesign } from '@/contracts/design';
import type { Generator, GeneratorRegistry } from '@/contracts/generator';
import { edgeKey } from './merge';

/** Asserts the RESOLVE GUARANTEES from contracts/design.ts. */
export function expectGuarantees(r: ResolvedDesign) {
  const ids = new Set(r.nails.map((x) => x.id));
  expect(ids.size).toBe(r.nails.length);
  const keys = new Set<string>();
  const edgeIds = new Set<string>();
  for (const ed of r.edges) {
    expect(ids.has(ed.a)).toBe(true);
    expect(ids.has(ed.b)).toBe(true);
    expect(ed.a).not.toBe(ed.b);
    const k = edgeKey(ed.a, ed.b, ed.groupId);
    expect(keys.has(k)).toBe(false);
    keys.add(k);
    edgeIds.add(ed.id);
  }
  for (const p of r.pins) expect(edgeIds.has(p.edgeId)).toBe(true);
}

export interface FakeRegistry extends GeneratorRegistry {
  calls: Record<string, number>;
}

export function makeRegistry(): FakeRegistry {
  const calls: Record<string, number> = {};
  const count = (id: string) => (calls[id] = (calls[id] ?? 0) + 1);

  const ring: Generator = {
    id: 'ring',
    label: 'Ring',
    description: 'N nails on a circle, i → i+1',
    schema: [{ key: 'count', label: 'Count', kind: 'int', min: 3, max: 64, default: 6 }],
    generate(params) {
      count('ring');
      const n = Number(params.count ?? 6);
      const nails = Array.from({ length: n }, (_, i) => ({
        x: Math.cos((i * 2 * Math.PI) / n),
        y: Math.sin((i * 2 * Math.PI) / n),
      }));
      const edges = nails.map((_, i) => ({ a: i, b: (i + 1) % n }));
      return { nails, edges };
    },
  };

  /** Centre + 6 spokes + outer ring; outer ring edges have their own sag. Includes a self-loop and a duplicate. */
  const spider: Generator = {
    id: 'spider-web',
    label: 'Spider web',
    description: 'test spider',
    schema: [{ key: 'spokes', label: 'Spokes', kind: 'int', min: 3, max: 12, default: 6 }],
    suggestTransform: (wall) => ({ x: wall.width / 2, y: wall.height / 2, scaleX: 10, scaleY: 10, rotation: 0 }),
    generate(params) {
      count('spider-web');
      const k = Number(params.spokes ?? 6);
      const nails = [{ x: 0, y: 0 }];
      for (let i = 0; i < k; i++) nails.push({ x: Math.cos((i * 2 * Math.PI) / k), y: Math.sin((i * 2 * Math.PI) / k) });
      const edges: { a: number; b: number; sag?: number }[] = [];
      for (let i = 0; i < k; i++) edges.push({ a: 0, b: i + 1 });
      for (let i = 0; i < k; i++) edges.push({ a: i + 1, b: ((i + 1) % k) + 1, sag: 0.4 });
      edges.push({ a: 1, b: 1 }); // self-loop: must be dropped
      edges.push({ a: 1, b: 0 }); // duplicate of spoke 0: must be dropped
      edges.push({ a: 0, b: 99 }); // out of range: must be dropped
      return { nails, edges };
    },
  };

  const gens: Generator[] = [ring, spider];
  const defaults = (id: string): ParamValues => {
    const g = gens.find((x) => x.id === id);
    const out: ParamValues = {};
    for (const p of g?.schema ?? []) out[p.key] = p.default;
    return out;
  };

  return {
    calls,
    list: () => gens,
    get: (id) => gens.find((g) => g.id === id),
    defaults,
    surprise: (seed) => ({
      layers: [
        { name: 'Ring A', generatorId: 'ring', params: { count: 5 }, seed, transform: { x: 20, y: 20, scaleX: 8, scaleY: 8, rotation: 0 }, sag: 0.1 },
        { name: 'Web B', generatorId: 'spider-web', params: {} as ParamValues, seed: seed + 1, transform: { x: 50, y: 24, scaleX: 12, scaleY: 12, rotation: 0 }, sag: 0.2 },
      ],
      palette: ['#3f6e8c', '#123456'],
    }),
  };
}
