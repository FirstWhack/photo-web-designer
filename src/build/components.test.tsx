// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JUTE, plus, plusPlan, triangle, trianglePlan, triangleReport } from '@/contracts/fixtures';
import { formatTwine } from '@/lib/units';
import { CoordTable, CutList, Walkthrough } from './index';

const instr = () => screen.getByTestId('instruction').textContent;
const next = () => fireEvent.click(screen.getByRole('button', { name: /next/i }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Walkthrough', () => {
  it('steps through the triangle plan with the right words and wraps', () => {
    const { container } = render(<Walkthrough resolved={triangle} plan={trianglePlan} />);
    const cut = formatTwine(trianglePlan.runs[0].cutLength, 'in');
    expect(cut).toBe('10 ft 7 in');
    expect(instr()).toBe(`Cut ${cut} of Natural jute. Tie on at nail #1.`);
    expect(screen.getByTestId('run-header').textContent).toBe('Run 1 of 1');
    next();
    expect(instr()).toBe('#1 → #2, wrap clockwise');
    expect(container.querySelector('[data-wrap]')?.getAttribute('data-wrap')).toBe('cw');
    expect(container.querySelector('[data-state="current"]')).not.toBeNull();
    next();
    expect(instr()).toBe('#2 → #3, wrap clockwise');
    expect(container.querySelectorAll('[data-state="done"]')).toHaveLength(1);
    next();
    expect(instr()).toBe('#3 → #1, tie off at #1');
    next();
    expect(instr()).toMatch(/All done/);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');
    expect(screen.getByRole('button', { name: /next/i })).toHaveProperty('disabled', true);
  });

  it('supports keyboard navigation', () => {
    render(<Walkthrough resolved={triangle} plan={trianglePlan} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(instr()).toBe('#1 → #2, wrap clockwise');
    fireEvent.keyDown(window, { key: ' ' });
    expect(instr()).toBe('#2 → #3, wrap clockwise');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(instr()).toBe('#3 → #1, tie off at #1');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(instr()).toBe('#2 → #3, wrap clockwise');
  });

  it('shows pass wording and a run-complete interstitial', () => {
    render(<Walkthrough resolved={plus} plan={plusPlan} />);
    next();
    expect(instr()).toBe('#1 → #3, run straight past #3');
    next();
    expect(instr()).toBe('#3 → #5, tie off at #5');
    next();
    expect(instr()).toBe('Run 1 complete');
    next();
    expect(screen.getByTestId('run-header').textContent).toBe('Run 2 of 2');
    expect(instr()).toMatch(/Tie on at nail #2\.$/);
  });

  it('flags hairpins', () => {
    const plan = structuredClone(trianglePlan);
    plan.runs[0].steps[0].hairpin = true;
    render(<Walkthrough resolved={triangle} plan={plan} />);
    next();
    expect(screen.getByRole('note').textContent).toMatch(/Hairpin/);
  });

  it('remembers progress in localStorage and can reset', () => {
    const first = render(<Walkthrough resolved={triangle} plan={trianglePlan} storageKey="wt" />);
    next();
    next();
    expect(instr()).toBe('#2 → #3, wrap clockwise');
    first.unmount();
    expect(localStorage.getItem('wt')).toContain('"index":2');
    render(<Walkthrough resolved={triangle} plan={trianglePlan} storageKey="wt" />);
    expect(instr()).toBe('#2 → #3, wrap clockwise');
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(instr()).toMatch(/^Cut /);
  });

  it('ignores stored progress from a different plan', () => {
    localStorage.setItem('wt', JSON.stringify({ sig: 'other', index: 3 }));
    render(<Walkthrough resolved={triangle} plan={trianglePlan} storageKey="wt" />);
    expect(instr()).toMatch(/^Cut /);
  });

  it('resets progress when measurements change without changing edge IDs', () => {
    const { rerender } = render(<Walkthrough resolved={triangle} plan={trianglePlan} storageKey="wt" />);
    next();
    next();
    const changed = structuredClone(trianglePlan);
    changed.runs[0].cutLength += 20;
    changed.runs[0].steps[0].length += 20;
    rerender(<Walkthrough resolved={triangle} plan={changed} storageKey="wt" />);
    expect(instr()).toMatch(/^Cut /);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('CutList', () => {
  it('totals equal plan.totals', () => {
    render(<CutList resolved={triangle} plan={trianglePlan} report={triangleReport} />);
    expect(screen.getByTestId('total-cut').textContent).toBe(formatTwine(trianglePlan.totals.cutLength, 'in'));
    expect(screen.getByTestId(`group-total-${JUTE.id}`).querySelector('[data-testid="group-cut"]')?.textContent).toBe(
      formatTwine(trianglePlan.totals.cutLengthByGroup[JUTE.id], 'in'),
    );
    expect(screen.getByTestId('nail-count').textContent).toBe('5 nails');
    expect(screen.getByTestId('pin-count').textContent).toBe('4 mini clothespins');
    expect(screen.getByText(/11 ft \(3\.7 yd\)/)).toBeTruthy();
  });
  it('totals for a two-run plan; pins fall back to placed pins', () => {
    render(<CutList resolved={plus} plan={plusPlan} />);
    expect(screen.getByTestId('total-cut').textContent).toBe(formatTwine(plusPlan.totals.cutLength, 'in'));
    expect(screen.getByTestId('pin-count').textContent).toBe('0 mini clothespins');
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2 + 1 + 1);
  });
});

describe('CoordTable', () => {
  it('lists nails from the chosen corner', () => {
    render(<CoordTable resolved={triangle} origin="top-right" />);
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual(['162"10"', '232"10"', '362"40"']);
  });
});
