// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { DesignActions, Selection } from '@/contracts/actions';
import type { PlaybackState } from '@/contracts/ui';
import { fixtures, triangle, trianglePlan } from '@/contracts/fixtures';
import { Scene } from './Scene';
import { Thumbnail } from './Thumbnail';
import { PhotoSizeProvider } from './PhotoSize';

const NO_SEL: Selection = { nails: [], edges: [], pins: [] };

function mockActions(): DesignActions {
  const fn = () => vi.fn();
  return {
    setWall: fn(),
    loadDesign: fn(),
    newDesign: fn(),
    renameDesign: fn(),
    addGroup: vi.fn(() => 'g'),
    updateGroup: fn(),
    removeGroup: fn(),
    addLayer: vi.fn(() => 'L'),
    updateLayer: fn(),
    removeLayer: fn(),
    moveLayer: fn(),
    duplicateLayer: vi.fn(() => 'L'),
    bakeLayer: fn(),
    applySurprise: vi.fn(() => []),
    addNail: vi.fn(() => 'n-new'),
    moveNails: fn(),
    connect: vi.fn(() => 'e-new'),
    updateEdges: fn(),
    deleteSelection: fn(),
    addPin: vi.fn(() => 'p-new'),
    updatePin: fn(),
    removePin: fn(),
    setPins: fn(),
    setSelection: fn(),
    clearSelection: fn(),
    setActiveGroup: fn(),
    undo: fn(),
    redo: fn(),
    beginGesture: fn(),
    endGesture: fn(),
  };
}

const nailEl = (c: HTMLElement, id: string) => c.querySelector(`[data-nail-id="${id}"]`)!;
const down = (el: Element, init: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerDown(el, { button: 0, buttons: 1, pointerId: 1, clientX: 10, clientY: 10, ...init });
const up = (el: Element) => fireEvent.pointerUp(el, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });

afterEach(cleanup);

describe('Scene rendering', () => {
  it('draws photos at the selected real size and converts provider units', () => {
    const resolved = { ...triangle, pins: [{ id: 'p', edgeId: triangle.edges[0].id, t: 0.5 }] };
    const { container, rerender } = render(
      <PhotoSizeProvider photo={{ width: 4, height: 6, gap: 2 }} units="in">
        <Scene resolved={resolved} selection={NO_SEL} tool="select" activeGroupId="g-jute" />
      </PhotoSizeProvider>,
    );
    const photo = () => container.querySelector('[data-pin-id="p"] rect[fill^="url("]')!;
    expect(photo().getAttribute('width')).toBe('4');
    expect(photo().getAttribute('height')).toBe('6');
    rerender(
      <PhotoSizeProvider photo={{ width: 12.7, height: 17.78, gap: 5.08 }} units="cm">
        <Scene resolved={resolved} selection={NO_SEL} tool="select" activeGroupId="g-jute" />
      </PhotoSizeProvider>,
    );
    expect(Number(photo().getAttribute('width'))).toBeCloseTo(5);
    expect(Number(photo().getAttribute('height'))).toBeCloseTo(7);
  });
  for (const [name, fx] of Object.entries(fixtures)) {
    it(`renders one twine group per edge (${name})`, () => {
      const { container } = render(<Scene resolved={fx} selection={NO_SEL} tool="select" activeGroupId={fx.groups[0].id} />);
      const strands = container.querySelectorAll('[data-twine-edge]');
      expect(strands.length).toBe(fx.edges.length);
      expect([...strands].map((s) => s.getAttribute('data-twine-edge')).sort()).toEqual(fx.edges.map((e) => e.id).sort());
      expect(container.querySelectorAll('[data-nail-id]').length).toBe(fx.nails.length);
      expect(container.querySelectorAll('[data-pin-id]').length).toBe(fx.pins.length);
    });
  }

  it('draws sagging edges with the shared quadratic curve', () => {
    const { container } = render(<Scene resolved={fixtures.spider} selection={NO_SEL} tool="select" activeGroupId="g-jute" />);
    const sagged = container.querySelector('[data-twine-edge="e-oo0"] path')!;
    const taut = container.querySelector('[data-twine-edge="e-ci0"] path')!;
    expect(sagged.getAttribute('d')).toContain('Q');
    expect(taut.getAttribute('d')).toContain('L');
  });

  it('shows nail numbers from nailLabels when asked', () => {
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="select" activeGroupId="g-jute" showNailLabels />);
    // reading order: A (10,10)=1, B (40,10)=2, C (10,40)=3
    expect(nailEl(container, 'A').textContent).toBe('1');
    expect(nailEl(container, 'B').textContent).toBe('2');
    expect(nailEl(container, 'C').textContent).toBe('3');
  });
});

describe('read-only', () => {
  it('attaches no tool handlers without actions', () => {
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="connect" activeGroupId="g-jute" />);
    const root = container.querySelector('[data-scene]')!;
    expect(root.getAttribute('data-readonly')).toBe('true');
    expect(root.hasAttribute('data-tool')).toBe(false);
    // clicking nails does nothing and does not throw; no interaction previews appear
    down(nailEl(container, 'A'));
    up(nailEl(container, 'A'));
    down(nailEl(container, 'B'));
    up(nailEl(container, 'B'));
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(container.querySelector('[data-layer="interaction"]')!.childElementCount).toBe(0);
  });
});

describe('playback', () => {
  const pb = (step: number, progress = 0): PlaybackState => ({ playing: false, step, progress, totalSteps: 3, speed: 4 });

  for (const k of [0, 1, 2, 3]) {
    it(`step=${k} shows ${k} fully drawn steps over ghost twine`, () => {
      const { container } = render(
        <Scene resolved={triangle} selection={NO_SEL} tool="select" activeGroupId="g-jute" plan={trianglePlan} playback={pb(k)} />,
      );
      expect(container.querySelectorAll('[data-playback="done"]').length).toBe(k);
      expect(container.querySelector('[data-layer="twine"]')!.getAttribute('data-ghost')).toBe('true');
      expect(container.querySelector('[data-playback="current"]')).toBeNull();
    });
  }

  it('draws the current step partially with a needle', () => {
    const { container } = render(
      <Scene resolved={triangle} selection={NO_SEL} tool="select" activeGroupId="g-jute" plan={trianglePlan} playback={pb(1, 0.5)} />,
    );
    expect(container.querySelectorAll('[data-playback="done"]').length).toBe(1);
    const cur = container.querySelector('[data-playback="current"]')!;
    expect(cur).not.toBeNull();
    // step 1 is B(40,10) → C(10,40); halfway is (25,25)
    expect(cur.querySelector('path')!.getAttribute('d')).toBe('M40 10L25 25');
  });
});

describe('tools', () => {
  it('ends a started gesture when unmounted during a drag', () => {
    const actions = mockActions();
    const { container, unmount } = render(<Scene resolved={triangle} selection={NO_SEL} tool="select" activeGroupId="g-jute" actions={actions} />);
    down(nailEl(container, 'A'), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(container.querySelector('[data-scene]')!, { pointerId: 1, buttons: 1, clientX: 140, clientY: 100 });
    expect(actions.beginGesture).toHaveBeenCalledTimes(1);
    unmount();
    expect(actions.endGesture).toHaveBeenCalledTimes(1);
  });

  it('clears a pending zoom transform when fitting before the zoom settles', () => {
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="pan" activeGroupId="g-jute" />);
    const root = container.querySelector('[data-scene]')!;
    const svg = container.querySelector('svg')!;
    fireEvent.wheel(root, { deltaY: -100, clientX: 200, clientY: 200 });
    expect(svg.style.transform).toContain('scale');
    fireEvent.click(container.querySelector('button[title^="Fit"]')!);
    expect(svg.style.transform).toBe('');
  });
  it('connect: clicks chain A→B→C and call connect with the active group', () => {
    const actions = mockActions();
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="connect" activeGroupId="g-jute" actions={actions} />);
    for (const id of ['A', 'B', 'C']) {
      down(nailEl(container, id));
      up(nailEl(container, id));
    }
    expect(actions.connect).toHaveBeenCalledTimes(2);
    expect(actions.connect).toHaveBeenNthCalledWith(1, 'A', 'B', 'g-jute');
    expect(actions.connect).toHaveBeenNthCalledWith(2, 'B', 'C', 'g-jute');
  });

  it('connect: Escape ends the chain', () => {
    const actions = mockActions();
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="connect" activeGroupId="g-jute" actions={actions} />);
    down(nailEl(container, 'A'));
    fireEvent.keyDown(container.querySelector('[data-scene]')!, { key: 'Escape' });
    down(nailEl(container, 'B'));
    expect(actions.connect).not.toHaveBeenCalled();
    down(nailEl(container, 'C'));
    expect(actions.connect).toHaveBeenCalledWith('B', 'C', 'g-jute');
  });

  it('select: clicking a nail selects it; shift adds; Delete and Escape call actions', () => {
    const actions = mockActions();
    const { container, rerender } = render(<Scene resolved={triangle} selection={NO_SEL} tool="select" activeGroupId="g-jute" actions={actions} />);
    down(nailEl(container, 'A'));
    up(nailEl(container, 'A'));
    expect(actions.setSelection).toHaveBeenLastCalledWith({ nails: ['A'], edges: [], pins: [] });
    const sel = { nails: ['A'], edges: [], pins: [] };
    rerender(<Scene resolved={triangle} selection={sel} tool="select" activeGroupId="g-jute" actions={actions} />);
    down(nailEl(container, 'B'), { shiftKey: true });
    up(nailEl(container, 'B'));
    expect(actions.setSelection).toHaveBeenLastCalledWith({ nails: ['A', 'B'] });
    const root = container.querySelector('[data-scene]')!;
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(actions.deleteSelection).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(actions.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('select: dragging a nail wraps moveNails in a gesture', () => {
    const actions = mockActions();
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="select" activeGroupId="g-jute" actions={actions} />);
    const root = container.querySelector('[data-scene]')!;
    down(nailEl(container, 'A'), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(root, { pointerId: 1, buttons: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerMove(root, { pointerId: 1, buttons: 1, clientX: 180, clientY: 100 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 180, clientY: 100 });
    expect(actions.beginGesture).toHaveBeenCalledTimes(1);
    expect(actions.moveNails).toHaveBeenCalled();
    const total = (actions.moveNails as ReturnType<typeof vi.fn>).mock.calls.reduce((s, c) => s + c[1].x, 0);
    expect(total).toBeGreaterThan(0);
    expect((actions.moveNails as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(['A']);
    expect(actions.endGesture).toHaveBeenCalledTimes(1);
  });

  it('add-nail: click adds a nail inside the wall', () => {
    const actions = mockActions();
    const { container } = render(<Scene resolved={triangle} selection={NO_SEL} tool="add-nail" activeGroupId="g-jute" actions={actions} />);
    down(container.querySelector('[data-scene]')!, { clientX: 400, clientY: 300 });
    expect(actions.addNail).toHaveBeenCalledTimes(1);
    const p = (actions.addNail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(72);
  });
});

describe('Thumbnail', () => {
  it('renders one twine path per group, no per-edge elements', () => {
    const { container } = render(<Thumbnail resolved={fixtures.combo} width={120} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('80');
    expect(container.querySelectorAll('[data-twine-edge]').length).toBe(0);
    expect(container.querySelectorAll('path').length).toBeLessThan(10);
  });
});
