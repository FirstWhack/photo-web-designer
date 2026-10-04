/**
 * Build-planning and analysis contract. FROZEN CONTRACT — changes go through the orchestrator.
 * All lengths are in wall units.
 */
import type { EdgeId, GroupId, NailId } from './design';

/**
 * What to do with the twine at the `to` nail of a step:
 *  - 'cw' / 'ccw': wrap once around the nail, travelling clockwise / counter-clockwise
 *    as seen facing the wall. Equals the turn direction: in y-down coordinates,
 *    cross(dirIn, dirOut) > 0 → 'cw'.
 *  - 'pass': |turn| < PASS_ANGLE_DEG — run straight past the nail (still hooked on it).
 *  - 'tie-off': last step of a run; tie the twine off at this nail.
 * The run starts with an implicit tie-on at `steps[0].from`.
 */
export type WrapAction = 'cw' | 'ccw' | 'pass' | 'tie-off';

export const PASS_ANGLE_DEG = 15;
/** A turn sharper than this (twine almost doubles back) is flagged `hairpin`. */
export const HAIRPIN_ANGLE_DEG = 150;

export interface Step {
  from: NailId;
  to: NailId;
  edgeId: EdgeId;
  /** Sag-curve length of this edge (`sagLength` from lib/geom). */
  length: number;
  wrap: WrapAction;
  hairpin: boolean;
}

/** One continuous piece of twine. */
export interface Run {
  id: string;
  groupId: GroupId;
  /** Nail visit order; length = steps.length + 1. */
  nails: NailId[];
  steps: Step[];
  /** Sum of step lengths. */
  rawLength: number;
  /**
   * Twine to cut:
   *   (rawLength + wrapAllowance * (steps.length - 1) + 2 * tail) * (1 + waste)
   */
  cutLength: number;
}

export interface BuildPlan {
  /** Ordered: by group (in `groups` order), then by run size descending. */
  runs: Run[];
  totals: {
    runs: number;
    /** All nails in the design, including any with no twine attached. */
    nails: number;
    edges: number;
    /** Sum of cutLength per group. */
    cutLengthByGroup: Record<GroupId, number>;
    cutLength: number;
  };
}

export interface PlanOptions {
  /** Extra twine consumed by each intermediate nail visit. */
  wrapAllowance: number;
  /** Tail left at each end of a run for tying. */
  tail: number;
  /** Fractional waste factor, e.g. 0.1 = +10%. */
  waste: number;
}

export interface PhotoSpec {
  width: number;
  height: number;
  /** Minimum gap between neighbouring photos on an edge. */
  gap: number;
}

export interface AnalyzeOptions {
  minNailSpacing: number;
  maxNailLoad: number;
  minEdgeLength: number;
  /** Edges steeper than this from horizontal get no photo slots. */
  maxPhotoAngleDeg: number;
  /** Clear space kept free at each end of an edge before the first photo. */
  endClearance: number;
  photo: PhotoSpec;
}

export type IssueKind =
  | 'nails-too-close'
  | 'nail-overload'
  | 'edge-too-short'
  | 'nail-outside-wall'
  | 'hairpin'
  | 'no-photo-space';

export interface Issue {
  id: string;
  kind: IssueKind;
  severity: 'info' | 'warn' | 'error';
  message: string;
  nailIds?: NailId[];
  edgeIds?: EdgeId[];
}

/**
 * PHOTO SLOT FORMULA (per edge, using chord length L and chord angle θ from horizontal, 0..90°):
 *   Photos hang plumb, so any angle up to maxPhotoAngleDeg (default 90 = any) takes photos:
 *   pitch = min((photo.width + gap) / cos θ, (photo.height + gap) / sin θ)
 *   slots = θ <= maxPhotoAngleDeg ? max(0, floor((L - 2 * endClearance) / pitch)) : 0
 *   edgeScore = slots > 0 ? clamp(1 - 0.6 * θ / maxPhotoAngleDeg, 0, 1) : 0 (level strands preferred)
 */
export interface Report {
  issues: Issue[];
  /** Number of edges touching each nail (its degree). */
  nailLoad: Record<NailId, number>;
  /** 0..1 photo suitability per edge. */
  edgeScore: Record<EdgeId, number>;
  photoSlots: Record<EdgeId, number>;
  stats: {
    nails: number;
    edges: number;
    /** Sum of sag-curve edge lengths (no allowances). */
    twineLength: number;
    photoSlots: number;
    /** Bounding box of all nails, or null when there are none. */
    bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  };
}

/** Defaults expressed in inches; use `defaultPlanOptions(units)` etc. for cm. */
export const DEFAULT_PLAN_OPTIONS_IN: PlanOptions = { wrapAllowance: 0.5, tail: 6, waste: 0.1 };

export const DEFAULT_ANALYZE_OPTIONS_IN: AnalyzeOptions = {
  minNailSpacing: 0.75,
  maxNailLoad: 8,
  minEdgeLength: 1.5,
  maxPhotoAngleDeg: 90,
  endClearance: 3,
  photo: { width: 4, height: 6, gap: 2 },
};
