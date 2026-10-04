import { createStore } from 'zustand/vanilla';
import { temporal } from 'zundo';
import type { Design, Edge, EdgeId, Layer, LayerId, LayerTransform, NailId, StrandGroup, Wall } from '@/contracts/design';
import type { GeneratorRegistry, SurpriseResult } from '@/contracts/generator';
import type { DesignStore, DesignStoreState, NewLayer, Selection } from '@/contracts/actions';
import { DEFAULT_GROUP_COLORS, emptyDesign } from '@/contracts/defaults';
import { clamp } from '@/lib/geom';
import { newId } from '@/lib/id';
import { randomSeed } from '@/lib/rng';
import { edgeKey } from './merge';
import { layerGeometry, resolveDetailed, safeDefaults } from './resolve';
import { deserializeDesign, serializeDesign } from './serialize';

export interface CreateDesignStoreOptions {
  registry: GeneratorRegistry;
  /** Starting design. Default: autosaved design from storage, else `emptyDesign()`. */
  initial?: Design;
  /** localStorage key for autosave; null disables autosave. Default 'photo-web:autosave'. */
  storageKey?: string | null;
  /** Max undo steps. Default 200. */
  historyLimit?: number;
}

export const DEFAULT_STORAGE_KEY = 'photo-web:autosave';
export const AUTOSAVE_DELAY_MS = 400;
export const DEFAULT_EDGE_SAG = 0.15;

const COLOR_NAMES: Record<string, string> = {
  '#c8a165': 'Natural jute',
  '#b5523b': 'Red cotton',
  '#3f6e8c': 'Blue cotton',
  '#5a8a5e': 'Green cotton',
  '#e8e1d0': 'Cream cotton',
  '#2b2b2b': 'Charcoal',
  '#ffffff': 'White',
  '#000000': 'Black',
};

const emptySelection = (): Selection => ({ nails: [], edges: [], pins: [] });

function getStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function loadAutosave(key: string | null): Design | null {
  if (key === null) return null;
  try {
    const raw = getStorage()?.getItem(key);
    return raw ? deserializeDesign(raw) : null;
  } catch {
    return null;
  }
}

/** Fallback layer placement: wall centre, half-extent = 40% of the short side. */
export function fallbackTransform(wall: Wall): LayerTransform {
  const s = 0.4 * Math.min(wall.width, wall.height);
  return { x: wall.width / 2, y: wall.height / 2, scaleX: s, scaleY: s, rotation: 0 };
}

// ── pure design helpers ──────────────────────────────────────────────

function liveLayerIds(design: Design): Set<LayerId> {
  return new Set(design.layers.map((l) => l.id));
}

/**
 * Freeze a layer into hand nails/edges, keeping ids. Uses the current resolve so
 * the resolved geometry is unchanged. Shared endpoint nails are materialized as
 * well, so deleting another live layer cannot erase the baked strands. Hand
 * edges referring to merged nails are rewritten to the survivor.
 * Unknown generators: the layer is simply removed.
 */
export function bakeLayerInDesign(design: Design, registry: GeneratorRegistry, layerId: LayerId): Design {
  const layer = design.layers.find((l) => l.id === layerId);
  if (!layer) return design;
  const layers = design.layers.filter((l) => l.id !== layerId);
  const geo = layerGeometry(layer, registry);
  if (!geo) return { ...design, layers };

  const det = resolveDetailed(design, registry, layerId);
  const geoEdgeIds = new Set(geo.edges.map((e) => e.id));
  const handNailIds = new Set(design.nails.map((n) => n.id));
  const handEdgeIds = new Set(design.edges.map((e) => e.id));
  const bakedEdges = det.resolved.edges.filter((e) => geoEdgeIds.has(e.id) && !handEdgeIds.has(e.id));
  const endpoints = new Set(bakedEdges.flatMap((e) => [e.a, e.b]));
  const bakedNails = det.resolved.nails
    .filter((n) => !handNailIds.has(n.id) && (det.owner.get(n.id) === layerId || endpoints.has(n.id)))
    .map((n) => ({ ...n, layerId }));

  const alias: Record<NailId, NailId> = Object.create(null);
  for (const n of geo.nails) {
    const to = det.alias[n.id];
    if (to !== undefined) alias[n.id] = to;
  }
  const edges = design.edges.map((e) =>
    alias[e.a] !== undefined || alias[e.b] !== undefined ? { ...e, a: alias[e.a] ?? e.a, b: alias[e.b] ?? e.b } : e,
  );
  return {
    ...design,
    layers,
    nails: [...design.nails, ...bakedNails],
    edges: [...edges, ...bakedEdges],
  };
}

function bakeLayers(design: Design, registry: GeneratorRegistry, ids: Set<LayerId>): Design {
  let d = design;
  for (const l of design.layers) if (ids.has(l.id)) d = bakeLayerInDesign(d, registry, l.id);
  return d;
}

/**
 * All raw nail ids (hand + live-layer) that resolve to one of `targets`, plus the live
 * layers owning any of them.
 */
function nailMembers(design: Design, registry: GeneratorRegistry, targets: Set<NailId>) {
  const det = resolveDetailed(design, registry);
  const members = new Set<NailId>();
  const layers = new Set<LayerId>();
  const consider = (id: NailId) => {
    if (targets.has(det.alias[id] ?? id)) {
      members.add(id);
      const o = det.owner.get(id);
      if (o) layers.add(o);
    }
  };
  for (const n of design.nails) consider(n.id);
  for (const id of det.owner.keys()) consider(id);
  return { members, layers, det };
}

/** Live layers owning any of the given (layer-generated) edge ids. */
function edgeOwners(design: Design, ids: Iterable<EdgeId>): Set<LayerId> {
  const live = liveLayerIds(design);
  const hand = new Set(design.edges.map((e) => e.id));
  const out = new Set<LayerId>();
  for (const id of ids) {
    if (hand.has(id)) continue;
    const slash = id.lastIndexOf('/e');
    if (slash <= 0) continue;
    const lid = id.slice(0, slash);
    if (live.has(lid)) out.add(lid);
  }
  return out;
}

function removeLayerFromDesign(design: Design, id: LayerId): Design {
  if (!design.layers.some((l) => l.id === id)) return design;
  const nailPrefix = `${id}/n`;
  const edgePrefix = `${id}/e`;
  const handNailIds = new Set(design.nails.map((n) => n.id));
  const isLayerNail = (n: NailId) => n.startsWith(nailPrefix) && !handNailIds.has(n);
  const edges = design.edges.filter((e) => !isLayerNail(e.a) && !isLayerNail(e.b));
  const edgeIds = new Set(edges.map((e) => e.id));
  const pins = design.pins.filter((p) => !p.edgeId.startsWith(edgePrefix) || edgeIds.has(p.edgeId));
  const removedEdgeIds = new Set(design.edges.filter((e) => !edgeIds.has(e.id)).map((e) => e.id));
  return {
    ...design,
    layers: design.layers.filter((l) => l.id !== id),
    edges,
    pins: pins.filter((p) => !removedEdgeIds.has(p.edgeId)),
  };
}

// ── store ─────────────────────────────────────────────────────────────

type HistoryState = { design: Design };

export function createDesignStoreImpl(opts: CreateDesignStoreOptions) {
  const { registry } = opts;
  const storageKey = opts.storageKey === undefined ? DEFAULT_STORAGE_KEY : opts.storageKey;
  const limit = opts.historyLimit ?? 200;
  const initial = opts.initial ?? loadAutosave(storageKey) ?? emptyDesign();

  let gestureDepth = 0;
  let gestureStart: Design | null = null;

  const store = createStore<DesignStoreState>()(
    temporal(
      (set, get) => {
        /** Apply a design recipe; stamps meta.updatedAt when the design changed. */
        const mutate = (recipe: (d: Design) => Design) => {
          const prev = get().design;
          const next = recipe(prev);
          if (next === prev) return;
          set({ design: { ...next, meta: { ...next.meta, updatedAt: Date.now() } } });
        };
        const validGroup = (d: Design, id: string | undefined) =>
          id !== undefined && d.groups.some((g) => g.id === id) ? id : d.groups[0]?.id ?? '';

        const ensureGroup = (d: Design, preferred: string): { design: Design; groupId: string } => {
          if (d.groups.some((g) => g.id === preferred)) return { design: d, groupId: preferred };
          if (d.groups.length) return { design: d, groupId: d.groups[0].id };
          const g: StrandGroup = { id: newId('g'), name: 'Natural jute', color: DEFAULT_GROUP_COLORS[0], thickness: 2 };
          return { design: { ...d, groups: [g] }, groupId: g.id };
        };

        const buildLayer = (d: Design, spec: NewLayer, groupId: string): Layer => {
          const gen = registry.get(spec.generatorId);
          const defaults = safeDefaults(registry, spec.generatorId);
          let transform = spec.transform;
          if (!transform) {
            try {
              transform = gen?.suggestTransform?.(d.wall);
            } catch {
              transform = undefined;
            }
          }
          return {
            id: newId('l'),
            name: spec.name ?? gen?.label ?? spec.generatorId,
            generatorId: spec.generatorId,
            params: { ...defaults, ...(spec.params ?? {}) },
            seed: spec.seed ?? randomSeed(),
            transform: transform ?? fallbackTransform(d.wall),
            groupId: spec.groupId ?? groupId,
            sag: spec.sag ?? 0.15,
            visible: spec.visible ?? true,
            locked: spec.locked ?? false,
          };
        };

        const afterHistoryJump = () => {
          const s = get();
          const gid = validGroup(s.design, s.activeGroupId);
          if (gid !== s.activeGroupId) set({ activeGroupId: gid });
        };

        return {
          design: initial,
          selection: emptySelection(),
          activeGroupId: initial.groups[0]?.id ?? '',
          canUndo: false,
          canRedo: false,

          // ── design ──
          setWall: (patch) => mutate((d) => ({ ...d, wall: { ...d.wall, ...patch } })),
          loadDesign: (design) => {
            set({
              design,
              selection: emptySelection(),
              activeGroupId: design.groups[0]?.id ?? '',
            });
          },
          newDesign: (wall) => {
            const design = emptyDesign(wall);
            set({ design, selection: emptySelection(), activeGroupId: design.groups[0].id });
          },
          renameDesign: (name) => mutate((d) => ({ ...d, meta: { ...d.meta, name } })),

          // ── groups ──
          addGroup: (group) => {
            const id = newId('g');
            mutate((d) => {
              const used = new Set(d.groups.map((g) => g.color.toLowerCase()));
              const color =
                group?.color ?? DEFAULT_GROUP_COLORS.find((c) => !used.has(c)) ?? DEFAULT_GROUP_COLORS[d.groups.length % DEFAULT_GROUP_COLORS.length];
              const g: StrandGroup = {
                id,
                name: group?.name ?? COLOR_NAMES[color.toLowerCase()] ?? `Twine ${d.groups.length + 1}`,
                color,
                thickness: group?.thickness ?? 2,
              };
              return { ...d, groups: [...d.groups, g] };
            });
            return id;
          },
          updateGroup: (id, patch) =>
            mutate((d) =>
              d.groups.some((g) => g.id === id)
                ? { ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch, id } : g)) }
                : d,
            ),
          removeGroup: (id) => {
            mutate((d) => {
              if (d.groups.length <= 1 || !d.groups.some((g) => g.id === id)) return d;
              const groups = d.groups.filter((g) => g.id !== id);
              const to = groups[0].id;
              return {
                ...d,
                groups,
                edges: d.edges.map((e) => (e.groupId === id ? { ...e, groupId: to } : e)),
                layers: d.layers.map((l) => (l.groupId === id ? { ...l, groupId: to } : l)),
              };
            });
            afterHistoryJump();
          },

          // ── layers ──
          addLayer: (spec) => {
            let id = '';
            mutate((d0) => {
              const { design: d, groupId } = ensureGroup(d0, get().activeGroupId);
              const layer = buildLayer(d, spec, groupId);
              id = layer.id;
              return { ...d, layers: [...d.layers, layer] };
            });
            afterHistoryJump();
            return id;
          },
          updateLayer: (id, patch) =>
            mutate((d) =>
              d.layers.some((l) => l.id === id)
                ? { ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch, id } : l)) }
                : d,
            ),
          removeLayer: (id) => mutate((d) => removeLayerFromDesign(d, id)),
          moveLayer: (id, toIndex) =>
            mutate((d) => {
              const from = d.layers.findIndex((l) => l.id === id);
              if (from < 0) return d;
              const to = clamp(Math.round(toIndex), 0, d.layers.length - 1);
              if (to === from) return d;
              const layers = d.layers.slice();
              const [l] = layers.splice(from, 1);
              layers.splice(to, 0, l);
              return { ...d, layers };
            }),
          duplicateLayer: (id) => {
            let newLayerId = '';
            mutate((d) => {
              const idx = d.layers.findIndex((l) => l.id === id);
              if (idx < 0) return d;
              const src = d.layers[idx];
              const off = 0.05 * Math.min(d.wall.width, d.wall.height);
              const copy: Layer = {
                ...src,
                id: newId('l'),
                name: `${src.name} copy`,
                params: { ...src.params },
                transform: { ...src.transform, x: src.transform.x + off, y: src.transform.y + off },
              };
              newLayerId = copy.id;
              const layers = d.layers.slice();
              layers.splice(idx + 1, 0, copy);
              return { ...d, layers };
            });
            return newLayerId;
          },
          bakeLayer: (id) => mutate((d) => bakeLayerInDesign(d, registry, id)),
          applySurprise: (result: SurpriseResult, replace) => {
            const ids: LayerId[] = [];
            mutate((d0) => {
              let d = d0;
              if (replace) for (const l of d0.layers) d = removeLayerFromDesign(d, l.id);
              const groups = d.groups.slice();
              const groupForColor = (color: string | undefined): string => {
                if (color === undefined) return validGroup(d, get().activeGroupId) || groups[0]?.id;
                const hit = groups.find((g) => g.color.toLowerCase() === color.toLowerCase());
                if (hit) return hit.id;
                const g: StrandGroup = {
                  id: newId('g'),
                  name: COLOR_NAMES[color.toLowerCase()] ?? `Twine ${groups.length + 1}`,
                  color,
                  thickness: 2,
                };
                groups.push(g);
                return g.id;
              };
              const newLayers: Layer[] = result.layers.map((spec, i) => {
                const color = result.palette.length ? result.palette[i % result.palette.length] : undefined;
                const layer = buildLayer(d, { ...spec }, groupForColor(color));
                ids.push(layer.id);
                return layer;
              });
              let layers = [...d.layers, ...newLayers];
              let finalGroups = groups;
              if (replace) {
                // Drop groups nothing refers to any more (keep at least one).
                const used = new Set([...layers.map((l) => l.groupId), ...d.edges.map((e) => e.groupId)]);
                const kept = groups.filter((g) => used.has(g.id));
                if (kept.length) finalGroups = kept;
              }
              if (!finalGroups.length) {
                const ensured = ensureGroup({ ...d, groups: finalGroups }, '');
                finalGroups = ensured.design.groups;
                layers = layers.map((l) => ({ ...l, groupId: ensured.groupId }));
              }
              return { ...d, groups: finalGroups, layers };
            });
            const s = get();
            if (ids.length) {
              const first = s.design.layers.find((l) => l.id === ids[0]);
              if (first) set({ activeGroupId: first.groupId });
            }
            afterHistoryJump();
            return ids;
          },

          // ── geometry ──
          addNail: (p) => {
            const id = newId('n');
            mutate((d) => ({ ...d, nails: [...d.nails, { id, x: p.x, y: p.y }] }));
            return id;
          },
          moveNails: (ids, delta) => {
            if (!ids.length || (delta.x === 0 && delta.y === 0)) return;
            mutate((d0) => {
              const { members, layers } = nailMembers(d0, registry, new Set(ids));
              if (!members.size) return d0;
              const d = bakeLayers(d0, registry, layers);
              let changed = false;
              const nails = d.nails.map((n) => {
                if (!members.has(n.id)) return n;
                changed = true;
                return { ...n, x: n.x + delta.x, y: n.y + delta.y };
              });
              return changed ? { ...d, nails } : d;
            });
          },
          connect: (a, b, groupId) => {
            if (a === b) return null;
            const s = get();
            const g = groupId ?? s.activeGroupId;
            if (!s.design.groups.some((x) => x.id === g)) return null;
            const det = resolveDetailed(s.design, registry);
            const ra = det.alias[a] ?? a;
            const rb = det.alias[b] ?? b;
            if (ra === rb) return null;
            const nailIds = new Set(det.resolved.nails.map((n) => n.id));
            if (!nailIds.has(ra) || !nailIds.has(rb)) return null;
            const key = edgeKey(ra, rb, g);
            if (det.resolved.edges.some((e) => edgeKey(e.a, e.b, e.groupId) === key)) return null;
            const edge: Edge = { id: newId('e'), a: ra, b: rb, groupId: g, sag: DEFAULT_EDGE_SAG };
            mutate((d) => ({ ...d, edges: [...d.edges, edge] }));
            return edge.id;
          },
          updateEdges: (ids, patch) => {
            if (!ids.length) return;
            mutate((d0) => {
              const d = bakeLayers(d0, registry, edgeOwners(d0, ids));
              const set_ = new Set(ids);
              const clean: Partial<Edge> = {};
              if (patch.sag !== undefined) clean.sag = clamp(patch.sag, 0, 1);
              if (patch.groupId !== undefined && d.groups.some((g) => g.id === patch.groupId)) clean.groupId = patch.groupId;
              if (!Object.keys(clean).length) return d;
              let changed = false;
              const edges = d.edges.map((e) => {
                if (!set_.has(e.id)) return e;
                changed = true;
                return { ...e, ...clean };
              });
              return changed ? { ...d, edges } : d;
            });
          },
          deleteSelection: () => {
            const sel = get().selection;
            if (!sel.nails.length && !sel.edges.length && !sel.pins.length) return;
            mutate((d0) => {
              const { members, layers } = nailMembers(d0, registry, new Set(sel.nails));
              for (const l of edgeOwners(d0, sel.edges)) layers.add(l);
              const d = bakeLayers(d0, registry, layers);
              const selEdges = new Set(sel.edges);
              const removedEdges = new Set<EdgeId>();
              const edges = d.edges.filter((e) => {
                const gone = selEdges.has(e.id) || members.has(e.a) || members.has(e.b);
                if (gone) removedEdges.add(e.id);
                return !gone;
              });
              for (const id of selEdges) removedEdges.add(id);
              const selPins = new Set(sel.pins);
              return {
                ...d,
                nails: d.nails.filter((n) => !members.has(n.id)),
                edges,
                pins: d.pins.filter((p) => !selPins.has(p.id) && !removedEdges.has(p.edgeId)),
              };
            });
            set({ selection: emptySelection() });
          },

          // ── pins ──
          addPin: (edgeId, t) => {
            const id = newId('p');
            mutate((d) => ({ ...d, pins: [...d.pins, { id, edgeId, t: clamp(t, 0, 1) }] }));
            return id;
          },
          updatePin: (id, patch) =>
            mutate((d) =>
              d.pins.some((p) => p.id === id)
                ? {
                    ...d,
                    pins: d.pins.map((p) =>
                      p.id === id ? { ...p, ...patch, id, t: clamp(patch.t ?? p.t, 0, 1) } : p,
                    ),
                  }
                : d,
            ),
          removePin: (id) =>
            mutate((d) => (d.pins.some((p) => p.id === id) ? { ...d, pins: d.pins.filter((p) => p.id !== id) } : d)),
          setPins: (pins) => mutate((d) => ({ ...d, pins: pins.map((p) => ({ ...p })) })),

          // ── ui-ish ──
          setSelection: (sel) => set((s) => ({ selection: { ...s.selection, ...sel } })),
          clearSelection: () => set({ selection: emptySelection() }),
          setActiveGroup: (id) => {
            if (get().design.groups.some((g) => g.id === id)) set({ activeGroupId: id });
          },

          // ── history ──
          undo: () => {
            if (gestureDepth > 0) endGestureNow();
            temporalStore().getState().undo();
            afterHistoryJump();
          },
          redo: () => {
            if (gestureDepth > 0) endGestureNow();
            temporalStore().getState().redo();
            afterHistoryJump();
          },
          beginGesture: () => {
            if (gestureDepth++ === 0) {
              gestureStart = get().design;
              temporalStore().getState().pause();
            }
          },
          endGesture: () => {
            if (gestureDepth === 0) return;
            if (--gestureDepth === 0) finishGesture();
          },
        };
      },
      {
        partialize: (s): HistoryState => ({ design: s.design }),
        equality: (a, b) => a.design === b.design,
        limit,
      },
    ),
  );

  const temporalStore = () => store.temporal;

  function finishGesture() {
    const t = store.temporal;
    t.getState().resume();
    const start = gestureStart;
    gestureStart = null;
    if (start && start !== store.getState().design) {
      const past = t.getState().pastStates.slice();
      if (limit && past.length >= limit) past.shift();
      past.push({ design: start });
      t.setState({ pastStates: past, futureStates: [] });
    }
  }
  function endGestureNow() {
    gestureDepth = 0;
    finishGesture();
  }

  // canUndo / canRedo mirror the temporal store (selection-only sets are not tracked).
  const syncHistoryFlags = () => {
    const t = store.temporal.getState();
    const canUndo = t.pastStates.length > 0 || (gestureStart !== null && gestureStart !== store.getState().design);
    const canRedo = t.futureStates.length > 0;
    const s = store.getState();
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) store.setState({ canUndo, canRedo });
  };
  store.temporal.subscribe(syncHistoryFlags);
  store.subscribe((s, prev) => {
    if (s.design !== prev.design) syncHistoryFlags();
  });

  // Autosave (debounced).
  if (storageKey !== null) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    store.subscribe((s, prev) => {
      if (s.design === prev.design) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          getStorage()?.setItem(storageKey, serializeDesign(store.getState().design));
        } catch {
          // storage full / unavailable: ignore
        }
      }, AUTOSAVE_DELAY_MS);
    });
  }

  return store;
}

// Compile-time check: the zustand store satisfies the framework-agnostic contract.
export type _StoreSatisfiesContract = ReturnType<typeof createDesignStoreImpl> extends DesignStore ? true : never;
