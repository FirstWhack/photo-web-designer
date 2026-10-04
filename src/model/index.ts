/**
 * MODEL domain — public API. Owner: model agent.
 * Pure parts (resolve/merge/serialize) must not touch React. The store is a zustand vanilla store.
 */
import type { Design, Edge, Nail, NailId, ResolvedDesign } from '@/contracts/design';
import type { GeneratorRegistry } from '@/contracts/generator';
import type { DesignStore, DesignStoreState } from '@/contracts/actions';
import { createDesignStoreImpl, type CreateDesignStoreOptions } from './store';
import { useDesignStore as useDesignStoreImpl } from './useDesignStore';
import { resolveDetailed } from './resolve';
import { mergeNails as mergeNailsImpl } from './merge';

export type { CreateDesignStoreOptions } from './store';
export { DEFAULT_STORAGE_KEY, AUTOSAVE_DELAY_MS, bakeLayerInDesign, fallbackTransform } from './store';
export { layerNailId, layerEdgeId, clearLayerCache } from './resolve';
export { validateDesign, serializeDesign, deserializeDesign, encodeShareLink, decodeShareLink } from './serialize';

export function createDesignStore(opts: CreateDesignStoreOptions): DesignStore {
  return createDesignStoreImpl(opts);
}

/** React hook: subscribe to a slice of the store (shallow-compared). */
export function useDesignStore<T>(store: DesignStore, selector: (s: DesignStoreState) => T): T {
  return useDesignStoreImpl(store, selector);
}

/** Evaluate layers + baked geometry into plain geometry. Must satisfy the RESOLVE GUARANTEES in contracts/design.ts. */
export function resolveDesign(design: Design, registry: GeneratorRegistry): ResolvedDesign {
  return resolveDetailed(design, registry).resolved;
}

/** Merge nails within `tolerance`; first occurrence survives. Rewrites edges, drops self-loops & duplicates. */
export function mergeNails(
  nails: Nail[],
  edges: Edge[],
  tolerance: number,
): { nails: Nail[]; edges: Edge[]; alias: Record<NailId, NailId> } {
  return mergeNailsImpl(nails, edges, tolerance);
}
