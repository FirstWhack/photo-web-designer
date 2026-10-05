import { describe, expect, it } from 'vitest';
import type { CoordRow } from './coords';
import { buildItems, checkMeasurement, formatLength, markOrder, parseLength } from './layout';

const r = (label: string, x: number, y: number): CoordRow => ({ id: `n${label}`, label, x, y });
const grid = [r('1', 10, 10), r('2', 30, 10.2), r('3', 20, 10.1), r('4', 10, 20), r('5', 30, 20), r('6', 20, 20)];

describe('markOrder', () => {
  it('snakes along rows', () => {
    expect(markOrder(grid, 'rows', 0.5).map((n) => n.label)).toEqual(['1', '3', '2', '5', '6', '4']);
  });
  it('snakes along columns', () => {
    expect(markOrder(grid, 'columns', 0.5).map((n) => n.label)).toEqual(['1', '4', '6', '3', '2', '5']);
  });
  it('keeps number order', () => {
    expect(markOrder(grid, 'number', 0.5).map((n) => n.label)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('buildItems', () => {
  it('adds a check every N nails and at the end, against the farthest marked nail', () => {
    const order = [r('1', 0, 0), r('2', 40, 0), r('3', 3, 4), r('4', 30, 0)];
    const items = buildItems(order, 3);
    expect(items.map((i) => i.kind)).toEqual(['nail', 'nail', 'nail', 'check', 'nail', 'check']);
    const first = items[3];
    expect(first.kind === 'check' && first.a.label).toBe('2');
    expect(first.kind === 'check' && first.distance).toBeCloseTo(Math.hypot(37, 4));
  });
  it('has no check for a single nail', () => {
    expect(buildItems([r('1', 0, 0)]).map((i) => i.kind)).toEqual(['nail']);
  });
});

describe('lengths', () => {
  it('formats to the nearest 1/16 inch and 1 mm', () => {
    expect(formatLength(17.25, 'in')).toBe('17 1/4"');
    expect(formatLength(2, 'in')).toBe('2"');
    expect(formatLength(0.5, 'in')).toBe('1/2"');
    expect(formatLength(5.1875, 'in')).toBe('5 3/16"');
    expect(formatLength(43.84, 'cm')).toBe('43.8 cm');
  });
  it('parses decimals and fractions', () => {
    expect(parseLength('41.5')).toBe(41.5);
    expect(parseLength('41 3/8"')).toBeCloseTo(41.375);
    expect(parseLength('3/8')).toBeCloseTo(0.375);
    expect(parseLength('12 cm')).toBe(12);
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
  });
  it('checks against a tolerance', () => {
    expect(checkMeasurement(41.4, 41.375, 0.125).ok).toBe(true);
    const off = checkMeasurement(41.75, 41.375, 0.125);
    expect(off.ok).toBe(false);
    expect(off.diff).toBeCloseTo(0.375);
  });
});
