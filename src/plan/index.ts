/**
 * PLAN domain — public API. Owner: plan agent.
 * Pure, deterministic, no React.
 * Missing options default from `defaultPlanOptions` / `defaultAnalyzeOptions(resolved.wall.units)`.
 */
import type { Edge, ResolvedDesign, Vec2 } from '@/contracts/design';
import type { AnalyzeOptions, BuildPlan, PhotoSpec, PlanOptions, Report } from '@/contracts/plan';
import { notImplemented } from '@/lib/notImplemented';

/** Minimum pieces of twine per group + continuous route through each (see contracts/plan.ts). */
export function planBuild(_resolved: ResolvedDesign, _opts?: Partial<PlanOptions>): BuildPlan {
  return notImplemented('plan.planBuild');
}

/** Practicality checks + photo capacity. Pass `plan` to also report hairpin issues. */
export function analyze(_resolved: ResolvedDesign, _opts?: Partial<AnalyzeOptions>, _plan?: BuildPlan): Report {
  return notImplemented('plan.analyze');
}

/** Sag-curve length of an edge. */
export function edgeLength(_edge: Edge, _a: Vec2, _b: Vec2): number {
  return notImplemented('plan.edgeLength');
}

/** Photo slots + suitability score for one edge (formula in contracts/plan.ts). */
export function photoSlots(
  _a: Vec2,
  _b: Vec2,
  _opts: Pick<AnalyzeOptions, 'maxPhotoAngleDeg' | 'endClearance'> & { photo: PhotoSpec },
): { slots: number; score: number } {
  return notImplemented('plan.photoSlots');
}
