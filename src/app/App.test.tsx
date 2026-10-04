// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyDesign } from '@/contracts/defaults';
import { createDesignStore } from '@/model';
import { registry } from '@/generators';
import { App } from './App';

const makeStore = () => createDesignStore({ registry, initial: emptyDesign(), storageKey: null });
const stat = (name: string) => document.querySelector(`[data-stat="${name}"]`)?.textContent ?? '';
const surpriseButton = () => document.querySelector('header')!.querySelector('button[aria-label="Surprise me"]')!;

beforeEach(() => {
  localStorage.clear();
  // Most tests are past the first-run wall setup; the onboarding test clears this.
  localStorage.setItem('photo-web:wall-onboarded', '1');
});
afterEach(cleanup);

// Whole-app renders are slow on a cold transform cache; don't flake on the 5 s default.
describe('App', { timeout: 30_000 }, () => {
  it('first run opens wall setup, and Continue leaves a ready editor', () => {
    localStorage.clear();
    render(<App store={makeStore()} />);
    expect(screen.getByText('Set up your wall')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByText('Set up your wall')).toBeNull();
    expect(localStorage.getItem('photo-web:wall-onboarded')).toBe('1');
    expect(screen.getByText('Add your first pattern')).toBeTruthy();
  });

  it('boots with an empty design and goes straight to the editor', () => {
    render(<App store={makeStore()} />);
    expect(screen.queryByText('Set up your wall')).toBeNull();
    expect(screen.getByText('Add your first pattern')).toBeTruthy();
    expect(stat('nails')).toBe('0 nails');
    expect(screen.getByText(/72" × 48" wall/)).toBeTruthy();
  });

  it('Surprise me adds layers and updates the stats chip', async () => {
    const store = makeStore();
    render(<App store={store} />);
    await act(async () => fireEvent.click(surpriseButton()));
    expect(store.getState().design.layers.length).toBeGreaterThan(0);
    expect(screen.queryByText('Add your first pattern')).toBeNull();
    expect(stat('nails')).not.toBe('0 nails');
    expect(stat('runs')).not.toMatch(/^0 /);
    // the surprise was snapshotted into the variations strip
    expect(screen.getAllByRole('listitem', { name: /Restore/ })).toHaveLength(1);
  });

  it('undo works after Surprise', async () => {
    const store = makeStore();
    render(<App store={store} />);
    await act(async () => fireEvent.click(surpriseButton()));
    expect(store.getState().design.layers.length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Undo/ })));
    expect(store.getState().design.layers).toHaveLength(0);
    expect(screen.getByText('Add your first pattern')).toBeTruthy();
    // and the keyboard shortcut redoes it
    await act(async () => fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true }));
    expect(store.getState().design.layers.length).toBeGreaterThan(0);
  });

  it('adds a pattern at a preset size from the gallery in two clicks', async () => {
    const store = makeStore();
    const { container } = render(<App store={store} />);
    await act(async () => fireEvent.click(container.querySelector('[data-generator="frame"]')!));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '36 × 24″' })));
    const [layer] = store.getState().design.layers;
    expect(layer.transform.scaleX * 2).toBe(36);
    expect(layer.transform.scaleY * 2).toBe(24);
  });

  it('Build mode opens on the Drawing tab', async () => {
    const store = makeStore();
    render(<App store={store} />);
    await act(async () => fireEvent.click(surpriseButton()));
    await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'Build' })));
    const tabs = screen.getAllByRole('tab').filter((t) => t.closest('[aria-label="Build guides"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Drawing', 'Cut & shop', 'Nail positions', 'Paper template (1:1)', 'Step-by-step (optional)']);
    expect(screen.getByRole('tab', { name: 'Drawing' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('plan-sheet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download drawing PDF/ })).toBeTruthy();
  });

  it('Refine mode switches tools with keyboard shortcuts', async () => {
    render(<App store={makeStore()} />);
    await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'Refine' })));
    await act(async () => fireEvent.keyDown(document.body, { key: 'n' }));
    expect(screen.getByRole('button', { name: 'Add nail (N)' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => fireEvent.keyDown(document.body, { key: 'c' }));
    expect(screen.getByRole('button', { name: 'Connect (C)' }).getAttribute('aria-pressed')).toBe('true');
  });
});
