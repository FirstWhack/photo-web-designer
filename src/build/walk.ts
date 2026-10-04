import type { NailId, ResolvedDesign, StrandGroup, Units } from '@/contracts/design';
import type { BuildPlan, Run, Step, WrapAction } from '@/contracts/plan';
import { formatTwine } from '@/lib/units';

/** One screen of the walkthrough. Steps are flattened across runs; `global` counts steps before this one. */
export type Screen =
  | { kind: 'start'; run: number; global: number }
  | { kind: 'step'; run: number; step: number; global: number }
  | { kind: 'complete'; run: number; global: number }
  | { kind: 'done'; global: number };

export function buildScreens(plan: BuildPlan): Screen[] {
  const out: Screen[] = [];
  let global = 0;
  plan.runs.forEach((run, r) => {
    out.push({ kind: 'start', run: r, global });
    run.steps.forEach((_, s) => out.push({ kind: 'step', run: r, step: s, global: global + s }));
    global += run.steps.length;
    if (r < plan.runs.length - 1) out.push({ kind: 'complete', run: r, global });
  });
  if (plan.runs.length) out.push({ kind: 'done', global });
  return out;
}

export const totalSteps = (plan: BuildPlan) => plan.runs.reduce((s, r) => s + r.steps.length, 0);

export const WRAP_WORDS: Record<WrapAction, string> = {
  cw: 'wrap clockwise',
  ccw: 'wrap counter-clockwise',
  pass: 'run straight past',
  'tie-off': 'tie off at',
};

export function runStartText(run: Run, group: StrandGroup | undefined, labels: Record<NailId, string>, units: Units): string {
  return `Cut ${formatTwine(run.cutLength, units)} of ${group?.name ?? 'twine'}. Tie on at nail #${labels[run.nails[0]]}.`;
}

export function stepText(step: Step, labels: Record<NailId, string>): string {
  const from = `#${labels[step.from]}`;
  const to = `#${labels[step.to]}`;
  switch (step.wrap) {
    case 'cw':
    case 'ccw':
      return `${from} → ${to}, ${WRAP_WORDS[step.wrap]}`;
    case 'pass':
      return `${from} → ${to}, run straight past ${to}`;
    case 'tie-off':
      return `${from} → ${to}, tie off at ${to}`;
  }
}

/** Extra plain-language help for the wrap. */
export const WRAP_HINT: Record<WrapAction, string> = {
  cw: 'Take the twine once around the nail, going clockwise as you face the wall, then carry on.',
  ccw: 'Take the twine once around the nail, going counter-clockwise as you face the wall, then carry on.',
  pass: 'Hook the twine on the nail without wrapping and keep going in the same direction.',
  'tie-off': 'Pull it snug, wrap the nail twice and tie a double knot. Trim the tail.',
};

/** Stable signature so stored progress is discarded when the plan changes. */
export function planSignature(plan: BuildPlan): string {
  return JSON.stringify(plan.runs);
}

/** Nail labels and physical units are part of the instructions, too. */
export function walkthroughSignature(plan: BuildPlan, resolved: ResolvedDesign): string {
  return JSON.stringify([plan.runs, resolved.wall.units, resolved.wall.width, resolved.wall.height, resolved.nails, resolved.groups]);
}
