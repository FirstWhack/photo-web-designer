/**
 * Pattern generator contract. FROZEN CONTRACT — changes go through the orchestrator.
 */
import type { Layer, LayerTransform, ParamValues, Wall } from './design';

interface ParamBase {
  key: string;
  label: string;
  /** Optional one-line help text shown in the UI. */
  hint?: string;
}

export type ParamDef =
  | (ParamBase & { kind: 'number'; min: number; max: number; step: number; default: number })
  | (ParamBase & { kind: 'int'; min: number; max: number; step?: number; default: number })
  | (ParamBase & { kind: 'select'; options: { value: string; label: string }[]; default: string })
  | (ParamBase & { kind: 'bool'; default: boolean });

/** Ordered list; the UI renders controls in this order. */
export type ParamSchema = ParamDef[];

export interface GeneratorOutput {
  /** Local space: roughly −1..1 on both axes (the layer transform scales it). */
  nails: { x: number; y: number }[];
  /** Indices into `nails`. Optional per-edge sag overrides `Layer.sag`. */
  edges: { a: number; b: number; sag?: number }[];
}

export interface Generator {
  id: string;
  label: string;
  description: string;
  schema: ParamSchema;
  /** Suggested transform relative to a wall (e.g. centered, 40% of the short side). */
  suggestTransform?(wall: Wall): LayerTransform;
  /**
   * PURE and DETERMINISTIC: same (params, seed) → identical output.
   * Unknown/missing params fall back to schema defaults.
   * Must keep output ≤ 2000 edges for any params within schema bounds.
   */
  generate(params: ParamValues, seed: number): GeneratorOutput;
}

/** What "Surprise me" produces: one or more layers to add, plus a palette. */
export interface SurpriseResult {
  layers: Pick<Layer, 'name' | 'generatorId' | 'params' | 'seed' | 'transform' | 'sag'>[];
  /** One CSS colour per layer (same order); the model creates groups for them. */
  palette: string[];
}

export interface GeneratorRegistry {
  list(): Generator[];
  get(id: string): Generator | undefined;
  /** Default params for a generator, derived from its schema. */
  defaults(id: string): ParamValues;
  /** Deterministic random composition for a seed. */
  surprise(seed: number, wall: Wall): SurpriseResult;
}
