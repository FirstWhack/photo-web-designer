import type { BuildPlan } from '@/contracts/plan';
import type { PlaybackControls } from '@/contracts/ui';

/** Animates through every step of `plan` in run order. Wave-0 stub: static, does nothing. */
export function usePlayback(plan: BuildPlan | undefined): PlaybackControls {
  const totalSteps = plan ? plan.runs.reduce((n, r) => n + r.steps.length, 0) : 0;
  const noop = () => {};
  return {
    state: { playing: false, step: totalSteps, progress: 0, totalSteps, speed: 4 },
    play: noop,
    pause: noop,
    toggle: noop,
    seek: noop,
    setSpeed: noop,
    reset: noop,
  };
}
