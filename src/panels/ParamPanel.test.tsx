// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ParamSchema } from '@/contracts/generator';
import { ParamPanel } from './ParamPanel';
import { visibleParams } from './paramVisibility';

afterEach(cleanup);

const schema: ParamSchema = [
  { key: 'amount', label: 'Amount', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'count', label: 'Count', kind: 'int', min: 3, max: 24, default: 8 },
  {
    key: 'style',
    label: 'Style',
    kind: 'select',
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
    default: 'a',
  },
  {
    key: 'shape',
    label: 'Shape',
    kind: 'select',
    options: Array.from({ length: 5 }, (_, i) => ({ value: `s${i}`, label: `Shape ${i}` })),
    default: 's0',
  },
  {
    key: 'many',
    label: 'Many',
    kind: 'select',
    options: Array.from({ length: 14 }, (_, i) => ({ value: `m${i}`, label: `M ${i}` })),
    default: 'm0',
  },
  { key: 'hub', label: 'Hub', kind: 'bool', default: true },
];

describe('ParamPanel', () => {
  it('renders one control per schema field, in order', () => {
    const { container } = render(<ParamPanel schema={schema} values={{}} onChange={() => {}} />);
    const rows = [...container.querySelectorAll('[data-param]')];
    expect(rows.map((r) => r.getAttribute('data-param'))).toEqual(schema.map((d) => d.key));
    // number + int: slider and number box
    expect(screen.getByRole('slider', { name: 'Amount' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Count value' })).toBeTruthy();
    // 2 options: segmented; 5: chips; 14: a select
    expect(screen.getByRole('group', { name: 'Style' }).querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelector('[data-param="shape"]')!.querySelectorAll('button')).toHaveLength(5);
    expect(screen.getByRole('combobox', { name: 'Many' })).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('emits typed values', () => {
    const onChange = vi.fn();
    render(<ParamPanel schema={schema} values={{ count: 8, hub: true }} onChange={onChange} />);

    fireEvent.change(screen.getByRole('slider', { name: 'Amount' }), { target: { value: '0.75' } });
    expect(onChange).toHaveBeenLastCalledWith('amount', 0.75);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Count value' }), { target: { value: '12' } });
    expect(onChange).toHaveBeenLastCalledWith('count', 12);
    expect(typeof onChange.mock.lastCall![1]).toBe('number');

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenLastCalledWith('style', 'b');

    fireEvent.click(screen.getByRole('button', { name: 'Shape 3' }));
    expect(onChange).toHaveBeenLastCalledWith('shape', 's3');

    fireEvent.change(screen.getByRole('combobox', { name: 'Many' }), { target: { value: 'm9' } });
    expect(onChange).toHaveBeenLastCalledWith('many', 'm9');

    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith('hub', false);
  });

  it('rounds int values and ignores out-of-range typing', () => {
    const onChange = vi.fn();
    render(<ParamPanel schema={schema} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Count' }), { target: { value: '9' } });
    expect(onChange).toHaveBeenLastCalledWith('count', 9);
    onChange.mockClear();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Count value' }), { target: { value: '99' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('wraps slider drags in one gesture', () => {
    const start = vi.fn();
    const end = vi.fn();
    render(<ParamPanel schema={schema} values={{}} onChange={() => {}} onGestureStart={start} onGestureEnd={end} />);
    const slider = screen.getByRole('slider', { name: 'Amount' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0.6' } });
    fireEvent.change(slider, { target: { value: '0.7' } });
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('visibleParams', () => {
  const frame: ParamSchema = [
    { key: 'pattern', label: 'Pattern', kind: 'select', options: [{ value: 'rows', label: 'Rows' }], default: 'rows' },
    { key: 'nailsX', label: 'Nails', kind: 'int', min: 2, max: 9, default: 4 },
    { key: 'tiers', label: 'Tiers', kind: 'int', min: 1, max: 5, default: 2 },
    { key: 'inset', label: 'Inset', kind: 'bool', default: false },
    { key: 'insetSize', label: 'Inset size', kind: 'number', min: 0, max: 1, step: 0.1, default: 0.5 },
  ];
  const keys = (v: Record<string, string | boolean>) => visibleParams('frame', frame, v).map((d) => d.key);

  it('hides params that do not apply to the chosen frame pattern', () => {
    expect(keys({})).toEqual(['pattern', 'nailsX']);
    expect(keys({ pattern: 'zigzag' })).toEqual(['pattern', 'nailsX', 'tiers']);
    expect(keys({ pattern: 'border' })).toEqual(['pattern', 'nailsX', 'inset']);
    expect(keys({ pattern: 'border', inset: true })).toEqual(['pattern', 'nailsX', 'inset', 'insetSize']);
    expect(keys({ pattern: 'nested' })).toEqual(['pattern', 'nailsX', 'insetSize']);
  });

  it('shows everything for generators without rules', () => {
    expect(visibleParams('spider-web', frame, {})).toBe(frame);
  });
});
