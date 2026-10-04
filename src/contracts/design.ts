/**
 * Core design data model. FROZEN CONTRACT — changes go through the orchestrator.
 *
 * Coordinate system: real wall units (`Wall.units`), origin at the wall area's
 * TOP-LEFT corner, +x to the right, +y DOWN (same as SVG).
 */

export type Units = 'in' | 'cm';

export type NailId = string;
export type EdgeId = string;
export type GroupId = string;
export type LayerId = string;
export type PinId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface WallBackground {
  /** Image as a data URL (user-uploaded photo of their wall). */
  dataUrl: string;
  /** Placement of the image in wall units. */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface Wall {
  width: number;
  height: number;
  units: Units;
  background?: WallBackground;
}

export interface Nail {
  id: NailId;
  x: number;
  y: number;
  /** Set when the nail comes from (or was baked from) a layer. */
  layerId?: LayerId;
}

/** One stretch of twine between two nails. Undirected. */
export interface Edge {
  id: EdgeId;
  a: NailId;
  b: NailId;
  groupId: GroupId;
  /** 0 = taut, 1 = maximum droop. See `lib/geom` sag helpers for the exact curve. */
  sag: number;
  layerId?: LayerId;
}

/** A twine colour/material. Edges in one group are strung with the same twine. */
export interface StrandGroup {
  id: GroupId;
  name: string;
  /** CSS colour. */
  color: string;
  /** Twine diameter in millimetres (render hint only). */
  thickness: number;
}

/**
 * Places generator output (local space −1..1) on the wall:
 *   wall = (x, y) + rotate(rotation°) * (local.x * scaleX, local.y * scaleY)
 * Use `applyTransform` from `lib/geom` — never reimplement.
 */
export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
}

export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

/** A live, parametric pattern. Regenerated on every change until baked. */
export interface Layer {
  id: LayerId;
  name: string;
  generatorId: string;
  params: ParamValues;
  seed: number;
  transform: LayerTransform;
  groupId: GroupId;
  /** Default sag applied to the layer's edges (generator may override per edge). */
  sag: number;
  visible: boolean;
  locked: boolean;
}

/** A photo hung on an edge. */
export interface Pin {
  id: PinId;
  edgeId: EdgeId;
  /** Position along the edge 0..1 measured from edge.a to edge.b. */
  t: number;
  photo?: {
    dataUrl?: string;
    /** width / height of the photo. */
    aspect?: number;
  };
}

export interface DesignMeta {
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** The editable source of truth (what is stored, saved and shared). */
export interface Design {
  version: 1;
  wall: Wall;
  groups: StrandGroup[];
  /** Ordered bottom → top. */
  layers: Layer[];
  /** Baked / hand-placed nails. */
  nails: Nail[];
  /** Baked / hand-placed edges. May reference layer nail ids (see ID RULES). */
  edges: Edge[];
  pins: Pin[];
  /** Nails closer than this (wall units) are merged when resolving. */
  mergeTolerance: number;
  meta: DesignMeta;
}

/**
 * ID RULES (deterministic, so references survive regeneration and baking):
 *  - Layer nail i  → `${layerId}/n${i}`
 *  - Layer edge i  → `${layerId}/e${i}`
 *  - Baking a layer keeps those exact ids (geometry and ids are unchanged).
 *  - Hand-made nails/edges/pins use `newId()` from `lib/id`.
 *  - When nails merge, the surviving id is the one appearing FIRST in resolve
 *    order (baked/hand nails first, then layers bottom → top); references to
 *    the merged-away id are rewritten to the survivor.
 *
 * RESOLVE GUARANTEES for `ResolvedDesign`:
 *  - every edge.a / edge.b exists in `nails`; edge.a !== edge.b
 *  - no two edges in the same group connect the same unordered nail pair
 *  - pins reference existing edges (dangling pins dropped)
 *  - only visible layers contribute
 */
export interface ResolvedDesign {
  wall: Wall;
  groups: StrandGroup[];
  nails: Nail[];
  edges: Edge[];
  pins: Pin[];
}
