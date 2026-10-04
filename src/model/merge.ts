import type { Edge, Nail, NailId } from '@/contracts/design';

export interface MergeResult {
  nails: Nail[];
  edges: Edge[];
  /** merged-away id → surviving id (only ids that were merged away appear). */
  alias: Record<NailId, NailId>;
}

/** Unordered pair + group key used for duplicate-edge detection. */
export function edgeKey(a: NailId, b: NailId, groupId: string): string {
  return a < b ? `${groupId}\u0000${a}\u0000${b}` : `${groupId}\u0000${b}\u0000${a}`;
}

/**
 * Merge nails closer than `tolerance` (exactly coincident nails always merge).
 * Spatial-hash grid with cell size = tolerance, so each nail only checks the
 * 3×3 neighbouring cells (near O(n)). The FIRST occurrence survives; when a nail
 * is within range of several survivors, the earliest survivor wins.
 *
 * Duplicate nail ids: later copies are treated as aliases of the first (same id → dropped).
 * Edges are rewritten through the alias map; self-loops and duplicate
 * (same unordered pair + same group) edges are dropped, keeping the first.
 * Edges whose endpoints are not in `nails` are passed through untouched.
 */
export function mergeNails(nails: Nail[], edges: Edge[], tolerance: number): MergeResult {
  const alias: Record<NailId, NailId> = {};
  const out: Nail[] = [];
  const seenIds = new Set<NailId>();
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const tol2 = tol * tol;

  // grid: cell key → indices into `out` (survivors), in survivor order
  const grid = new Map<string, number[]>();
  const exact = new Map<string, number>();
  const cellOf = (v: number) => Math.floor(v / tol);

  for (const n of nails) {
    if (seenIds.has(n.id)) continue;
    seenIds.add(n.id);
    let target = -1;
    if (tol > 0) {
      const cx = cellOf(n.x);
      const cy = cellOf(n.y);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;
          for (const idx of bucket) {
            if (target !== -1 && idx >= target) break; // buckets are ascending
            const s = out[idx];
            const ddx = s.x - n.x;
            const ddy = s.y - n.y;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < tol2 || d2 === 0) {
              target = idx;
              break;
            }
          }
        }
      }
      if (target === -1) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(out.length);
        else grid.set(key, [out.length]);
      }
    } else {
      const key = `${n.x},${n.y}`;
      const hit = exact.get(key);
      if (hit !== undefined) target = hit;
      else exact.set(key, out.length);
    }
    if (target === -1) out.push(n);
    else alias[n.id] = out[target].id;
  }

  const edgeOut: Edge[] = [];
  const seenEdges = new Set<string>();
  for (const e of edges) {
    const a = alias[e.a] ?? e.a;
    const b = alias[e.b] ?? e.b;
    if (a === b) continue;
    const key = edgeKey(a, b, e.groupId);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edgeOut.push(a === e.a && b === e.b ? e : { ...e, a, b });
  }

  return { nails: out, edges: edgeOut, alias };
}
