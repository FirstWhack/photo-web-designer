/**
 * Dev-page helper only: a tiny greedy trail planner so fixtures without a hand-written
 * plan (e.g. spider) can be shown in the walkthrough. The real planner lives in `plan`.
 */
import type { ResolvedDesign } from '@/contracts/design';
import { DEFAULT_PLAN_OPTIONS_IN, HAIRPIN_ANGLE_DEG, PASS_ANGLE_DEG, type BuildPlan, type Run, type Step } from '@/contracts/plan';
import { sagLength, turn } from '@/lib/geom';

export function devPlan(resolved: ResolvedDesign): BuildPlan {
  const o = DEFAULT_PLAN_OPTIONS_IN;
  const nails = new Map(resolved.nails.map((n) => [n.id, n]));
  const runs: Run[] = [];
  for (const g of resolved.groups) {
    const left = new Set(resolved.edges.filter((e) => e.groupId === g.id).map((e) => e.id));
    const edges = new Map(resolved.edges.map((e) => [e.id, e]));
    const degree = (id: string) => [...left].filter((x) => edges.get(x)!.a === id || edges.get(x)!.b === id).length;
    while (left.size) {
      const ids = [...new Set([...left].flatMap((x) => [edges.get(x)!.a, edges.get(x)!.b]))];
      let at = ids.find((id) => degree(id) % 2 === 1) ?? ids[0];
      const seq = [at];
      const used: string[] = [];
      for (;;) {
        const nextEdge = [...left].find((x) => edges.get(x)!.a === at || edges.get(x)!.b === at);
        if (!nextEdge) break;
        left.delete(nextEdge);
        const e = edges.get(nextEdge)!;
        at = e.a === at ? e.b : e.a;
        seq.push(at);
        used.push(nextEdge);
      }
      const steps: Step[] = used.map((eid, i) => {
        const e = edges.get(eid)!;
        const from = nails.get(seq[i])!;
        const to = nails.get(seq[i + 1])!;
        let wrap: Step['wrap'] = 'tie-off';
        let hairpin = false;
        if (i < used.length - 1) {
          const t = turn(from, to, nails.get(seq[i + 2])!);
          wrap = t.angleDeg < PASS_ANGLE_DEG ? 'pass' : t.cross > 0 ? 'cw' : 'ccw';
          hairpin = t.angleDeg > HAIRPIN_ANGLE_DEG;
        }
        return { from: from.id, to: to.id, edgeId: eid, length: sagLength(from, to, e.sag), wrap, hairpin };
      });
      const rawLength = steps.reduce((s, x) => s + x.length, 0);
      const cutLength = (rawLength + o.wrapAllowance * (steps.length - 1) + 2 * o.tail) * (1 + o.waste);
      runs.push({ id: `dev-${runs.length + 1}`, groupId: g.id, nails: seq, steps, rawLength, cutLength });
    }
  }
  const cutLengthByGroup: Record<string, number> = {};
  for (const r of runs) cutLengthByGroup[r.groupId] = (cutLengthByGroup[r.groupId] ?? 0) + r.cutLength;
  return {
    runs,
    totals: {
      runs: runs.length,
      nails: resolved.nails.length,
      edges: resolved.edges.length,
      cutLengthByGroup,
      cutLength: runs.reduce((s, r) => s + r.cutLength, 0),
    },
  };
}
