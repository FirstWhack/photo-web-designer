// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { emptyDesign } from '@/contracts/defaults';
import { useVariations } from './useVariations';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('keeps wall, pin, tolerance and name changes while suppressing identical snapshots', () => {
  const { result } = renderHook(() => useVariations());
  let design = emptyDesign();
  design.nails = [{ id: 'a', x: 1, y: 1 }];
  act(() => result.current.push(design));
  design = { ...design, wall: { ...design.wall, width: 96 } };
  act(() => result.current.push(design));
  expect(result.current.items[0].design.wall.width).toBe(96);
  design = { ...design, pins: [{ id: 'p', edgeId: 'e', t: 0.5 }] };
  act(() => result.current.push(design));
  design = { ...design, mergeTolerance: 1 };
  act(() => result.current.push(design));
  design = { ...design, meta: { ...design.meta, name: 'New name' } };
  act(() => result.current.push(design));
  act(() => result.current.push({ ...design, meta: { ...design.meta, updatedAt: 999 } }));
  expect(result.current.items).toHaveLength(5);
  expect(result.current.items[0].design.pins).toHaveLength(1);
});
