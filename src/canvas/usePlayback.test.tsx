// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BuildPlan } from '@/contracts/plan';
import { plusPlan, trianglePlan } from '@/contracts/fixtures';
import { usePlayback } from './usePlayback';

// Manual requestAnimationFrame clock.
let queue: Map<number, FrameRequestCallback>;
let nextId: number;
let now: number;

function frame(ms: number) {
  now += ms;
  const cbs = [...queue.values()];
  queue.clear();
  act(() => {
    for (const cb of cbs) cb(now);
  });
}

beforeEach(() => {
  queue = new Map();
  nextId = 1;
  now = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
});

afterEach(() => vi.unstubAllGlobals());

describe('usePlayback', () => {
  it('starts paused at step 0 with default speed 4', () => {
    const { result } = renderHook(() => usePlayback(trianglePlan));
    expect(result.current.state).toEqual({ playing: false, step: 0, progress: 0, totalSteps: 3, speed: 4 });
  });

  it('advances with the rAF clock and stops at the end', () => {
    const { result } = renderHook(() => usePlayback(trianglePlan));
    act(() => result.current.play());
    expect(result.current.state.playing).toBe(true);
    frame(0); // first frame establishes the time base
    frame(125); // 0.125 s * 4 steps/s = 0.5 step
    expect(result.current.state.step).toBe(0);
    expect(result.current.state.progress).toBeCloseTo(0.5);
    frame(125);
    expect(result.current.state.step).toBe(1);
    expect(result.current.state.progress).toBeCloseTo(0);
    for (let i = 0; i < 10; i++) frame(100);
    expect(result.current.state.step).toBe(3);
    expect(result.current.state.progress).toBe(0);
    expect(result.current.state.playing).toBe(false);
    // stopped: no more frames scheduled
    expect(queue.size).toBe(0);
  });

  it('speed, seek, pause and reset', () => {
    const { result } = renderHook(() => usePlayback(trianglePlan));
    act(() => result.current.setSpeed(8));
    act(() => result.current.play());
    frame(0);
    frame(125); // 1 step at 8/s
    expect(result.current.state.step).toBe(1);
    act(() => result.current.pause());
    frame(500);
    expect(result.current.state.step).toBe(1);
    act(() => result.current.seek(2));
    expect(result.current.state).toMatchObject({ step: 2, progress: 0 });
    act(() => result.current.seek(99));
    expect(result.current.state.step).toBe(3);
    act(() => result.current.reset());
    expect(result.current.state).toMatchObject({ step: 0, playing: false, speed: 8 });
  });

  it('play at the end restarts from 0', () => {
    const { result } = renderHook(() => usePlayback(trianglePlan));
    act(() => result.current.seek(3));
    act(() => result.current.toggle());
    expect(result.current.state).toMatchObject({ playing: true, step: 0 });
  });

  it('a new plan resets the clock', () => {
    const { result, rerender } = renderHook(({ plan }: { plan: BuildPlan }) => usePlayback(plan), {
      initialProps: { plan: trianglePlan },
    });
    act(() => result.current.seek(2));
    act(() => result.current.play());
    rerender({ plan: plusPlan });
    expect(result.current.state).toMatchObject({ step: 0, playing: false, totalSteps: 4 });
  });

  it('cancels its frame on unmount', () => {
    const { result, unmount } = renderHook(() => usePlayback(trianglePlan));
    act(() => result.current.play());
    expect(queue.size).toBe(1);
    unmount();
    expect(queue.size).toBe(0);
  });

  it('handles no plan', () => {
    const { result } = renderHook(() => usePlayback(undefined));
    act(() => result.current.play());
    expect(result.current.state).toMatchObject({ playing: false, totalSteps: 0, step: 0 });
  });
});
