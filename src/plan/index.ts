/**
 * PLAN domain — public API. Owner: plan agent.
 * Pure, deterministic, no React.
 * Missing options default from `defaultPlanOptions` / `defaultAnalyzeOptions(resolved.wall.units)`.
 */
import type { Edge, ResolvedDesign, Vec2 } from '@/contracts/design';
import type { AnalyzeOptions, BuildPlan, PhotoSpec, PlanOptions, Report } from '@/contracts/plan';
import { planBuildImpl } from './build';
import { analyzeImpl, edgeLengthImpl, photoSlotsImpl } from './analyze';

/** Minimum pieces of twine per group + continuous route through each (see contracts/plan.ts). */
export function planBuild(resolved: ResolvedDesign, opts?: Partial<PlanOptions>): BuildPlan {
  return planBuildImpl(resolved, opts);
}

/** Practicality checks + photo capacity. Pass `plan` to also report hairpin issues. */
export function analyze(resolved: ResolvedDesign, opts?: Partial<AnalyzeOptions>, plan?: BuildPlan): Report {
  return analyzeImpl(resolved, opts, plan);
}

/** Sag-curve length of an edge. */
export function edgeLength(edge: Edge, a: Vec2, b: Vec2): number {
  return edgeLengthImpl(edge, a, b);
}

/** Photo slots + suitability score for one edge (formula in contracts/plan.ts). */
export function photoSlots(
  a: Vec2,
  b: Vec2,
  opts: Pick<AnalyzeOptions, 'maxPhotoAngleDeg' | 'endClearance'> & { photo: PhotoSpec },
): { slots: number; score: number } {
  return photoSlotsImpl(a, b, opts);
}

export { closeNailPairs } from './analyze';
export { wrapAt } from './build';
