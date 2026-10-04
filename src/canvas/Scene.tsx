import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Edge, EdgeId, NailId, PinId, Vec2, Wall } from '@/contracts/design';
import type { Selection } from '@/contracts/actions';
import { DEFAULT_ANALYZE_OPTIONS_IN } from '@/contracts/plan';
import type { SceneProps } from '@/contracts/ui';
import { clamp, pointOnSag, sagPath } from '@/lib/geom';
import { nailLabels } from '@/lib/labels';
import {
  EdgeHalos,
  GridLayer,
  IssueHalos,
  NailDefs,
  NailGlow,
  NailLayer,
  PinLayer,
  PlaybackLayer,
  Rulers,
  TwineLayer,
  WallLayer,
  groupStyles,
  type StepDraw,
} from './layers';
import { flattenPlan, hitEdge, hitNail, hitPin, nailMap, pinAnchor, scoreColor, sizes, snapPoint } from './math';
import s from './Scene.module.css';
import { usePhotoSize } from './PhotoSize';

/** Camera: wall coordinate at the viewport's top-left corner, and zoom in screen px per wall unit. */
export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Screen-pixel tolerances for hit-testing. */
const NAIL_TOL = 10;
const EDGE_TOL = 7;
const PIN_EDGE_TOL = 12;
const SNAP_TOL = 8;
const DRAG_THRESHOLD = 3;
/** Minimum on-screen nail head radius in px. */
const MIN_NAIL_PX = 3.6;
/** Above this many edges the fibre texture is drawn only when zoomed in far enough to see it. */
const DETAIL_EDGE_LIMIT = 600;

/** View that fits the whole wall with padding. */
export function fitView(size: Size, wall: Pick<Wall, 'width' | 'height'>): View {
  const pad = Math.max(24, Math.min(size.w, size.h) * 0.05);
  const W = Math.max(1e-6, wall.width);
  const H = Math.max(1e-6, wall.height);
  const k = Math.max(1e-3, Math.min((size.w - 2 * pad) / W, (size.h - 2 * pad) / H));
  return { k, x: W / 2 - size.w / (2 * k), y: H / 2 - size.h / (2 * k) };
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; v0: View }
  | { kind: 'nails'; ids: NailId[]; exclude: Set<NailId>; anchor: Vec2; start: Vec2; applied: Vec2; sx: number; sy: number; started: boolean }
  | { kind: 'pin'; id: PinId; edge: Edge; sx: number; sy: number; started: boolean }
  | { kind: 'lasso'; start: Vec2; sx: number; sy: number; shift: boolean; started: boolean };

interface Ui {
  cursor: Vec2 | null;
  hoverNail: NailId | null;
  hoverEdge: { id: EdgeId; t: number } | null;
  hoverPin: PinId | null;
  lasso: { x0: number; y0: number; x1: number; y1: number } | null;
  guideX: number | null;
  guideY: number | null;
  panning: boolean;
}

const NO_UI: Ui = {
  cursor: null,
  hoverNail: null,
  hoverEdge: null,
  hoverPin: null,
  lasso: null,
  guideX: null,
  guideY: null,
  panning: false,
};

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const dataId = (e: { target: EventTarget | null }, attr: string): string | null => {
  const t = e.target as Element | null;
  const el = t && typeof t.closest === 'function' ? t.closest(`[${attr}]`) : null;
  return el ? el.getAttribute(attr) : null;
};

const toggle = <T,>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/**
 * The interactive wall: twine, nails, clothespinned photos, overlays and playback.
 * Draws in wall units; zoom-dependent screen sizes come from CSS variables on the root.
 */
export function Scene(props: SceneProps) {
  const {
    resolved,
    selection,
    tool,
    activeGroupId,
    actions,
    report,
    overlay = 'none',
    plan,
    playback,
    showPins = true,
    showNailLabels = false,
    snap,
    highlight,
    className,
  } = props;
  const { wall } = resolved;
  const units = wall.units;
  const photoSize = usePhotoSize(units);
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = 'pw' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [size, setSize] = useState<Size>({ w: 800, h: 600 });
  const [userView, setUserView] = useState<View | null>(null);
  const [ui, setUi] = useState<Ui>(NO_UI);
  const [chain, setChain] = useState<NailId | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const view = userView ?? fitView(size, wall);
  const fitK = fitView(size, wall).k;
  // Camera during a gesture: the SVG is moved with a cheap composited CSS transform and the
  // viewBox is committed once the gesture settles, so 2000-edge webs pan and zoom smoothly.
  const svgRef = useRef<SVGSVGElement>(null);
  const live = useRef<View | null>(null);
  const committed = useRef(view);
  committed.current = view;
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const camera = live.current ?? view;

  // ── derived, memoised data ────────────────────────────
  const nails = useMemo(() => nailMap(resolved.nails), [resolved.nails]);
  const edgesById = useMemo(() => new Map(resolved.edges.map((e) => [e.id, e])), [resolved.edges]);
  const groupSig = resolved.groups.map((g) => `${g.id}|${g.color}|${g.thickness}`).join(';') + units;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const styles = useMemo(() => groupStyles(resolved.groups, units), [groupSig]);
  const paths = useMemo(() => {
    const m = new Map<EdgeId, string>();
    for (const e of resolved.edges) {
      const a = nails.get(e.a);
      const b = nails.get(e.b);
      if (a && b) m.set(e.id, sagPath(a, b, e.sag));
    }
    return m;
  }, [resolved.edges, nails]);
  const edgeTw = useCallback((id: EdgeId) => styles.get(edgesById.get(id)?.groupId ?? '')?.tw ?? 0.08, [styles, edgesById]);
  const labels = useMemo(() => (showNailLabels ? nailLabels(resolved.nails) : null), [showNailLabels, resolved.nails]);
  const anchors = useMemo(() => {
    const m = new Map<string, Vec2>();
    for (const p of resolved.pins) {
      const at = pinAnchor(p, edgesById, nails);
      if (at) m.set(p.id, at);
    }
    return m;
  }, [resolved.pins, edgesById, nails]);
  const tints = useMemo(() => {
    if (overlay !== 'photos' || !report) return null;
    const out: Record<EdgeId, string> = Object.create(null);
    for (const e of resolved.edges) out[e.id] = scoreColor(report.edgeScore[e.id] ?? 0);
    return out;
  }, [overlay, report, resolved.edges]);
  const steps = useMemo<StepDraw[] | null>(() => {
    if (!plan) return null;
    return flattenPlan(plan).map((st) => {
      const e = edgesById.get(st.edgeId);
      const a = nails.get(st.from);
      const b = nails.get(st.to);
      return { index: st.index, edgeId: st.edgeId, from: st.from, to: st.to, groupId: e?.groupId ?? st.groupId, d: e && a && b ? sagPath(a, b, e.sag) : '' };
    });
  }, [plan, edgesById, nails]);
  const playing = !!(playback && steps);

  // Latest values for stable event handlers.
  const latest = useRef({ view: camera, fitK, resolved, nails, edgesById, selection, tool, actions, snap, activeGroupId, chain, units, photoSize });
  latest.current = { view: camera, fitK, resolved, nails, edgesById, selection, tool, actions, snap, activeGroupId, chain, units, photoSize };
  const drag = useRef<Drag | null>(null);
  const hovering = useRef(false);

  // Switching to Build can unmount the canvas during a drag. Never leave history paused.
  useEffect(() => () => {
    const d = drag.current;
    if (d && (d.kind === 'nails' || d.kind === 'pin') && d.started) latest.current.actions?.endGesture();
  }, []);

  // End a connect chain when the tool changes.
  useEffect(() => setChain(null), [tool]);

  // ── container size ────────────────────────────────────
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((p) => (p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const syncTransform = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const L = live.current;
    const C = committed.current;
    svg.style.transform = L ? `translate(${(C.x - L.x) * L.k}px, ${(C.y - L.y) * L.k}px) scale(${L.k / C.k})` : '';
  }, []);

  const commit = useCallback(() => {
    clearTimeout(commitTimer.current);
    commitTimer.current = undefined;
    if (live.current) setUserView(live.current);
  }, []);

  const moveCamera = useCallback(
    (next: View, settleMs?: number) => {
      live.current = next;
      latest.current.view = next;
      syncTransform();
      if (settleMs !== undefined) {
        clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(commit, settleMs);
      }
    },
    [syncTransform, commit],
  );

  // After a commit renders the new viewBox, drop the temporary transform in the same frame.
  useLayoutEffect(() => {
    if (live.current && live.current === userView) live.current = null;
    syncTransform();
  }, [userView, view.x, view.y, view.k, syncTransform]);

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const fit = () => {
    clearTimeout(commitTimer.current);
    live.current = null;
    latest.current.view = fitView(size, wall);
    syncTransform();
    setUserView(null);
  };

  // ── wheel zoom (native, non-passive so the page doesn't scroll) ──
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, fitK: fk } = latest.current;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const k2 = clamp(v.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), fk * 0.2, fk * 60);
      const wx = v.x + mx / v.k;
      const wy = v.y + my / v.k;
      moveCamera({ k: k2, x: wx - mx / k2, y: wy - my / k2 }, 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [moveCamera]);

  // ── keyboard ──────────────────────────────────────────
  useEffect(() => {
    const isActive = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return false;
      if (root.contains(e.target as Node) || root.contains(document.activeElement)) return true;
      return hovering.current && (document.activeElement === document.body || document.activeElement === null);
    };
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !isActive(e)) return;
      const L = latest.current;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (!L.actions) return;
      if (e.key === 'Escape') {
        if (L.chain) setChain(null);
        else L.actions.clearSelection();
        setUi((u) => ({ ...u, lasso: null }));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = L.selection;
        if (sel.nails.length || sel.edges.length || sel.pins.length) {
          e.preventDefault();
          L.actions.deleteSelection();
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') setSpaceDown(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // ── pointer helpers ───────────────────────────────────
  const toWall = useCallback((e: { clientX: number; clientY: number }): Vec2 => {
    const r = rootRef.current!.getBoundingClientRect();
    const v = latest.current.view;
    return { x: v.x + (e.clientX - r.left) / v.k, y: v.y + (e.clientY - r.top) / v.k };
  }, []);

  const pickNail = useCallback((e: { target: EventTarget | null }, p: Vec2, exclude?: Set<NailId>) => {
    const L = latest.current;
    const id = dataId(e, 'data-nail-id');
    if (id && L.nails.has(id) && !exclude?.has(id)) return L.nails.get(id)!;
    return hitNail(L.resolved.nails, p, NAIL_TOL / L.view.k, exclude);
  }, []);

  const pickPin = useCallback((e: { target: EventTarget | null }, p: Vec2) => {
    const L = latest.current;
    const id = dataId(e, 'data-pin-id');
    if (id) return id;
    return hitPin(L.resolved.pins, L.edgesById, L.nails, L.units, p, 2 / L.view.k, L.photoSize);
  }, []);

  const snapAt = useCallback((p: Vec2, exclude?: Set<NailId>) => {
    const L = latest.current;
    return snapPoint(p, L.snap, L.resolved.nails, SNAP_TOL / L.view.k, exclude);
  }, []);

  const startPan = (e: ReactPointerEvent) => {
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v0: latest.current.view };
    setUi((u) => ({ ...u, panning: true }));
  };

  const capture = (e: ReactPointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom / synthetic pointers */
    }
  };

  // ── pointer handlers ─────────────────────────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const L = latest.current;
    rootRef.current?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && (spaceDown || L.tool === 'pan' || !L.actions))) {
      e.preventDefault();
      capture(e);
      startPan(e);
      return;
    }
    const A = L.actions;
    if (!A) return;
    if (e.button === 2) {
      if (L.tool === 'connect') setChain(null);
      return;
    }
    if (e.button !== 0) return;
    const p = toWall(e);
    const sel: Selection = L.selection;

    switch (L.tool) {
      case 'select': {
        capture(e);
        const nail = pickNail(e, p);
        if (nail) {
          let ids: NailId[];
          if (e.shiftKey) {
            ids = toggle(sel.nails, nail.id);
            A.setSelection({ nails: ids });
            if (!ids.includes(nail.id)) return;
          } else if (sel.nails.includes(nail.id)) {
            ids = sel.nails;
          } else {
            ids = [nail.id];
            A.setSelection({ nails: ids, edges: [], pins: [] });
          }
          drag.current = {
            kind: 'nails',
            ids,
            exclude: new Set(ids),
            anchor: { x: nail.x, y: nail.y },
            start: p,
            applied: { x: 0, y: 0 },
            sx: e.clientX,
            sy: e.clientY,
            started: false,
          };
          return;
        }
        const pinId = pickPin(e, p);
        if (pinId) {
          if (e.shiftKey) A.setSelection({ pins: toggle(sel.pins, pinId) });
          else if (!sel.pins.includes(pinId)) A.setSelection({ nails: [], edges: [], pins: [pinId] });
          const pin = L.resolved.pins.find((x) => x.id === pinId);
          const edge = pin && L.edgesById.get(pin.edgeId);
          if (edge) drag.current = { kind: 'pin', id: pinId, edge, sx: e.clientX, sy: e.clientY, started: false };
          return;
        }
        const hit = hitEdge(L.resolved.edges, L.nails, p, EDGE_TOL / L.view.k);
        if (hit) {
          if (e.shiftKey) A.setSelection({ edges: toggle(sel.edges, hit.edge.id) });
          else A.setSelection({ nails: [], edges: [hit.edge.id], pins: [] });
          return;
        }
        drag.current = { kind: 'lasso', start: p, sx: e.clientX, sy: e.clientY, shift: e.shiftKey, started: false };
        return;
      }
      case 'add-nail': {
        const sp = snapAt(p).p;
        const w = L.resolved.wall;
        A.addNail({ x: clamp(sp.x, 0, w.width), y: clamp(sp.y, 0, w.height) });
        return;
      }
      case 'connect': {
        const nail = pickNail(e, p);
        if (!nail) return;
        if (L.chain && L.chain !== nail.id && L.nails.has(L.chain)) A.connect(L.chain, nail.id, L.activeGroupId);
        setChain(nail.id);
        return;
      }
      case 'pin': {
        const hit = hitEdge(L.resolved.edges, L.nails, p, PIN_EDGE_TOL / L.view.k);
        if (hit) A.addPin(hit.edge.id, Math.round(hit.t * 1000) / 1000);
        return;
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const L = latest.current;
    const d = drag.current;
    const p = toWall(e);
    const moved = d && 'sx' in d ? Math.hypot(e.clientX - d.sx, e.clientY - d.sy) : 0;

    if (d?.kind === 'pan') {
      moveCamera({ k: d.v0.k, x: d.v0.x - (e.clientX - d.sx) / d.v0.k, y: d.v0.y - (e.clientY - d.sy) / d.v0.k });
      return;
    }
    const A = L.actions;
    if (!A) return;
    if (d?.kind === 'nails') {
      if (!d.started) {
        if (moved < DRAG_THRESHOLD) return;
        d.started = true;
        A.beginGesture();
      }
      const raw = { x: d.anchor.x + p.x - d.start.x, y: d.anchor.y + p.y - d.start.y };
      const sn = snapAt(raw, d.exclude);
      const target = { x: sn.p.x - d.anchor.x, y: sn.p.y - d.anchor.y };
      const inc = { x: target.x - d.applied.x, y: target.y - d.applied.y };
      if (Math.abs(inc.x) > 1e-9 || Math.abs(inc.y) > 1e-9) {
        A.moveNails(d.ids, inc);
        d.applied = target;
      }
      setUi((u) => ({ ...u, guideX: sn.guideX, guideY: sn.guideY, cursor: p }));
      return;
    }
    if (d?.kind === 'pin') {
      if (!d.started) {
        if (moved < DRAG_THRESHOLD) return;
        d.started = true;
        A.beginGesture();
      }
      const hit = hitEdge([d.edge], L.nails, p, Infinity);
      if (hit) A.updatePin(d.id, { t: clamp(Math.round(hit.t * 1000) / 1000, 0.02, 0.98) });
      return;
    }
    if (d?.kind === 'lasso') {
      if (!d.started && moved < DRAG_THRESHOLD) return;
      d.started = true;
      setUi((u) => ({ ...u, lasso: { x0: d.start.x, y0: d.start.y, x1: p.x, y1: p.y } }));
      return;
    }

    // hover previews (local state only; heavy layers are memoised)
    switch (L.tool) {
      case 'select': {
        const nail = pickNail(e, p);
        const pin = nail ? null : pickPin(e, p);
        const edge = nail || pin ? null : hitEdge(L.resolved.edges, L.nails, p, EDGE_TOL / L.view.k);
        setUi((u) =>
          u.hoverNail === (nail?.id ?? null) && u.hoverPin === pin && u.hoverEdge?.id === edge?.edge.id
            ? u
            : { ...u, hoverNail: nail?.id ?? null, hoverPin: pin, hoverEdge: edge ? { id: edge.edge.id, t: edge.t } : null },
        );
        return;
      }
      case 'add-nail': {
        const sn = snapAt(p);
        setUi((u) => ({ ...u, cursor: sn.p, guideX: sn.guideX, guideY: sn.guideY }));
        return;
      }
      case 'connect': {
        const nail = pickNail(e, p);
        setUi((u) => ({ ...u, cursor: p, hoverNail: nail?.id ?? null }));
        return;
      }
      case 'pin': {
        const hit = hitEdge(L.resolved.edges, L.nails, p, PIN_EDGE_TOL / L.view.k);
        setUi((u) => ({ ...u, hoverEdge: hit ? { id: hit.edge.id, t: hit.t } : null }));
        return;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const L = latest.current;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const A = L.actions;
    if (d.kind === 'pan') {
      commit();
      setUi((u) => ({ ...u, panning: false }));
      return;
    }
    if (!A) return;
    if ((d.kind === 'nails' || d.kind === 'pin') && d.started) {
      A.endGesture();
      setUi((u) => ({ ...u, guideX: null, guideY: null }));
      return;
    }
    if (d.kind === 'lasso') {
      setUi((u) => ({ ...u, lasso: null }));
      if (!d.started) {
        if (!d.shift) A.clearSelection();
        return;
      }
      const p = toWall(e);
      const x0 = Math.min(d.start.x, p.x);
      const x1 = Math.max(d.start.x, p.x);
      const y0 = Math.min(d.start.y, p.y);
      const y1 = Math.max(d.start.y, p.y);
      const inside = (q: Vec2) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
      const ns = L.resolved.nails.filter(inside).map((n) => n.id);
      const nset = new Set(ns);
      const es = L.resolved.edges.filter((ed) => nset.has(ed.a) && nset.has(ed.b)).map((ed) => ed.id);
      const ps = L.resolved.pins
        .filter((pin) => {
          const at = pinAnchor(pin, L.edgesById, L.nails);
          return at && inside(at);
        })
        .map((pin) => pin.id);
      const sel = L.selection;
      const union = <T,>(a: T[], b: T[]) => (d.shift ? [...new Set([...a, ...b])] : b);
      A.setSelection({ nails: union(sel.nails, ns), edges: union(sel.edges, es), pins: union(sel.pins, ps) });
    }
  };

  const onPointerLeave = () => {
    hovering.current = false;
    if (!drag.current) setUi((u) => ({ ...u, cursor: null, hoverNail: null, hoverEdge: null, hoverPin: null, guideX: null, guideY: null }));
  };

  // ── cursor ────────────────────────────────────────────
  let cursor: string | undefined;
  if (ui.panning) cursor = 'grabbing';
  else if (spaceDown || tool === 'pan') cursor = 'grab';
  else if (actions) {
    if (tool === 'add-nail') cursor = 'crosshair';
    else if (tool === 'connect') cursor = ui.hoverNail ? 'pointer' : 'crosshair';
    else if (tool === 'pin') cursor = ui.hoverEdge ? 'copy' : undefined;
    else if (tool === 'select') cursor = ui.hoverNail || ui.hoverPin ? 'move' : ui.hoverEdge ? 'pointer' : undefined;
  }

  // ── render ────────────────────────────────────────────
  const z = sizes(units);
  const rootStyle: Vars = {
    '--upx': 1 / view.k,
    '--nr': Math.max(z.nailR, (resolved.nails.length > 150 ? MIN_NAIL_PX * 0.7 : MIN_NAIL_PX) / view.k),
    // Dense webs read better with finer minimum twine on screen.
    '--minpx': resolved.edges.length > DETAIL_EDGE_LIMIT ? 1.1 : 2.1,
  };
  const gridStep = snap?.grid && snap.gridSize > 0 ? snap.gridSize * Math.max(1, Math.ceil(6 / (snap.gridSize * view.k))) : 0;
  const chainNail = chain ? nails.get(chain) : undefined;
  const previewEnd = ui.hoverNail && ui.hoverNail !== chain ? nails.get(ui.hoverNail) : ui.cursor;
  const activeStyle = styles.get(activeGroupId) ?? styles.values().next().value;
  const hoverEdgeEdge = ui.hoverEdge ? edgesById.get(ui.hoverEdge.id) : undefined;
  const hoverEdgeAt =
    tool === 'pin' && hoverEdgeEdge && nails.get(hoverEdgeEdge.a) && nails.get(hoverEdgeEdge.b)
      ? pointOnSag(nails.get(hoverEdgeEdge.a)!, nails.get(hoverEdgeEdge.b)!, hoverEdgeEdge.sag, ui.hoverEdge!.t)
      : null;
  const interactive = !!actions;
  // Fibre texture only where it is visible: always for small webs, zoomed-in for big ones.
  let minTw = Infinity;
  for (const st of styles.values()) minTw = Math.min(minTw, st.tw);
  const detail = resolved.edges.length <= DETAIL_EDGE_LIMIT || (Number.isFinite(minTw) && minTw * view.k >= 2.5);

  return (
    <div
      ref={rootRef}
      className={`${s.root} ${className ?? ''}`}
      style={rootStyle}
      tabIndex={0}
      data-scene=""
      data-tool={interactive ? tool : undefined}
      data-readonly={interactive ? undefined : 'true'}
      data-cursor={cursor}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => (hovering.current = true)}
      onPointerLeave={onPointerLeave}
      onContextMenu={
        interactive
          ? (e) => {
              e.preventDefault();
              setChain(null);
            }
          : undefined
      }
    >
      <svg
        ref={svgRef}
        className={s.svg}
        viewBox={`${view.x} ${view.y} ${size.w / view.k} ${size.h / view.k}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Photo web wall"
      >
        <NailDefs uid={uid} />
        <WallLayer wall={wall} uid={uid} />
        {gridStep > 0 && <GridLayer wall={wall} step={gridStep} uid={uid} />}
        <Rulers wall={wall} k={view.k} />

        {overlay === 'issues' && report && <IssueHalos issues={report.issues} paths={paths} edgeTw={edgeTw} nails={nails} />}
        {highlight?.edges?.length ? (
          <>
            <EdgeHalos ids={highlight.edges} paths={paths} edgeTw={edgeTw} className={s.glow} data="highlight" />
            <EdgeHalos ids={highlight.edges} paths={paths} edgeTw={edgeTw} className={s.glowCore} data="highlight-core" />
          </>
        ) : null}
        {selection.edges.length > 0 && <EdgeHalos ids={selection.edges} paths={paths} edgeTw={edgeTw} className={s.selHalo} data="selection" />}
        {interactive && ui.hoverEdge && !selection.edges.includes(ui.hoverEdge.id) && (
          <EdgeHalos ids={[ui.hoverEdge.id]} paths={paths} edgeTw={edgeTw} className={s.hoverHalo} data="hover" />
        )}

        <TwineLayer edges={resolved.edges} paths={paths} styles={styles} tints={tints} ghost={playing} detail={detail} />
        {playing && steps && (
          <PlaybackLayer
            steps={steps}
            step={playback!.step}
            progress={playback!.progress}
            nails={nails}
            edges={edgesById}
            styles={styles}
          />
        )}

        {highlight?.nails?.length ? <NailGlow ids={highlight.nails} nails={nails} /> : null}
        <NailLayer
          nails={resolved.nails}
          labels={labels}
          load={overlay === 'load' && report ? report.nailLoad : null}
          maxLoad={DEFAULT_ANALYZE_OPTIONS_IN.maxNailLoad}
          uid={uid}
        />
        {showPins && <PinLayer pins={resolved.pins} anchors={anchors} units={units} selected={selection.pins} uid={uid} photoSize={photoSize} />}

        {/* interaction overlay */}
        <g pointerEvents="none" data-layer="interaction">
          {selection.nails.map((id) => {
            const n = nails.get(id);
            return n ? (
              <g key={id} transform={`translate(${n.x} ${n.y})`}>
                <g className={s.ringScale}>
                  <circle r={1} className={s.selRing} />
                </g>
              </g>
            ) : null;
          })}
          {interactive && ui.hoverNail && !selection.nails.includes(ui.hoverNail) && nails.get(ui.hoverNail) && (
            <g transform={`translate(${nails.get(ui.hoverNail)!.x} ${nails.get(ui.hoverNail)!.y})`}>
              <g className={s.ringScale}>
                <circle r={1} className={s.hoverRing} />
              </g>
            </g>
          )}
          {chainNail && (
            <g transform={`translate(${chainNail.x} ${chainNail.y})`}>
              <g className={s.ringScale}>
                <circle r={1} className={s.selRing} style={{ stroke: activeStyle?.color }} />
              </g>
            </g>
          )}
          {interactive && tool === 'connect' && chainNail && previewEnd && (
            <path
              className={s.preview}
              d={`M${chainNail.x} ${chainNail.y}L${previewEnd.x} ${previewEnd.y}`}
              style={{ stroke: activeStyle?.color ?? 'var(--accent)', '--tw': activeStyle?.tw ?? 0.08 } as Vars}
            />
          )}
          {interactive && ui.guideX !== null && <line className={s.guide} x1={ui.guideX} x2={ui.guideX} y1={0} y2={wall.height} />}
          {interactive && ui.guideY !== null && <line className={s.guide} y1={ui.guideY} y2={ui.guideY} x1={0} x2={wall.width} />}
          {interactive && tool === 'add-nail' && ui.cursor && (
            <g transform={`translate(${ui.cursor.x} ${ui.cursor.y})`} className={s.ghostNail}>
              <g className={s.nailHead}>
                <circle r={1} fill={`url(#${uid}-nail)`} />
              </g>
            </g>
          )}
          {interactive && hoverEdgeAt && (
            <g transform={`translate(${hoverEdgeAt.x} ${hoverEdgeAt.y})`} opacity={0.6}>
              <rect x={-z.pinW / 2} y={-z.pinLen * 0.55} width={z.pinW} height={z.pinLen} rx={z.pinW * 0.3} fill={`url(#${uid}-wood)`} />
            </g>
          )}
          {ui.lasso && (
            <rect
              className={s.lasso}
              x={Math.min(ui.lasso.x0, ui.lasso.x1)}
              y={Math.min(ui.lasso.y0, ui.lasso.y1)}
              width={Math.abs(ui.lasso.x1 - ui.lasso.x0)}
              height={Math.abs(ui.lasso.y1 - ui.lasso.y0)}
            />
          )}
        </g>
      </svg>
      <span className={s.zoomLabel}>{Math.round((view.k / fitK) * 100)}%</span>
      <button
        type="button"
        className={s.fit}
        title="Fit wall to view"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={fit}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
        Fit
      </button>
    </div>
  );
}
