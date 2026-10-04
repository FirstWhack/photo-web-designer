import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildPlan } from '@/contracts/plan';
import type { PlaybackControls, PlaybackState } from '@/contracts/ui';

export const DEFAULT_PLAYBACK_SPEED = 4;
/** Frames longer than this (tab in background, debugger) don't jump the animation. */
const MAX_FRAME_SEC = 0.25;

const countSteps = (plan: BuildPlan | undefined) => (plan ? plan.runs.reduce((n, r) => n + r.steps.length, 0) : 0);

interface Clock {
  plan: BuildPlan | undefined;
  playing: boolean;
  /** Continuous position in steps: step = floor(pos), progress = pos - step. */
  pos: number;
  speed: number;
}

/**
 * Animates through every step of `plan` in run order with a requestAnimationFrame clock.
 * Speed is in steps per second (default 4). Stops at the end; a new plan resets it.
 */
export function usePlayback(plan: BuildPlan | undefined): PlaybackControls {
  const totalSteps = useMemo(() => countSteps(plan), [plan]);
  const [clock, setClock] = useState<Clock>({ plan, playing: false, pos: 0, speed: DEFAULT_PLAYBACK_SPEED });

  // Plan identity changed → reset (adjusting state during render, no extra effect pass).
  let current = clock;
  if (clock.plan !== plan) {
    current = { plan, playing: false, pos: 0, speed: clock.speed };
    setClock(current);
  }

  const totalRef = useRef(totalSteps);
  totalRef.current = totalSteps;

  useEffect(() => {
    if (!current.playing) return;
    let raf = 0;
    let last: number | null = null;
    const frame = (now: number) => {
      const dt = last === null ? 0 : Math.min(MAX_FRAME_SEC, Math.max(0, (now - last) / 1000));
      last = now;
      setClock((c) => {
        if (!c.playing) return c;
        const total = totalRef.current;
        const pos = c.pos + dt * c.speed;
        if (pos >= total) return { ...c, pos: total, playing: false };
        return pos === c.pos ? c : { ...c, pos };
      });
      // Keeps ticking until `playing` flips false, which cancels the frame in cleanup.
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [current.playing]);

  const play = useCallback(
    () =>
      setClock((c) => {
        const total = totalRef.current;
        if (total === 0) return c;
        return { ...c, playing: true, pos: c.pos >= total ? 0 : c.pos };
      }),
    [],
  );
  const pause = useCallback(() => setClock((c) => (c.playing ? { ...c, playing: false } : c)), []);
  const toggle = useCallback(() => {
    setClock((c) => {
      const total = totalRef.current;
      if (c.playing) return { ...c, playing: false };
      if (total === 0) return c;
      return { ...c, playing: true, pos: c.pos >= total ? 0 : c.pos };
    });
  }, []);
  const seek = useCallback(
    (step: number) =>
      setClock((c) => ({ ...c, pos: Math.max(0, Math.min(totalRef.current, Math.floor(Number.isFinite(step) ? step : 0))) })),
    [],
  );
  const setSpeed = useCallback(
    (sps: number) => setClock((c) => ({ ...c, speed: Number.isFinite(sps) && sps > 0 ? sps : DEFAULT_PLAYBACK_SPEED })),
    [],
  );
  const reset = useCallback(() => setClock((c) => ({ ...c, playing: false, pos: 0 })), []);

  const step = Math.min(totalSteps, Math.floor(current.pos + 1e-9));
  const state: PlaybackState = useMemo(
    () => ({
      playing: current.playing,
      step,
      progress: step >= totalSteps ? 0 : Math.max(0, current.pos - step),
      totalSteps,
      speed: current.speed,
    }),
    [current.playing, current.pos, current.speed, step, totalSteps],
  );

  return useMemo(() => ({ state, play, pause, toggle, seek, setSpeed, reset }), [state, play, pause, toggle, seek, setSpeed, reset]);
}
