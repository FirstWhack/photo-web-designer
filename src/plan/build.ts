/**
 * Stringing planner: minimum continuous twine runs per strand group.
 *
 * Per group → connected components → pair odd-degree nails (greedy nearest neighbour)
 * with virtual edges → Hierholzer Euler circuit (preferring the straightest continuation)
 * → cut the circuit at the virtual edges. Each cut segment is one run, so a component
 * needs max(1, |odd| / 2) runs, which is the minimum possible.
 */
import type { Edge, GroupId, NailId, ResolvedDesign, Vec2 } from '@/contracts/design';
import type { BuildPlan, PlanOptions, Run, Step, WrapAction } from '@/contracts/plan';
import { HAIRPIN_ANGLE_DEG, PASS_ANGLE_DEG } from '@/contracts/plan';
import { defaultPlanOptions } from '@/contracts/defaults';
import { sagLength, turn } from '@/lib/geom';

/** Above this many candidate edges, pick the straightest continuation via cosines (same order, no atan2). */
const FAST_PICK_DEGREE = 16;

/** Top-most, then left-most ordering for nails. */
export function topLeftCompare(p: Vec2, q: Vec2): number {
  return p.y - q.y || p.x - q.x;
}

/** Group ids in plan order: `groups` order first, then unknown groups by first appearance. */
export function groupOrder(resolved: ResolvedDesign): GroupId[] {
  const out = resolved.groups.map((g) => g.id);
  const seen = new Set(out);
  for (const e of resolved.edges) {
    if (!seen.has(e.groupId)) {
      seen.add(e.groupId);
      out.push(e.groupId);
    }
  }
  return out;
}

/** Wrap action + hairpin flag at nail `at` when travelling prev → at → next. */
export function wrapAt(prev: Vec2, at: Vec2, next: Vec2): { wrap: WrapAction; hairpin: boolean } {
  const t = turn(prev, at, next);
  const wrap: WrapAction = t.angleDeg < PASS_ANGLE_DEG ? 'pass' : t.cross > 0 ? 'cw' : 'ccw';
  return { wrap, hairpin: t.angleDeg > HAIRPIN_ANGLE_DEG };
}

/** Builds a Run (minus id) from an ordered nail/edge walk. */
export function makeRun(
  groupId: GroupId,
  nails: NailId[],
  edges: Edge[],
  pos: Map<NailId, Vec2>,
  opts: PlanOptions,
): Omit<Run, 'id'> {
  const steps: Step[] = [];
  let raw = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const from = nails[i];
    const to = nails[i + 1];
    const length = sagLength(pos.get(edge.a)!, pos.get(edge.b)!, edge.sag);
    raw += length;
    let wrap: WrapAction = 'tie-off';
    let hairpin = false;
    if (i < edges.length - 1) {
      ({ wrap, hairpin } = wrapAt(pos.get(from)!, pos.get(to)!, pos.get(nails[i + 2])!));
    }
    steps.push({ from, to, edgeId: edge.id, length, wrap, hairpin });
  }
  const cutLength = (raw + opts.wrapAllowance * (steps.length - 1) + 2 * opts.tail) * (1 + opts.waste);
  return { groupId, nails, steps, rawLength: raw, cutLength };
}

interface Walk {
  nails: NailId[];
  edges: Edge[];
}

/** Plans all runs of one group's edges (any number of components). */
function planGroup(edges: Edge[], pos: Map<NailId, Vec2>): Walk[] {
  // Local vertex indexing.
  const vid = new Map<NailId, number>();
  const vNail: NailId[] = [];
  const vPos: Vec2[] = [];
  const idx = (id: NailId) => {
    let i = vid.get(id);
    if (i === undefined) {
      i = vNail.length;
      vid.set(id, i);
      vNail.push(id);
      vPos.push(pos.get(id)!);
    }
    return i;
  };
  // Edge arrays: real edges first (0..m-1), virtual edges appended later.
  const eu: number[] = [];
  const ev: number[] = [];
  for (const e of edges) {
    eu.push(idx(e.a));
    ev.push(idx(e.b));
  }
  const m = edges.length;
  const n = vNail.length;

  // Components (union-find).
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < m; i++) {
    const a = find(eu[i]);
    const b = find(ev[i]);
    if (a !== b) parent[a] = b;
  }
  const degree = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    degree[eu[i]]++;
    degree[ev[i]]++;
  }
  const comps = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    const r = find(v);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = []));
    c.push(v);
  }

  const byTopLeft = (a: number, b: number) => topLeftCompare(vPos[a], vPos[b]) || a - b;

  // Pair odd nails per component; remember each component's start vertex.
  const starts: number[] = [];
  const virtualOf = new Array<number>(n).fill(-1);
  for (const verts of comps.values()) {
    const odd = verts.filter((v) => degree[v] % 2 === 1).sort(byTopLeft);
    if (odd.length === 0) {
      starts.push([...verts].sort(byTopLeft)[0]);
      continue;
    }
    starts.push(odd[0]);
    const paired = new Array<boolean>(odd.length).fill(false);
    for (let i = 0; i < odd.length; i++) {
      if (paired[i]) continue;
      paired[i] = true;
      let best = -1;
      let bestD = Infinity;
      const p = vPos[odd[i]];
      for (let j = i + 1; j < odd.length; j++) {
        if (paired[j]) continue;
        const q = vPos[odd[j]];
        const d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      paired[best] = true;
      const ve = eu.length;
      eu.push(odd[i]);
      ev.push(odd[best]);
      virtualOf[odd[i]] = ve;
      virtualOf[odd[best]] = ve;
    }
  }

  // Adjacency (real edges only; each vertex has at most one virtual edge, in virtualOf).
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < m; i++) {
    adj[eu[i]].push(i);
    adj[ev[i]].push(i);
  }
  const used = new Array<boolean>(eu.length).fill(false);
  const other = (e: number, v: number) => (eu[e] === v ? ev[e] : eu[e]);

  /** Next unused edge at v: straightest real edge, else the virtual edge, else -1. */
  const pick = (v: number, arrived: number): number => {
    const list = adj[v];
    // Compact away used edges.
    let w = 0;
    for (let r = 0; r < list.length; r++) if (!used[list[r]]) list[w++] = list[r];
    list.length = w;
    if (w > 0) {
      if (arrived < 0 || arrived >= m || w === 1) return list[0];
      const prev = vPos[other(arrived, v)];
      const at = vPos[v];
      let best = list[0];
      if (w <= FAST_PICK_DEGREE) {
        let bestA = Infinity;
        for (const e of list) {
          const a = turn(prev, at, vPos[other(e, v)]).angleDeg;
          if (a < bestA - 1e-9) {
            bestA = a;
            best = e;
          }
        }
        return best;
      }
      // Busy nail: same ordering as the smallest turn angle (largest cosine), without atan2.
      const ix = at.x - prev.x;
      const iy = at.y - prev.y;
      let bestC = -Infinity;
      for (const e of list) {
        const q = vPos[other(e, v)];
        const ox = q.x - at.x;
        const oy = q.y - at.y;
        const l = Math.sqrt(ox * ox + oy * oy);
        const c = l === 0 ? Infinity : (ix * ox + iy * oy) / l;
        if (c > bestC + 1e-12) {
          bestC = c;
          best = e;
        }
      }
      return best;
    }
    const ve = virtualOf[v];
    return ve >= 0 && !used[ve] ? ve : -1;
  };

  const walks: Walk[] = [];
  for (const start of starts) {
    // Iterative Hierholzer.
    const stackV: number[] = [start];
    const stackE: number[] = [-1];
    const popV: number[] = [];
    const popE: number[] = [];
    while (stackV.length > 0) {
      const v = stackV[stackV.length - 1];
      const e = pick(v, stackE[stackE.length - 1]);
      if (e >= 0) {
        used[e] = true;
        stackV.push(other(e, v));
        stackE.push(e);
      } else {
        popV.push(stackV.pop()!);
        popE.push(stackE.pop()!);
      }
    }
    // Reverse pop order → forward circuit: cv[0] = start, ce[i] joins cv[i-1] → cv[i].
    popV.reverse();
    popE.reverse();
    const cv = popV;
    const ce = popE; // ce[0] = -1
    const L = ce.length - 1; // number of circuit edges
    const virtualPositions: number[] = [];
    for (let i = 1; i <= L; i++) if (ce[i] >= m) virtualPositions.push(i);

    if (virtualPositions.length === 0) {
      walks.push({ nails: cv.map((v) => vNail[v]), edges: ce.slice(1).map((e) => edges[e]) });
      continue;
    }
    // Cut at virtual edges: segment between consecutive virtual edges (cyclically).
    const k = virtualPositions.length;
    for (let s = 0; s < k; s++) {
      const vp = virtualPositions[s];
      const next = virtualPositions[(s + 1) % k];
      const segV: number[] = [cv[vp]];
      const segE: number[] = [];
      let i = vp + 1;
      for (;;) {
        if (i > L) i = 1; // wrap around the closed circuit
        if (i === next) break;
        segE.push(ce[i]);
        segV.push(cv[i]);
        i++;
      }
      // Orient: start at the top-most, then left-most end.
      if (byTopLeft(segV[segV.length - 1], segV[0]) < 0) {
        segV.reverse();
        segE.reverse();
      }
      walks.push({ nails: segV.map((v) => vNail[v]), edges: segE.map((e) => edges[e]) });
    }
  }
  return walks;
}

export function planBuildImpl(resolved: ResolvedDesign, opts?: Partial<PlanOptions>): BuildPlan {
  const o: PlanOptions = { ...defaultPlanOptions(resolved.wall.units), ...opts };
  const pos = new Map<NailId, Vec2>(resolved.nails.map((p) => [p.id, { x: p.x, y: p.y }]));
  const byGroup = new Map<GroupId, Edge[]>();
  for (const e of resolved.edges) {
    let list = byGroup.get(e.groupId);
    if (!list) byGroup.set(e.groupId, (list = []));
    list.push(e);
  }

  const runs: Run[] = [];
  const cutLengthByGroup: Record<GroupId, number> = {};
  let cutLength = 0;
  for (const g of groupOrder(resolved)) {
    const groupEdges = byGroup.get(g) ?? [];
    const groupRuns = planGroup(groupEdges, pos).map((w, i) => ({ run: makeRun(g, w.nails, w.edges, pos, o), i }));
    groupRuns.sort(
      (a, b) =>
        b.run.steps.length - a.run.steps.length || b.run.rawLength - a.run.rawLength || a.i - b.i,
    );
    let sum = 0;
    for (const { run } of groupRuns) {
      runs.push({ id: `r${runs.length + 1}`, ...run });
      sum += run.cutLength;
    }
    cutLengthByGroup[g] = sum;
    cutLength += sum;
  }

  return {
    runs,
    totals: {
      runs: runs.length,
      nails: resolved.nails.length,
      edges: resolved.edges.length,
      cutLengthByGroup,
      cutLength,
    },
  };
}
