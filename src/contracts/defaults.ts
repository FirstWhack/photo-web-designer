import type { Design, Units, Wall } from './design';
import {
  DEFAULT_ANALYZE_OPTIONS_IN,
  DEFAULT_PLAN_OPTIONS_IN,
  type AnalyzeOptions,
  type PlanOptions,
} from './plan';

const CM_PER_IN = 2.54;

export function defaultPlanOptions(units: Units): PlanOptions {
  const k = units === 'cm' ? CM_PER_IN : 1;
  const d = DEFAULT_PLAN_OPTIONS_IN;
  return { wrapAllowance: d.wrapAllowance * k, tail: d.tail * k, waste: d.waste };
}

export function defaultAnalyzeOptions(units: Units): AnalyzeOptions {
  const k = units === 'cm' ? CM_PER_IN : 1;
  const d = DEFAULT_ANALYZE_OPTIONS_IN;
  return {
    minNailSpacing: d.minNailSpacing * k,
    maxNailLoad: d.maxNailLoad,
    minEdgeLength: d.minEdgeLength * k,
    maxPhotoAngleDeg: d.maxPhotoAngleDeg,
    endClearance: d.endClearance * k,
    photo: { width: d.photo.width * k, height: d.photo.height * k, gap: d.photo.gap * k },
  };
}

export const DEFAULT_WALL: Wall = { width: 72, height: 48, units: 'in' };

export const DEFAULT_GROUP_COLORS = ['#c8a165', '#b5523b', '#3f6e8c', '#5a8a5e', '#e8e1d0', '#2b2b2b'];

/** A blank design with one twine group ("natural jute"). */
export function emptyDesign(wall: Partial<Wall> = {}, now = Date.now()): Design {
  const w = { ...DEFAULT_WALL, ...wall };
  return {
    version: 1,
    wall: w,
    groups: [{ id: 'g-natural', name: 'Natural jute', color: DEFAULT_GROUP_COLORS[0], thickness: 2 }],
    layers: [],
    nails: [],
    edges: [],
    pins: [],
    mergeTolerance: w.units === 'cm' ? 1.25 : 0.5,
    meta: { name: 'Untitled web', createdAt: now, updatedAt: now },
  };
}
