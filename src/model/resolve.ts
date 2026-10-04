import type { Design, Edge, Layer, Nail, NailId, ParamValues, ResolvedDesign } from '@/contracts/design';
import type { GeneratorRegistry } from '@/contracts/generator';
import { applyTransform } from '@/lib/geom';
import { mergeNails } from './merge';

export const layerNailId = (layerId: string, i: number) => `${layerId}/n${i}`;
export const layerEdgeId = (layerId: string, i: number) => `${layerId}/e${i}`;

export interface LayerGeometry {
  nails: Nail[];
  edges: Edge[];
}

// ── per-layer LRU cache ────────────────────────────────────────────────
// Keyed per registry (WeakMap) and on everything that affects the output.
// Cached arrays are frozen and never handed out directly.

const CACHE_SIZE = 48;
const caches = new WeakMap<GeneratorRegistry, Map<string, LayerGeometry>>();

function cacheFor(registry: GeneratorRegistry): Map<string, LayerGeometry> {
  let c = caches.get(registry);
  if (!c) {
    c = new Map();
    caches.set(registry, c);
  }
  return c;
}

function layerKey(layer: Layer, params: unknown): string {
  return JSON.stringify([
    layer.id,
    layer.generatorId,
    params,
    layer.seed,
    layer.transform,
    layer.sag,
    layer.groupId,
  ]);
}

/** Clear the layer cache (tests / memory pressure). */
export function clearLayerCache(registry?: GeneratorRegistry): void {
  if (registry) caches.delete(registry);
}

/** registry.defaults(id), or {} if it throws / returns nothing. */
export function safeDefaults(registry: GeneratorRegistry, id: string): ParamValues {
  try {
    return registry.defaults(id) ?? {};
  } catch {
    return {};
  }
}

/**
 * Generate + transform one layer (ignores `visible`). Returns null when the
 * generator is unknown or throws. Result objects are shared with the cache:
 * callers must not mutate them.
 */
export function layerGeometry(layer: Layer, registry: GeneratorRegistry): LayerGeometry | null {
  const gen = registry.get(layer.generatorId);
  if (!gen) return null;
  const params = { ...safeDefaults(registry, layer.generatorId), ...layer.params };
  const cache = cacheFor(registry);
  const key = layerKey(layer, sortedObject(params));
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // refresh LRU position
    return hit;
  }
  let out;
  try {
    out = gen.generate(params, layer.seed);
  } catch {
    return null;
  }
  const nails: Nail[] = out.nails.map((p, i) => {
    const w = applyTransform(p, layer.transform);
    return Object.freeze({ id: layerNailId(layer.id, i), x: w.x, y: w.y, layerId: layer.id });
  });
  const edges: Edge[] = out.edges.map((e, i) =>
    Object.freeze({
      id: layerEdgeId(layer.id, i),
      a: layerNailId(layer.id, e.a),
      b: layerNailId(layer.id, e.b),
      groupId: layer.groupId,
      sag: e.sag ?? layer.sag,
      layerId: layer.id,
    }),
  );
  const geo: LayerGeometry = { nails: Object.freeze(nails) as Nail[], edges: Object.freeze(edges) as Edge[] };
  cache.set(key, geo);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return geo;
}

function sortedObject(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) r[k] = o[k];
  return r;
}

export interface ResolveDetail {
  resolved: ResolvedDesign;
  /** merged-away nail id → survivor id. */
  alias: Record<NailId, NailId>;
  /** Raw (pre-merge) nail id → owning live layer id, for layer-generated nails. */
  owner: Map<NailId, string>;
}

/**
 * Full resolve with bookkeeping used by the store.
 * `forceVisible` lets a hidden layer contribute (used when baking it).
 */
export function resolveDetailed(
  design: Design,
  registry: GeneratorRegistry,
  forceVisible?: string,
): ResolveDetail {
  const rawNails: Nail[] = [];
  const rawEdges: Edge[] = [];
  const owner = new Map<NailId, string>();
  const nailIds = new Set<NailId>();
  const edgeIds = new Set<string>();

  const pushNail = (n: Nail) => {
    if (nailIds.has(n.id) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return false;
    nailIds.add(n.id);
    rawNails.push(n);
    return true;
  };
  const pushEdge = (e: Edge) => {
    if (edgeIds.has(e.id)) return;
    edgeIds.add(e.id);
    rawEdges.push(e);
  };

  for (const n of design.nails) pushNail(n);
  for (const e of design.edges) pushEdge(e);
  for (const layer of design.layers) {
    if (!layer.visible && layer.id !== forceVisible) continue;
    const geo = layerGeometry(layer, registry);
    if (!geo) continue;
    for (const n of geo.nails) if (pushNail(n)) owner.set(n.id, layer.id);
    for (const e of geo.edges) pushEdge(e);
  }

  const valid = rawEdges.filter((e) => nailIds.has(e.a) && nailIds.has(e.b));
  const merged = mergeNails(rawNails, valid, design.mergeTolerance);
  const liveEdgeIds = new Set(merged.edges.map((e) => e.id));

  const resolved: ResolvedDesign = {
    wall: design.wall,
    groups: design.groups,
    nails: merged.nails.map((n) => ({ ...n })),
    edges: merged.edges.map((e) => ({ ...e })),
    pins: design.pins.filter((p) => liveEdgeIds.has(p.edgeId)),
  };
  return { resolved, alias: merged.alias, owner };
}

/** See contracts/design.ts RESOLVE GUARANTEES. Pure from the caller's point of view. */
export function resolveDesign(design: Design, registry: GeneratorRegistry): ResolvedDesign {
  return resolveDetailed(design, registry).resolved;
}
