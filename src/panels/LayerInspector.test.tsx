// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Generator } from '@/contracts/generator';
import type { Layer } from '@/contracts/design';
import { LayerInspector } from './LayerInspector';

afterEach(cleanup);

it('only offers default sag when the generator has strands that use it', () => {
  const layer: Layer = {
    id: 'l', name: 'Pattern', generatorId: 'pattern', seed: 1, params: {},
    transform: { x: 36, y: 24, scaleX: 12, scaleY: 8, rotation: 0 },
    groupId: 'g', sag: 0.15, visible: true, locked: false,
  };
  const generator: Generator = {
    id: 'pattern', label: 'Pattern', description: '', schema: [],
    generate: () => ({ nails: [{ x: -1, y: 0 }, { x: 1, y: 0 }], edges: [{ a: 0, b: 1, sag: 0.08 }] }),
  };
  const props = { layer, generator, wall: { width: 72, height: 48, units: 'in' as const }, groups: [], bounds: null, onUpdate: vi.fn(), onReroll: vi.fn() };
  const { rerender } = render(<LayerInspector {...props} />);
  expect(screen.queryByRole('slider', { name: 'Sag' })).toBeNull();
  rerender(<LayerInspector {...props} generator={{ ...generator, generate: () => ({ nails: [], edges: [{ a: 0, b: 1 }] }) }} />);
  expect(screen.getByRole('slider', { name: 'Sag' })).toBeTruthy();
});
