/**
 * DEV-ONLY helpers for the canvas playground (/?dev=canvas): a local mock of DesignActions
 * over a ResolvedDesign, a stress fixture, a rough report and a greedy build plan.
 * Nothing here is part of the public canvas API.
 */
import type { DesignActions, Selection } from '@/contracts/actions';
import type { Edge, NailId, ResolvedDesign, StrandGroup } from '@/contracts/design';
import { DEFAULT_ANALYZE_OPTIONS_IN, type BuildPlan, type Issue, type Report, type Run } from '@/contracts/plan';
import { chordAngleDeg, dist, sagLength } from '@/lib/geom';
import { newId } from '@/lib/id';

export const EMPTY_SELECTION: Selection = { nails: [], edges: [], pins: [] };

/** String-art stress test: 200 nails on a circle, chords for multipliers 2..12 (≈2000 edges). */
export function stressFixture(): ResolvedDesign {
  const N = 200;
  const groups: StrandGroup[] = [
    { id: 'g-a', name: 'Rust', color: '#b5523b', thickness: 1 },
    { id: 'g-b', name: 'Jute', color: '#c8a165', thickness: 1 },
    { id: 'g-c', name: 'Indigo', color: '#3f6e8c', thickness: 1 },
  ];
  const nails = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    return { id: `c${i}`, x: 36 + 21 * Math.cos(a), y: 24 + 21 * Math.sin(a) };
  });
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (let m = 2; m <= 12; m++) {
    for (let i = 0; i < N; i++) {
      const j = (i * m) % N;
      if (i === j) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `x${m}-${i}`, a: `c${i}`, b: `c${j}`, groupId: groups[m % 3].id, sag: 0 });
    }
  }
  return { wall: { width: 72, height: 48, units: 'in' }, groups, nails, edges, pins: [] };
}

/** A rough Report (degree, photo-slot formula, a few issue kinds) for overlay demos. */
export function mockReport(r: ResolvedDesign): Report {
  const o = DEFAULT_ANALYZE_OPTIONS_IN;
  const nails = new Map(r.nails.map((n) => [n.id, n]));
  const nailLoad: Record<NailId, number> = {};
  for (const n of r.nails) nailLoad[n.id] = 0;
  const edgeScore: Record<string, number> = {};
  const photoSlots: Record<string, number> = {};
  const issues: Issue[] = [];
  let twine = 0;
  for (const e of r.edges) {
    nailLoad[e.a] = (nailLoad[e.a] ?? 0) + 1;
    nailLoad[e.b] = (nailLoad[e.b] ?? 0) + 1;
    const a = nails.get(e.a)!;
    const b = nails.get(e.b)!;
    const L = dist(a, b);
    const th = chordAngleDeg(a, b);
    const slots = th <= o.maxPhotoAngleDeg ? Math.max(0, Math.floor((L - 2 * o.endClearance) / (o.photo.width + o.photo.gap))) : 0;
    photoSlots[e.id] = slots;
    edgeScore[e.id] = slots > 0 ? Math.max(0, Math.min(1, 1 - th / o.maxPhotoAngleDeg)) : 0;
    twine += sagLength(a, b, e.sag);
    if (L < o.minEdgeLength) issues.push({ id: `short-${e.id}`, kind: 'edge-too-short', severity: 'warn', message: 'Edge too short', edgeIds: [e.id] });
  }
  for (const n of r.nails) {
    if (nailLoad[n.id] > o.maxNailLoad)
      issues.push({ id: `load-${n.id}`, kind: 'nail-overload', severity: 'error', message: 'Too many strands', nailIds: [n.id] });
    else if (nailLoad[n.id] >= 6)
      issues.push({ id: `busy-${n.id}`, kind: 'nail-overload', severity: 'info', message: 'Busy nail', nailIds: [n.id] });
    if (n.x < 0 || n.y < 0 || n.x > r.wall.width || n.y > r.wall.height)
      issues.push({ id: `out-${n.id}`, kind: 'nail-outside-wall', severity: 'error', message: 'Outside wall', nailIds: [n.id] });
  }
  if (r.nails.length <= 400) {
    for (let i = 0; i < r.nails.length; i++)
      for (let j = i + 1; j < r.nails.length; j++) {
        const p = r.nails[i];
        const q = r.nails[j];
        if (dist(p, q) < o.minNailSpacing)
          issues.push({ id: `close-${p.id}-${q.id}`, kind: 'nails-too-close', severity: 'warn', message: 'Nails too close', nailIds: [p.id, q.id] });
      }
  }
  const pts = r.nails;
  return {
    issues,
    nailLoad,
    edgeScore,
    photoSlots,
    stats: {
      nails: r.nails.length,
      edges: r.edges.length,
      twineLength: twine,
      photoSlots: Object.values(photoSlots).reduce((a, b) => a + b, 0),
      bbox: pts.length
        ? {
            minX: Math.min(...pts.map((p) => p.x)),
            minY: Math.min(...pts.map((p) => p.y)),
            maxX: Math.max(...pts.map((p) => p.x)),
            maxY: Math.max(...pts.map((p) => p.y)),
          }
        : null,
    },
  };
}

/** Greedy trail cover per group (dev stand-in for the real planner). */
export function greedyPlan(r: ResolvedDesign): BuildPlan {
  const runs: Run[] = [];
  const nails = new Map(r.nails.map((n) => [n.id, n]));
  for (const g of r.groups) {
    const edges = r.edges.filter((e) => e.groupId === g.id);
    const unused = new Set(edges.map((e) => e.id));
    const adj = new Map<NailId, Edge[]>();
    for (const e of edges) {
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e);
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e);
    }
    const deg = (id: NailId) => (adj.get(id) ?? []).filter((e) => unused.has(e.id)).length;
    while (unused.size) {
      const free = [...adj.keys()].filter((id) => deg(id) > 0);
      let at = free.find((id) => deg(id) % 2 === 1) ?? free[0];
      const run: Run = { id: `r${runs.length + 1}`, groupId: g.id, nails: [at], steps: [], rawLength: 0, cutLength: 0 };
      for (;;) {
        const next = (adj.get(at) ?? []).find((e) => unused.has(e.id));
        if (!next) break;
        unused.delete(next.id);
        const to = next.a === at ? next.b : next.a;
        const length = sagLength(nails.get(at)!, nails.get(to)!, next.sag);
        run.steps.push({ from: at, to, edgeId: next.id, length, wrap: 'cw', hairpin: false });
        run.nails.push(to);
        run.rawLength += length;
        at = to;
      }
      if (run.steps.length) {
        run.steps[run.steps.length - 1].wrap = 'tie-off';
        run.cutLength = run.rawLength * 1.1 + 12;
        runs.push(run);
      }
    }
  }
  const cutLengthByGroup: Record<string, number> = {};
  for (const run of runs) cutLengthByGroup[run.groupId] = (cutLengthByGroup[run.groupId] ?? 0) + run.cutLength;
  return {
    runs,
    totals: {
      runs: runs.length,
      nails: r.nails.length,
      edges: r.edges.length,
      cutLengthByGroup,
      cutLength: runs.reduce((a, x) => a + x.cutLength, 0),
    },
  };
}

export interface MockState {
  resolved: ResolvedDesign;
  selection: Selection;
  activeGroupId: string;
}

/**
 * Minimal DesignActions over local state. Implements what the canvas tools call;
 * the rest are no-ops. `get` returns the latest state synchronously so return values
 * (ids, connect's null) are correct even between renders.
 */
export function createMockActions(get: () => MockState, set: (s: MockState) => void, log: (msg: string) => void): DesignActions {
  const patch = (p: Partial<MockState>) => set({ ...get(), ...p });
  const patchDesign = (f: (r: ResolvedDesign) => Partial<ResolvedDesign>) => {
    const r = get().resolved;
    patch({ resolved: { ...r, ...f(r) } });
  };
  const noop = (name: string) => () => log(`${name} (no-op in dev)`);
  return {
    setWall: (w) => patchDesign((r) => ({ wall: { ...r.wall, ...w } })),
    loadDesign: noop('loadDesign'),
    newDesign: noop('newDesign'),
    renameDesign: noop('renameDesign'),
    addGroup: () => (noop('addGroup')(), ''),
    updateGroup: noop('updateGroup'),
    removeGroup: noop('removeGroup'),
    addLayer: () => (noop('addLayer')(), ''),
    updateLayer: noop('updateLayer'),
    removeLayer: noop('removeLayer'),
    moveLayer: noop('moveLayer'),
    duplicateLayer: () => (noop('duplicateLayer')(), ''),
    bakeLayer: noop('bakeLayer'),
    applySurprise: () => (noop('applySurprise')(), []),

    addNail(p) {
      const id = newId('n');
      patchDesign((r) => ({ nails: [...r.nails, { id, x: p.x, y: p.y }] }));
      log(`addNail ${id} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
      return id;
    },
    moveNails(ids, d) {
      const set_ = new Set(ids);
      patchDesign((r) => ({ nails: r.nails.map((n) => (set_.has(n.id) ? { ...n, x: n.x + d.x, y: n.y + d.y } : n)) }));
    },
    connect(a, b, groupId) {
      const st = get();
      const g = groupId ?? st.activeGroupId;
      if (a === b) return null;
      if (st.resolved.edges.some((e) => e.groupId === g && ((e.a === a && e.b === b) || (e.a === b && e.b === a)))) {
        log(`connect ${a}→${b}: already exists`);
        return null;
      }
      const id = newId('e');
      patchDesign((r) => ({ edges: [...r.edges, { id, a, b, groupId: g, sag: 0.12 }] }));
      log(`connect ${a}→${b} in ${g}`);
      return id;
    },
    updateEdges(ids, p) {
      const s = new Set(ids);
      patchDesign((r) => ({ edges: r.edges.map((e) => (s.has(e.id) ? { ...e, ...p } : e)) }));
    },
    deleteSelection() {
      const { selection: sel } = get();
      const nails = new Set(sel.nails);
      const edges = new Set(sel.edges);
      const pins = new Set(sel.pins);
      patchDesign((r) => {
        const keptEdges = r.edges.filter((e) => !edges.has(e.id) && !nails.has(e.a) && !nails.has(e.b));
        const alive = new Set(keptEdges.map((e) => e.id));
        return {
          nails: r.nails.filter((n) => !nails.has(n.id)),
          edges: keptEdges,
          pins: r.pins.filter((p) => !pins.has(p.id) && alive.has(p.edgeId)),
        };
      });
      patch({ selection: EMPTY_SELECTION });
      log(`deleteSelection (${sel.nails.length} nails, ${sel.edges.length} edges, ${sel.pins.length} pins)`);
    },
    addPin(edgeId, t) {
      const id = newId('p');
      patchDesign((r) => ({ pins: [...r.pins, { id, edgeId, t }] }));
      log(`addPin ${id} on ${edgeId} @ ${t}`);
      return id;
    },
    updatePin(id, p) {
      patchDesign((r) => ({ pins: r.pins.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
    },
    removePin(id) {
      patchDesign((r) => ({ pins: r.pins.filter((x) => x.id !== id) }));
    },
    setPins(pins) {
      patchDesign(() => ({ pins }));
    },
    setSelection(sel) {
      patch({ selection: { ...get().selection, ...sel } });
    },
    clearSelection() {
      patch({ selection: EMPTY_SELECTION });
    },
    setActiveGroup(id) {
      patch({ activeGroupId: id });
    },
    undo: noop('undo'),
    redo: noop('redo'),
    beginGesture: () => log('beginGesture'),
    endGesture: () => log('endGesture'),
  };
}
