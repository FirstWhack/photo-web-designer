import type { Pin, ResolvedDesign } from '@/contracts/design';
import type { AnalyzeOptions, Report } from '@/contracts/plan';
import { dist } from '@/lib/geom';
import { newId } from '@/lib/id';

/**
 * One pin per photo slot, spread evenly along each eligible edge (photoSlots > 0),
 * best edgeScore first. Existing photos are carried over onto the new pins in order.
 */
export function autoFillPins(
  resolved: ResolvedDesign,
  report: Pick<Report, 'photoSlots' | 'edgeScore'>,
  opts: Pick<AnalyzeOptions, 'endClearance'>,
): Pin[] {
  const nails = new Map(resolved.nails.map((n) => [n.id, n]));
  const eligible = resolved.edges
    .filter((e) => (report.photoSlots[e.id] ?? 0) > 0)
    .sort((a, b) => (report.edgeScore[b.id] ?? 0) - (report.edgeScore[a.id] ?? 0) || (a.id < b.id ? -1 : 1));
  const photos = resolved.pins.map((p) => p.photo).filter((p) => p !== undefined);
  const pins: Pin[] = [];
  for (const e of eligible) {
    const a = nails.get(e.a);
    const b = nails.get(e.b);
    if (!a || !b) continue;
    const L = dist(a, b);
    if (L <= 0) continue;
    const n = report.photoSlots[e.id];
    const c = Math.min(opts.endClearance, L / 2);
    const usable = L - 2 * c;
    for (let i = 0; i < n; i++) {
      const t = (c + ((i + 0.5) * usable) / n) / L;
      const pin: Pin = { id: newId('p'), edgeId: e.id, t: Math.round(t * 1000) / 1000 };
      const photo = photos[pins.length];
      if (photo) pin.photo = photo;
      pins.push(pin);
    }
  }
  return pins;
}
