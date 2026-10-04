import type { DesignActions, Selection } from '@/contracts/actions';
import type { Design, EdgeId, LayerId, NailId, ResolvedDesign } from '@/contracts/design';

export type Mode = 'explore' | 'refine' | 'build';

export interface GuardContext {
  design: Design;
  resolved: ResolvedDesign;
  selection: Selection;
  mode: Mode;
}

const lockedLayers = (d: Design) => new Set(d.layers.filter((l) => l.locked).map((l) => l.id));
const liveLayers = (d: Design) => new Set(d.layers.map((l) => l.id));

/**
 * Wraps the store actions handed to the Scene:
 *  - nails/edges of LOCKED layers can't be moved, edited or deleted (the model doesn't enforce locks);
 *  - in Explore, dragging a live layer's nail moves the whole layer (its transform) instead of baking it,
 *    and deleting is limited to hand-made geometry.
 */
export function guardActions(base: DesignActions, get: () => GuardContext): DesignActions {
  const owners = (ctx: GuardContext) => {
    const nailLayer = new Map<NailId, LayerId | undefined>();
    for (const n of ctx.resolved.nails) nailLayer.set(n.id, n.layerId);
    const edgeLayer = new Map<EdgeId, LayerId | undefined>();
    for (const e of ctx.resolved.edges) edgeLayer.set(e.id, e.layerId);
    return { nailLayer, edgeLayer };
  };

  return {
    ...base,
    moveNails(ids, delta) {
      const ctx = get();
      const locked = lockedLayers(ctx.design);
      const { nailLayer } = owners(ctx);
      const free = ids.filter((id) => {
        const l = nailLayer.get(id);
        return !(l && locked.has(l));
      });
      if (!free.length) return;
      if (ctx.mode !== 'explore') {
        base.moveNails(free, delta);
        return;
      }
      const live = liveLayers(ctx.design);
      const layers = new Set<LayerId>();
      const rest: NailId[] = [];
      for (const id of free) {
        const l = nailLayer.get(id);
        if (l && live.has(l)) layers.add(l);
        else rest.push(id);
      }
      for (const lid of layers) {
        const layer = ctx.design.layers.find((x) => x.id === lid)!;
        const t = layer.transform;
        base.updateLayer(lid, { transform: { ...t, x: t.x + delta.x, y: t.y + delta.y } });
      }
      if (rest.length) base.moveNails(rest, delta);
    },
    updateEdges(ids, patch) {
      const ctx = get();
      const locked = lockedLayers(ctx.design);
      const { edgeLayer } = owners(ctx);
      const free = ids.filter((id) => {
        const l = edgeLayer.get(id);
        return !(l && locked.has(l));
      });
      if (free.length) base.updateEdges(free, patch);
    },
    deleteSelection() {
      const ctx = get();
      const blocked = lockedLayers(ctx.design);
      if (ctx.mode === 'explore') for (const id of liveLayers(ctx.design)) blocked.add(id);
      const { nailLayer, edgeLayer } = owners(ctx);
      const ok = (l: LayerId | undefined) => !(l && blocked.has(l));
      const nails = ctx.selection.nails.filter((id) => nailLayer.has(id) && ok(nailLayer.get(id)));
      const edges = ctx.selection.edges.filter((id) => edgeLayer.has(id) && ok(edgeLayer.get(id)));
      const pinIds = new Set(ctx.resolved.pins.map((p) => p.id));
      const pins = ctx.selection.pins.filter((id) => pinIds.has(id));
      if (!nails.length && !edges.length && !pins.length) return;
      base.setSelection({ nails, edges, pins });
      base.deleteSelection();
    },
  };
}

/** Selection restricted to ids that exist in `resolved` (undo can leave stale ids behind). */
export function liveSelection(sel: Selection, resolved: ResolvedDesign): Selection {
  const nails = new Set(resolved.nails.map((n) => n.id));
  const edges = new Set(resolved.edges.map((e) => e.id));
  const pins = new Set(resolved.pins.map((p) => p.id));
  const n = sel.nails.filter((id) => nails.has(id));
  const e = sel.edges.filter((id) => edges.has(id));
  const p = sel.pins.filter((id) => pins.has(id));
  if (n.length === sel.nails.length && e.length === sel.edges.length && p.length === sel.pins.length) return sel;
  return { nails: n, edges: e, pins: p };
}
