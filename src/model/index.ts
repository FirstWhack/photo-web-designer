/**
 * MODEL domain — public API. Owner: model agent.
 * Pure parts (resolve/merge/serialize) must not touch React. The store is a zustand vanilla store.
 */
import type { Design, Edge, Nail, NailId, ResolvedDesign } from '@/contracts/design';
import type { GeneratorRegistry } from '@/contracts/generator';
import type { DesignStore, DesignStoreState } from '@/contracts/actions';
import { notImplemented } from '@/lib/notImplemented';

export interface CreateDesignStoreOptions {
  registry: GeneratorRegistry;
  /** Starting design. Default: autosaved design from storage, else `emptyDesign()`. */
  initial?: Design;
  /** localStorage key for autosave; null disables autosave. Default 'photo-web:autosave'. */
  storageKey?: string | null;
  /** Max undo steps. Default 200. */
  historyLimit?: number;
}

export function createDesignStore(_opts: CreateDesignStoreOptions): DesignStore {
  return notImplemented('model.createDesignStore');
}

/** React hook: subscribe to a slice of the store (shallow-compared). */
export function useDesignStore<T>(_store: DesignStore, _selector: (s: DesignStoreState) => T): T {
  return notImplemented('model.useDesignStore');
}

/** Evaluate layers + baked geometry into plain geometry. Must satisfy the RESOLVE GUARANTEES in contracts/design.ts. */
export function resolveDesign(_design: Design, _registry: GeneratorRegistry): ResolvedDesign {
  return notImplemented('model.resolveDesign');
}

/** Merge nails within `tolerance`; first occurrence survives. Rewrites edges, drops self-loops & duplicates. */
export function mergeNails(
  _nails: Nail[],
  _edges: Edge[],
  _tolerance: number,
): { nails: Nail[]; edges: Edge[]; alias: Record<NailId, NailId> } {
  return notImplemented('model.mergeNails');
}

export function serializeDesign(_design: Design): string {
  return notImplemented('model.serializeDesign');
}

/** Throws a descriptive Error on invalid input. */
export function deserializeDesign(_json: string): Design {
  return notImplemented('model.deserializeDesign');
}

/** Returns a URL hash fragment (without '#') encoding the design. */
export function encodeShareLink(_design: Design): string {
  return notImplemented('model.encodeShareLink');
}

export function decodeShareLink(_hash: string): Design | null {
  return notImplemented('model.decodeShareLink');
}
