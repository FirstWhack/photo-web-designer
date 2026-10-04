import type { Nail, NailId } from '@/contracts/design';

/**
 * Human-friendly nail numbers ("1", "2", …) in reading order: top → bottom in horizontal
 * bands of height `band` (wall units), left → right within a band.
 * EVERY view that shows nail numbers (canvas, template, coordinate table, walkthrough)
 * must use this so numbers match between screen, paper and wall.
 */
export function nailLabels(nails: Nail[], band = 1): Record<NailId, string> {
  const sorted = [...nails].sort((p, q) => {
    const bp = Math.floor(p.y / band);
    const bq = Math.floor(q.y / band);
    return bp !== bq ? bp - bq : p.x - q.x || p.y - q.y || (p.id < q.id ? -1 : 1);
  });
  const out: Record<NailId, string> = {};
  sorted.forEach((n, i) => (out[n.id] = String(i + 1)));
  return out;
}
