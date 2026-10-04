import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DesignActions, DesignStore, ToolId } from '@/contracts/actions';
import type { Design, LayerId, Pin, Wall } from '@/contracts/design';
import type { GeneratorRegistry } from '@/contracts/generator';
import type { Issue } from '@/contracts/plan';
import type { Overlay, SnapOptions } from '@/contracts/ui';
import { defaultAnalyzeOptions } from '@/contracts/defaults';
import { bbox } from '@/lib/geom';
import { randomSeed } from '@/lib/rng';
import { formatTwine } from '@/lib/units';
import {
  createDesignStore,
  decodeShareLink,
  deserializeDesign,
  encodeShareLink,
  resolveDesign,
  serializeDesign,
  useDesignStore,
} from '@/model';
import { registry as defaultRegistry } from '@/generators';
import { analyze, planBuild } from '@/plan';
import { Scene, usePlayback } from '@/canvas';
import {
  Button,
  EmptyState,
  GroupsPanel,
  HistoryStrip,
  Icon,
  IconButton,
  IssuesList,
  LayerInspector,
  LayersPanel,
  Menu,
  PatternGallery,
  PhotoSettings,
  PlaybackBar,
  Section,
  SelectionPanel,
  StatsChip,
  Toast,
  ToolPalette,
  TOOL_KEYS,
  TOOLS,
  ViewOptions,
  WallDialog,
  cx,
  photoSpec,
  toolHelp,
  wallLabel,
  type HistoryItem,
  type Size,
} from '@/panels';
import { autoFillPins } from './autofill';
import { BuildView, type BuildTab } from './BuildView';
import { guardActions, liveSelection, type Mode } from './guard';
import { useMediaQuery } from './useMediaQuery';
import { useVariations } from './useVariations';
import { downloadBlob, galleryOrder, generatorPreview, isEmptyDesign, slug } from './util';
import s from './App.module.css';

export interface AppProps {
  /** Inject a store (tests). Default: a fresh autosaving store. */
  store?: DesignStore;
  registry?: GeneratorRegistry;
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'explore', label: 'Explore' },
  { value: 'refine', label: 'Refine' },
  { value: 'build', label: 'Build' },
];

const SEVERITY_RANK = { info: 0, warn: 1, error: 2 } as const;

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'color', 'file']);
/** True while focus is in something that takes typed text (sliders and switches don't count). */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    (t instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(t.type)));

export function App({ store: injected, registry = defaultRegistry }: AppProps) {
  const [store] = useState<DesignStore>(() => injected ?? createDesignStore({ registry }));
  const design = useDesignStore(store, (st) => st.design);
  const rawSelection = useDesignStore(store, (st) => st.selection);
  const activeGroupId = useDesignStore(store, (st) => st.activeGroupId);
  const canUndo = useDesignStore(store, (st) => st.canUndo);
  const canRedo = useDesignStore(store, (st) => st.canRedo);
  const actions: DesignActions = useMemo(() => store.getState(), [store]);

  const [mode, setMode] = useState<Mode>('explore');
  const [tool, setTool] = useState<ToolId>('select');
  const [snap, setSnap] = useState<SnapOptions>(() => ({ grid: false, gridSize: design.wall.units === 'cm' ? 2.5 : 1, nails: true }));
  const [labels, setLabels] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [photoPreset, setPhotoPreset] = useState('4x6');
  const [playOpen, setPlayOpen] = useState(false);
  const [issueFocus, setIssueFocus] = useState<Issue | null>(null);
  const [buildTab, setBuildTab] = useState<BuildTab>('walk');
  const [selectedLayerId, setSelectedLayerId] = useState<LayerId | null>(null);
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);
  const [wallOpen, setWallOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const narrow = useMediaQuery('(max-width: 899px)');
  const wideBuild = useMediaQuery('(min-width: 1100px)');
  const fileRef = useRef<HTMLInputElement>(null);
  const issuesRef = useRef<HTMLDivElement>(null);

  const say = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ── derived design data ──────────────────────────────
  const units = design.wall.units;
  const resolved = useMemo(() => resolveDesign(design, registry), [design, registry]);
  const deferred = useDeferredValue(resolved);
  const analyzeOpts = useMemo(() => ({ ...defaultAnalyzeOptions(units), photo: photoSpec(photoPreset, units) }), [units, photoPreset]);
  const plan = useMemo(() => planBuild(deferred), [deferred]);
  const report = useMemo(() => analyze(deferred, analyzeOpts, plan), [deferred, analyzeOpts, plan]);
  const selection = useMemo(() => liveSelection(rawSelection, resolved), [rawSelection, resolved]);
  const empty = isEmptyDesign(design);

  // ── guarded actions for the Scene ────────────────────
  const live = useRef({ resolved, mode });
  useEffect(() => {
    live.current = { resolved, mode };
  }, [resolved, mode]);
  const sceneActions = useMemo(
    () =>
      guardActions(actions, () => ({
        design: store.getState().design,
        selection: store.getState().selection,
        resolved: live.current.resolved,
        mode: live.current.mode,
      })),
    [actions, store],
  );

  // Clicking a layer's nail or strand on the canvas selects that layer in the inspector.
  useEffect(
    () =>
      store.subscribe((st, prev) => {
        if (st.selection === prev.selection) return;
        const sel = st.selection;
        const id = sel.nails[0] ?? sel.edges[0];
        if (!id) return;
        const r = live.current.resolved;
        const owner = r.nails.find((n) => n.id === id)?.layerId ?? r.edges.find((e) => e.id === id)?.layerId;
        if (owner && st.design.layers.some((l) => l.id === owner)) setSelectedLayerId(owner);
      }),
    [store],
  );

  const selectedLayer = design.layers.find((l) => l.id === selectedLayerId) ?? null;

  // ── share link on startup ────────────────────────────
  useEffect(() => {
    if (!location.hash || location.hash.length < 8) return;
    const d = decodeShareLink(location.hash);
    if (d) {
      actions.loadDesign(d);
      say(`Opened “${d.meta.name}” from a share link`);
    }
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      location.hash = '';
    }
  }, [actions, say]);

  // ── variations ───────────────────────────────────────
  const variations = useVariations();
  const [currentVar, setCurrentVar] = useState<{ id: string; design: Design } | null>(null);
  const historyItems: HistoryItem[] = useMemo(
    () =>
      variations.items.map((v) => ({
        id: v.id,
        resolved: resolveDesign(v.design, registry),
        label: `${v.design.meta.name} · ${new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      })),
    [variations.items, registry],
  );
  const keep = useCallback(() => {
    const d = store.getState().design;
    variations.push(d);
    setCurrentVar(null);
    say('Kept ✦ in your variations');
  }, [store, variations, say]);
  const pickVariation = (id: string) => {
    const v = variations.items.find((x) => x.id === id);
    if (!v) return;
    const bg = store.getState().design.wall.background;
    const d: Design = bg && !v.design.wall.background ? { ...v.design, wall: { ...v.design.wall, background: bg } } : v.design;
    actions.loadDesign(d);
    setCurrentVar({ id, design: d });
    setSelectedLayerId(d.layers[0]?.id ?? null);
  };
  const currentVarId = currentVar && currentVar.design === design ? currentVar.id : null;

  // ── commands ─────────────────────────────────────────
  const surprise = useCallback(() => {
    const wall = store.getState().design.wall;
    const ids = actions.applySurprise(registry.surprise(randomSeed(), wall), true);
    actions.clearSelection();
    setSelectedLayerId(ids[ids.length - 1] ?? null);
    variations.push(store.getState().design);
    setMode((m) => (m === 'build' ? 'explore' : m));
    setDrawer(null);
  }, [actions, registry, store, variations]);

  const addPattern = useCallback(
    (generatorId: string, size: Size | null) => {
      const gen = registry.get(generatorId);
      const wall = store.getState().design.wall;
      let transform;
      if (size) {
        let base;
        try {
          base = gen?.suggestTransform?.(wall);
        } catch {
          base = undefined;
        }
        transform = { x: wall.width / 2, y: wall.height / 2, rotation: base?.rotation ?? 0, scaleX: size.w / 2, scaleY: size.h / 2 };
      }
      const id = actions.addLayer({ generatorId, ...(transform ? { transform } : {}) });
      setSelectedLayerId(id);
      setMode((m) => (m === 'build' ? 'explore' : m));
      if (narrow) setDrawer('right');
    },
    [actions, registry, store, narrow],
  );

  const starterId = registry.get('frame') ? 'frame' : 'spider-web';
  const starterLabel = registry.get('frame') ? 'Start with a rectangle frame' : 'Start with a spider web';

  const autoFill = () => {
    const pins: Pin[] = autoFillPins(deferred, report, analyzeOpts);
    actions.setPins(pins);
    say(pins.length ? `Pinned ${pins.length} photo${pins.length === 1 ? '' : 's'}` : 'No level strands long enough for photos');
  };

  const pickIssue = (issue: Issue) => {
    setIssueFocus(issue);
    actions.setSelection({ nails: issue.nailIds ?? [], edges: issue.edgeIds ?? [], pins: [] });
  };
  const goToIssues = () => {
    setMode('refine');
    setOverlay('issues');
    if (narrow) setDrawer('right');
    window.setTimeout(() => issuesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const exportJson = () => {
    downloadBlob(new Blob([serializeDesign(store.getState().design)], { type: 'application/json' }), `${slug(design.meta.name)}.json`);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const d = deserializeDesign(await file.text());
      actions.loadDesign(d);
      setSelectedLayerId(null);
      say(`Imported “${d.meta.name}”`);
    } catch (e) {
      say((e as Error).message || 'That file is not a photo web design');
    }
  };
  const copyShareLink = async () => {
    const url = `${location.origin}${location.pathname}${location.search}#${encodeShareLink(store.getState().design)}`;
    try {
      await navigator.clipboard.writeText(url);
      say('Share link copied');
    } catch {
      say('Could not copy: your browser blocked the clipboard');
    }
  };
  const newDesign = () => {
    actions.newDesign({ width: design.wall.width, height: design.wall.height, units: design.wall.units });
    setSelectedLayerId(null);
    setMode('explore');
    say('Fresh wall. Undo brings the old one back.');
  };
  const applyWall = (wall: Wall) => {
    const patch: Partial<Wall> = { ...wall };
    if (!wall.background) patch.background = undefined;
    actions.setWall(patch);
  };

  // ── keyboard ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        actions.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (mode === 'refine' && TOOL_KEYS[k]) {
        e.preventDefault();
        setTool(TOOL_KEYS[k]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, mode]);

  // ── playback ─────────────────────────────────────────
  const playing = mode === 'refine' && playOpen;
  const pb = usePlayback(playing ? plan : undefined);
  const { play: startPlayback } = pb;
  useEffect(() => {
    if (!playing) return;
    setIssueFocus(null);
    // Start once the clock has picked up the plan (it resets on a new plan).
    const id = window.setTimeout(startPlayback, 0);
    return () => window.clearTimeout(id);
  }, [playing, startPlayback]);

  // ── gestures (slider drags = one undo step) ──────────
  const gesture = useMemo(() => ({ onGestureStart: actions.beginGesture, onGestureEnd: actions.endGesture }), [actions]);

  // ── stats ────────────────────────────────────────────
  const worst = report.issues.reduce<Issue['severity']>((w, i) => (SEVERITY_RANK[i.severity] > SEVERITY_RANK[w] ? i.severity : w), 'info');
  const stats = (
    <StatsChip
      wall={wallLabel(design.wall)}
      nails={plan.totals.nails}
      runs={plan.totals.runs}
      twine={formatTwine(plan.totals.cutLength, units)}
      photoSlots={report.stats.photoSlots}
      issues={report.issues.length}
      severity={worst}
      onIssues={goToIssues}
    />
  );

  // ── per-layer info ───────────────────────────────────
  const layerCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of resolved.edges) if (e.layerId) c[e.layerId] = (c[e.layerId] ?? 0) + 1;
    return c;
  }, [resolved]);
  const groupUsage = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of resolved.edges) c[e.groupId] = (c[e.groupId] ?? 0) + 1;
    return c;
  }, [resolved]);
  const layerBounds = useMemo(() => {
    if (!selectedLayer) return null;
    return bbox(resolved.nails.filter((n) => n.layerId === selectedLayer.id));
  }, [resolved, selectedLayer]);

  const gallery = useMemo(() => galleryOrder(registry), [registry]);
  const previews = useMemo(() => {
    const out: Record<string, ReturnType<typeof generatorPreview>> = {};
    gallery.forEach((g, i) => (out[g.id] = generatorPreview(g, registry, design.wall, i)));
    return out;
  }, [gallery, registry, design.wall]);

  // ── selection details (Refine) ───────────────────────
  const selEdges = useMemo(() => resolved.edges.filter((e) => selection.edges.includes(e.id)), [resolved, selection.edges]);
  const liveLayerIds = new Set(design.layers.map((l) => l.id));
  const liveSelNails = resolved.nails.filter((n) => selection.nails.includes(n.id) && n.layerId && liveLayerIds.has(n.layerId));
  const bakeTarget = liveSelNails[0]?.layerId;
  const sharedGroup = selEdges.length && selEdges.every((e) => e.groupId === selEdges[0].groupId) ? selEdges[0].groupId : null;

  const highlight = mode === 'refine' && issueFocus ? { nails: issueFocus.nailIds, edges: issueFocus.edgeIds } : undefined;
  useEffect(() => {
    if (mode !== 'refine') setIssueFocus(null);
  }, [mode]);

  // ── panels ───────────────────────────────────────────
  const layerActions = useMemo(
    () => ({
      updateLayer: actions.updateLayer,
      removeLayer: actions.removeLayer,
      moveLayer: actions.moveLayer,
      duplicateLayer: actions.duplicateLayer,
      bakeLayer: (id: LayerId) => {
        actions.bakeLayer(id);
        say('Baked: its nails are now plain nails you can edit in Refine');
      },
    }),
    [actions, say],
  );

  let left: ReactNode = null;
  let right: ReactNode = null;
  if (mode === 'explore') {
    left = (
      <>
        <Section title="Layers" actions={<span className={s.count}>{design.layers.length || ''}</span>}>
          <LayersPanel
            layers={design.layers}
            groups={design.groups}
            selectedId={selectedLayerId}
            onSelect={(id) => {
              setSelectedLayerId(id);
              if (id && narrow) setDrawer('right');
            }}
            actions={layerActions}
            describe={(l) => registry.get(l.generatorId)?.label ?? l.generatorId}
            counts={layerCounts}
          />
        </Section>
        <Section title="Add pattern">
          <PatternGallery
            items={gallery.map((g) => ({ id: g.id, label: g.label, description: g.description }))}
            previews={previews}
            wall={design.wall}
            onAdd={addPattern}
          />
        </Section>
        <Section title="Twine colours">
          <GroupsPanel groups={design.groups} activeGroupId={activeGroupId} actions={actions} usage={groupUsage} />
        </Section>
      </>
    );
    right = selectedLayer ? (
      <LayerInspector
        key={selectedLayer.id}
        layer={selectedLayer}
        generator={registry.get(selectedLayer.generatorId)}
        groups={design.groups}
        wall={design.wall}
        bounds={layerBounds}
        onUpdate={(patch) => actions.updateLayer(selectedLayer.id, patch)}
        onReroll={() => actions.updateLayer(selectedLayer.id, { seed: randomSeed() })}
        onDuplicate={() => setSelectedLayerId(actions.duplicateLayer(selectedLayer.id))}
        onBake={() => layerActions.bakeLayer(selectedLayer.id)}
        onRemove={() => {
          actions.removeLayer(selectedLayer.id);
          setSelectedLayerId(null);
        }}
        {...gesture}
      />
    ) : (
      <div className={s.placeholder}>
        <Icon name="sliders" size={28} />
        <h3>Pick a layer to tweak it</h3>
        <p>Select a layer on the left, or click its twine on the wall. Then play with the sliders: every change is live.</p>
        <div className={s.wallCard}>
          <div>
            <div className={s.wallCardLabel}>Wall area</div>
            <div className={s.wallCardValue}>{wallLabel(design.wall).replace(/ wall$/, '')}</div>
          </div>
          <Button size="small" icon="wall" onClick={() => setWallOpen(true)}>
            Wall setup
          </Button>
        </div>
      </div>
    );
  } else if (mode === 'refine') {
    left = (
      <>
        <Section title="Tool">
          <div className={s.toolNow}>
            <strong>{TOOLS.find((t) => t.id === tool)?.label}</strong>
            <p className={s.help}>{toolHelp(tool)}</p>
            <p className={s.keys}>
              {TOOLS.map((t) => (
                <span key={t.id}>
                  <kbd>{t.key}</kbd> {t.label}
                </span>
              ))}
            </p>
          </div>
        </Section>
        <Section title="View & snapping">
          <ViewOptions snap={snap} onSnap={setSnap} labels={labels} onLabels={setLabels} overlay={overlay} onOverlay={setOverlay} units={units} />
        </Section>
        <Section title="Twine colours">
          <GroupsPanel groups={design.groups} activeGroupId={activeGroupId} actions={actions} usage={groupUsage} />
        </Section>
      </>
    );
    right = (
      <>
        <Section title="Selection">
          <SelectionPanel
            nails={selection.nails}
            edges={selection.edges.length}
            pins={selection.pins.length}
            liveNails={liveSelNails.length}
            sag={selEdges.length ? selEdges[0].sag : null}
            groupId={sharedGroup}
            groups={design.groups}
            onSag={(sag) => sceneActions.updateEdges(selection.edges, { sag })}
            onGroup={(groupId) => sceneActions.updateEdges(selection.edges, { groupId })}
            onBake={bakeTarget ? () => layerActions.bakeLayer(bakeTarget) : undefined}
            onDelete={sceneActions.deleteSelection}
            {...gesture}
          />
        </Section>
        <div ref={issuesRef}>
          <Section
            title="Issues"
            actions={report.issues.length ? <span className={s.count}>{report.issues.length}</span> : undefined}
          >
            <IssuesList issues={report.issues} activeId={issueFocus?.id ?? null} onPick={pickIssue} />
          </Section>
        </div>
        <Section title="Photos">
          <PhotoSettings
            preset={photoPreset}
            onPreset={setPhotoPreset}
            slots={report.stats.photoSlots}
            pins={design.pins.length}
            onAutoFill={autoFill}
            onClear={() => actions.setPins([])}
            units={units}
            photoWidth={analyzeOpts.photo.width}
          />
        </Section>
        <Section title="Stringing order">
          <p className={s.help}>
            Watch the web get strung in {plan.totals.runs} piece{plan.totals.runs === 1 ? '' : 's'}, in the order you’ll build it.
          </p>
          <Button icon="play" onClick={() => setPlayOpen(true)} disabled={!plan.runs.length}>
            Play stringing
          </Button>
        </Section>
      </>
    );
  }

  const modeTabs = (
    <div className={s.modeTabs} role="tablist" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="tab"
          aria-selected={mode === m.value}
          className={s.modeTab}
          onClick={() => {
            setMode(m.value);
            setDrawer(null);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={s.app} data-mode={mode} data-narrow={narrow || undefined}>
      <header className={s.topbar}>
        <div className={s.brand}>
          <span className={s.logo} aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26">
              <path d="M5 9 Q16 20 27 9" />
              <path d="M5 9 L16 26 L27 9" />
              <circle cx="5" cy="9" r="2.4" />
              <circle cx="27" cy="9" r="2.4" />
              <circle cx="16" cy="26" r="2.4" />
            </svg>
          </span>
          <span className={s.wordmark}>Photo Web</span>
          <input
            key={design.meta.name + design.meta.createdAt}
            className={s.nameInput}
            defaultValue={design.meta.name}
            aria-label="Design name"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== design.meta.name) actions.renameDesign(v);
              else e.target.value = design.meta.name;
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        {modeTabs}
        <div className={s.topActions}>
          <div className={s.undoGroup}>
            <IconButton icon="undo" label="Undo (Ctrl+Z)" onClick={actions.undo} disabled={!canUndo} />
            <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={actions.redo} disabled={!canRedo} />
          </div>
          <Button variant="primary" icon="sparkle" onClick={surprise} className={s.surprise} aria-label="Surprise me">
            <span className={s.surpriseText}>Surprise me</span>
          </Button>
          <Menu
            items={[
              { label: 'New design', icon: 'file', onSelect: newDesign },
              { label: 'Wall setup…', icon: 'wall', onSelect: () => setWallOpen(true) },
              { label: 'Import JSON', icon: 'upload', onSelect: () => fileRef.current?.click(), separatorBefore: true },
              { label: 'Export JSON', icon: 'download', onSelect: exportJson },
              { label: 'Copy share link', icon: 'share', onSelect: () => void copyShareLink() },
            ]}
            trigger={(open, toggle) => <IconButton icon="more" label="Menu" pressed={open} onClick={toggle} />}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void importJson(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {mode === 'build' ? (
        <div className={s.buildWrap}>
          <BuildView
            resolved={deferred}
            plan={plan}
            report={report}
            designName={design.meta.name}
            createdAt={design.meta.createdAt}
            tab={buildTab}
            onTab={setBuildTab}
            showScene={wideBuild}
          />
          <div className={s.buildStats}>{stats}</div>
        </div>
      ) : (
        <div className={s.body}>
          <aside className={cx(s.side, s.left, drawer === 'left' && s.open)} aria-label={mode === 'explore' ? 'Layers and patterns' : 'Tools'}>
            {narrow && (
              <div className={s.drawerHead}>
                <strong>{mode === 'explore' ? 'Layers & patterns' : 'Tools & view'}</strong>
                <IconButton icon="close" label="Close panel" onClick={() => setDrawer(null)} />
              </div>
            )}
            {left}
          </aside>
          <main className={s.center}>
            <div className={s.stage}>
              <Scene
                resolved={resolved}
                selection={selection}
                tool={mode === 'refine' ? tool : 'select'}
                activeGroupId={activeGroupId}
                actions={sceneActions}
                report={report}
                overlay={mode === 'refine' ? overlay : 'none'}
                plan={playing ? plan : undefined}
                playback={playing ? pb.state : undefined}
                showPins={!playing}
                showNailLabels={mode === 'refine' && labels}
                snap={mode === 'refine' ? snap : undefined}
                highlight={highlight}
              />
              {empty && mode === 'explore' && (
                <EmptyState
                  onSurprise={surprise}
                  starterLabel={starterLabel}
                  onStarter={() => addPattern(starterId, null)}
                  onScratch={() => {
                    setMode('refine');
                    setTool('add-nail');
                  }}
                />
              )}
              {narrow && (
                <div className={s.drawerToggles}>
                  <Button size="small" icon={mode === 'explore' ? 'layers' : 'pointer'} onClick={() => setDrawer('left')}>
                    {mode === 'explore' ? 'Layers' : 'Tools'}
                  </Button>
                  <Button size="small" icon="sliders" onClick={() => setDrawer('right')}>
                    {mode === 'explore' ? 'Tweak' : 'Inspect'}
                  </Button>
                </div>
              )}
              {mode === 'refine' && (
                <div className={s.toolDock}>
                  <ToolPalette tool={tool} onTool={setTool} vertical={!narrow} />
                </div>
              )}
              {playing && (
                <div className={s.playDock}>
                  <PlaybackBar controls={pb} runs={plan.totals.runs} onClose={() => setPlayOpen(false)} />
                </div>
              )}
              {!playing && <div className={s.statsDock}>{stats}</div>}
            </div>
            {mode === 'explore' && (
              <div className={s.historyBar}>
                <HistoryStrip items={historyItems} currentId={currentVarId} onPick={pickVariation} onKeep={keep} canKeep={!empty} />
              </div>
            )}
          </main>
          <aside className={cx(s.side, s.right, drawer === 'right' && s.open)} aria-label="Inspector">
            {narrow && (
              <div className={s.drawerHead}>
                <strong>{mode === 'explore' ? 'Tweak' : 'Inspect'}</strong>
                <IconButton icon="close" label="Close panel" onClick={() => setDrawer(null)} />
              </div>
            )}
            {right}
          </aside>
          {narrow && drawer && <div className={s.scrim} data-drawer={drawer} onClick={() => setDrawer(null)} />}
        </div>
      )}

      {wallOpen && (
        <WallDialog
          wall={design.wall}
          hasGeometry={!empty}
          onApply={applyWall}
          onClose={() => setWallOpen(false)}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
