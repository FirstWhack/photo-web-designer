import type { ParamValues } from '@/contracts/design';
import type { ParamSchema } from '@/contracts/generator';

/**
 * Some generator params only matter for certain settings. Rules here hide the
 * irrelevant ones; generators without rules show every param.
 * key → predicate over the current values (missing value = schema default).
 */
type Rule = (v: (key: string) => unknown) => boolean;

const RULES: Record<string, Record<string, Rule>> = {
  frame: {
    tiers: (v) => v('pattern') === 'zigzag',
    cornerSet: (v) => v('pattern') === 'corners',
    anchor: (v) => v('pattern') === 'sunburst',
    multiplier: (v) => v('pattern') === 'string-art',
    inset: (v) => v('pattern') === 'border' || v('pattern') === 'corners',
    insetSize: (v) =>
      v('pattern') === 'nested' || ((v('pattern') === 'border' || v('pattern') === 'corners') && v('inset') === true),
  },
};

/**
 * Whether a layer's seed changes its output. Most generators are exact and ignore it; the rest
 * only use it for some settings (spider web wobble, lattice broken strands, organic always).
 */
export function usesSeed(generatorId: string, values: ParamValues, schema: ParamSchema = []): boolean {
  const get = (key: string) => (key in values ? values[key] : schema.find((d) => d.key === key)?.default);
  switch (generatorId) {
    case 'organic':
      return true;
    case 'spider-web':
      return Number(get('irregularity') ?? 0) > 0;
    case 'lattice':
      return Number(get('removal') ?? 0) > 0;
    default:
      return false;
  }
}

export function visibleParams(generatorId: string, schema: ParamSchema, values: ParamValues): ParamSchema {
  const rules = RULES[generatorId];
  if (!rules) return schema;
  const get = (key: string) => {
    if (key in values) return values[key];
    return schema.find((d) => d.key === key)?.default;
  };
  return schema.filter((d) => !rules[d.key] || rules[d.key](get));
}
