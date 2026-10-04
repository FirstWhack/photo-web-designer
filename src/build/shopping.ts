import type { GroupId, ResolvedDesign, Units } from '@/contracts/design';
import type { BuildPlan, Report } from '@/contracts/plan';

/** Round twine up to an amount you can actually buy: whole feet, or 0.5 m. Returns wall units. */
export function buyableTwine(length: number, units: Units): number {
  if (units === 'in') return Math.ceil(length / 12 - 1e-9) * 12;
  return Math.ceil(length / 50 - 1e-9) * 50;
}

export function formatBuyable(length: number, units: Units): string {
  const v = buyableTwine(length, units);
  if (units === 'in') {
    const ft = v / 12;
    const yd = ft / 3;
    return `${ft} ft (${Number(yd.toFixed(1))} yd)`;
  }
  return `${(v / 100).toFixed(1)} m`;
}

export const nailSpares = (count: number) => (count === 0 ? 0 : Math.max(2, Math.ceil(count * 0.1)));

export interface GroupTotal {
  groupId: GroupId;
  runs: number;
  raw: number;
  cut: number;
}

export function groupTotals(resolved: ResolvedDesign, plan: BuildPlan): GroupTotal[] {
  const order = resolved.groups.map((g) => g.id);
  for (const r of plan.runs) if (!order.includes(r.groupId)) order.push(r.groupId);
  return order
    .map((groupId) => {
      const runs = plan.runs.filter((r) => r.groupId === groupId);
      return {
        groupId,
        runs: runs.length,
        raw: runs.reduce((s, r) => s + r.rawLength, 0),
        cut: plan.totals.cutLengthByGroup[groupId] ?? runs.reduce((s, r) => s + r.cutLength, 0),
      };
    })
    .filter((g) => g.runs > 0);
}

export function clothespinCount(resolved: ResolvedDesign, report?: Report): number {
  return report ? report.stats.photoSlots : resolved.pins.length;
}
