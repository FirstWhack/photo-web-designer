// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { triangle } from '@/contracts/fixtures';
import { LayoutGuide } from './index';

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));
const readout = () => screen.getByTestId('readout').textContent;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('LayoutGuide', () => {
  it('walks nail by nail from the datum, then offers a recommended check', () => {
    render(<LayoutGuide resolved={triangle} origin="top-left" />);
    expect(screen.getByText(/Measure everything from the top-left corner/)).toBeTruthy();
    click(/start marking/i);
    expect(readout()).toContain('10"');
    expect(screen.getByText(/Nail #1 · 1 of 3/)).toBeTruthy();
    click(/marked/i);
    expect(readout()).toContain('40"');
    click(/marked/i);
    expect(screen.getByText(/Nail #3 · 3 of 3/)).toBeTruthy();
    click(/marked/i);
    // 30 × 30 diagonal between #2 and #3
    expect(screen.getByText(/Measure from nail #2 to nail #3/)).toBeTruthy();
    expect(screen.getByText(/42 7\/16"/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Measured distance'), { target: { value: '43' } });
    expect(screen.getByRole('status').textContent).toMatch(/Off by/);
    fireEvent.change(screen.getByLabelText('Measured distance'), { target: { value: '42 7/16' } });
    expect(screen.getByRole('status').textContent).toMatch(/Matches/);
    click(/continue/i);
    expect(screen.getByTestId('summary').textContent).toBe('3 of 3 nails marked');
  });

  it('measures from the chosen datum corner', () => {
    render(<LayoutGuide resolved={triangle} origin="bottom-right" />);
    click(/start marking/i);
    // bottom-right datum: nail 3 (10, 40) is 62" from the right edge, 8" up from the bottom; rows start nearest the bottom
    expect(readout()).toContain('8"');
    expect(screen.getByText(/up from the bottom edge/)).toBeTruthy();
  });

  it('lets you skip a nail and the check, and remembers where you were', () => {
    const { unmount } = render(<LayoutGuide resolved={triangle} origin="top-left" storageKey="k" />);
    click(/start marking/i);
    click(/skip this nail/i);
    unmount();
    render(<LayoutGuide resolved={triangle} origin="top-left" storageKey="k" />);
    expect(screen.getByText(/Nail #2 · 2 of 3/)).toBeTruthy();
    click(/marked/i);
    click(/marked/i);
    click(/skip check/i);
    expect(screen.getByTestId('summary').textContent).toBe('2 of 3 nails marked');
    expect(screen.getByText(/Skipped: #1/)).toBeTruthy();
  });

  it('warns when the measured wall does not match the setup', () => {
    render(<LayoutGuide resolved={triangle} origin="top-left" />);
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '70' } });
    expect(screen.getByRole('note').textContent).toMatch(/width is 70"/);
  });
});
