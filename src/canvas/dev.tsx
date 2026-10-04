import { useMemo, useRef, useState } from 'react';
import type { ToolId } from '@/contracts/actions';
import type { ResolvedDesign } from '@/contracts/design';
import type { BuildPlan } from '@/contracts/plan';
import type { Overlay, SnapOptions } from '@/contracts/ui';
import { fixtures, plus, plusPlan, triangle, trianglePlan } from '@/contracts/fixtures';
import { Scene } from './Scene';
import { Thumbnail } from './Thumbnail';
import { usePlayback } from './usePlayback';
import { EMPTY_SELECTION, createMockActions, greedyPlan, mockReport, stressFixture, type MockState } from './devData';
import s from './dev.module.css';

const ALL: Record<string, () => ResolvedDesign> = {
  ...Object.fromEntries(Object.entries(fixtures).map(([k, v]) => [k, () => structuredClone(v)])),
  'stress (2000 edges)': stressFixture,
};
const TOOLS: ToolId[] = ['select', 'add-nail', 'connect', 'pin', 'pan'];
const OVERLAYS: Overlay[] = ['none', 'issues', 'photos', 'load'];

/** Soft generated "photos" (SVG data URLs) so the polaroid image path can be checked. */
const PHOTO_HUES = [24, 200, 140, 330, 45];
const samplePhoto = (i: number) => {
  const h = PHOTO_HUES[i % PHOTO_HUES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 60% 78%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 45% 52%)"/></linearGradient></defs><rect width="40" height="50" fill="url(#g)"/><circle cx="${12 + (i % 3) * 8}" cy="15" r="6" fill="hsl(${h} 90% 92%)"/><path d="M0 50V34l12-9 9 7 10-11 9 8v21z" fill="hsl(${(h + 180) % 360} 25% 30%)" opacity=".75"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** Hand-built plans for the fixtures that have them; a greedy trail cover otherwise. */
function planFor(name: string, r: ResolvedDesign): BuildPlan {
  if (name === 'triangle' && r.edges.length === triangle.edges.length) return trianglePlan;
  if (name === 'plus' && r.edges.length === plus.edges.length) return plusPlan;
  return greedyPlan(r);
}

/** Isolated dev page: open /?dev=canvas. */
export default function CanvasDev() {
  const [name, setName] = useState('combo');
  const [state, setStateRaw] = useState<MockState>(() => ({
    resolved: ALL.combo(),
    selection: EMPTY_SELECTION,
    activeGroupId: fixtures.combo.groups[0].id,
  }));
  const stateRef = useRef(state);
  const [tool, setTool] = useState<ToolId>('select');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [snap, setSnap] = useState<SnapOptions>({ grid: true, gridSize: 1, nails: true });
  const [labels, setLabels] = useState(false);
  const [pins, setPins] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [photos, setPhotos] = useState(true);
  const [usePlay, setUsePlay] = useState(false);
  const [doHighlight, setDoHighlight] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const actions = useMemo(
    () =>
      createMockActions(
        () => stateRef.current,
        (next) => {
          stateRef.current = next;
          setStateRaw(next);
        },
        (msg) => setLog((l) => [msg, ...l].slice(0, 8)),
      ),
    [],
  );

  const load = (n: string) => {
    const r = ALL[n]();
    const next = { resolved: r, selection: EMPTY_SELECTION, activeGroupId: r.groups[0]?.id ?? '' };
    stateRef.current = next;
    setStateRaw(next);
    setName(n);
  };

  const resolved = useMemo(
    () =>
      photos
        ? { ...state.resolved, pins: state.resolved.pins.map((p, i) => ({ ...p, photo: p.photo ?? { dataUrl: samplePhoto(i), aspect: 0.8 } })) }
        : state.resolved,
    [state.resolved, photos],
  );
  const report = useMemo(() => (overlay === 'none' ? undefined : mockReport(state.resolved)), [overlay, state.resolved]);
  const plan = useMemo(() => (usePlay || doHighlight ? planFor(name, state.resolved) : undefined), [name, state.resolved, usePlay, doHighlight]);
  const pb = usePlayback(usePlay ? plan : undefined);

  const flatSteps = useMemo(() => plan?.runs.flatMap((r) => r.steps) ?? [], [plan]);
  const highlight = useMemo(() => {
    if (!doHighlight) return undefined;
    const st = usePlay ? flatSteps[Math.min(pb.state.step, flatSteps.length - 1)] : flatSteps[0];
    return st ? { nails: [st.from, st.to], edges: [st.edgeId] } : undefined;
  }, [doHighlight, usePlay, flatSteps, pb.state.step]);

  const sel = state.selection;
  const thumbs = useMemo(() => Object.entries(ALL).map(([k, f]) => [k, f()] as const), []);

  return (
    <div className={s.page}>
      <aside className={s.side}>
        <h1 className={s.title}>Canvas playground</h1>

        <label className={s.field}>
          <span>Fixture</span>
          <select value={name} onChange={(e) => load(e.target.value)}>
            {Object.keys(ALL).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>

        <div className={s.field}>
          <span>Tool</span>
          <div className={s.seg}>
            {TOOLS.map((t) => (
              <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className={s.field}>
          <span>Twine group (connect)</span>
          <select value={state.activeGroupId} onChange={(e) => actions.setActiveGroup(e.target.value)}>
            {state.resolved.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <div className={s.field}>
          <span>Overlay</span>
          <div className={s.seg}>
            {OVERLAYS.map((o) => (
              <button key={o} type="button" aria-pressed={overlay === o} onClick={() => setOverlay(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>

        <div className={s.checks}>
          <label>
            <input type="checkbox" checked={snap.grid} onChange={(e) => setSnap({ ...snap, grid: e.target.checked })} /> Snap to grid
          </label>
          <label className={s.inline}>
            Grid
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={snap.gridSize}
              onChange={(e) => setSnap({ ...snap, gridSize: Math.max(0.25, Number(e.target.value) || 1) })}
            />
          </label>
          <label>
            <input type="checkbox" checked={snap.nails} onChange={(e) => setSnap({ ...snap, nails: e.target.checked })} /> Align to nails
          </label>
          <label>
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Nail numbers
          </label>
          <label>
            <input type="checkbox" checked={pins} onChange={(e) => setPins(e.target.checked)} /> Show photos
          </label>
          <label>
            <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} /> Sample images
          </label>
          <label>
            <input type="checkbox" checked={doHighlight} onChange={(e) => setDoHighlight(e.target.checked)} /> Highlight step
          </label>
          <label>
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only
          </label>
        </div>

        <fieldset className={s.box}>
          <legend>
            <label>
              <input type="checkbox" checked={usePlay} onChange={(e) => setUsePlay(e.target.checked)} /> Playback
            </label>
          </legend>
          <div className={s.row}>
            <button type="button" disabled={!usePlay} onClick={pb.toggle}>
              {pb.state.playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" disabled={!usePlay} onClick={pb.reset}>
              Reset
            </button>
            <select disabled={!usePlay} value={pb.state.speed} onChange={(e) => pb.setSpeed(Number(e.target.value))}>
              {[1, 2, 4, 8, 20, 60, 200].map((v) => (
                <option key={v} value={v}>
                  {v} steps/s
                </option>
              ))}
            </select>
          </div>
          <input
            type="range"
            className={s.range}
            disabled={!usePlay}
            min={0}
            max={pb.state.totalSteps}
            value={pb.state.step}
            onChange={(e) => pb.seek(Number(e.target.value))}
          />
          <div className={s.muted}>
            step {pb.state.step} / {pb.state.totalSteps} · {plan?.runs.length ?? 0} runs
          </div>
        </fieldset>

        <div className={s.muted}>
          {state.resolved.nails.length} nails · {state.resolved.edges.length} edges · {state.resolved.pins.length} pins
          <br />
          selected: {sel.nails.length} nails, {sel.edges.length} edges, {sel.pins.length} pins
        </div>
        <ol className={s.log}>
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
        <p className={s.help}>
          Wheel zooms at the cursor · middle-drag or space+drag pans · shift adds to the selection · Delete removes ·
          Esc clears / ends a connect chain · right-click ends a chain.
        </p>
      </aside>

      <main className={s.main}>
        <div className={s.stage}>
          <Scene
            resolved={resolved}
            selection={state.selection}
            tool={tool}
            activeGroupId={state.activeGroupId}
            actions={readOnly ? undefined : actions}
            report={report}
            overlay={overlay}
            plan={usePlay ? plan : undefined}
            playback={usePlay ? pb.state : undefined}
            showPins={pins}
            showNailLabels={labels}
            snap={snap}
            highlight={highlight}
          />
        </div>
        <div className={s.thumbs}>
          {thumbs.map(([k, r]) => (
            <button key={k} type="button" className={s.thumb} aria-pressed={k === name} onClick={() => load(k)} title={k}>
              <Thumbnail resolved={r} width={120} />
              <span>{k}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
