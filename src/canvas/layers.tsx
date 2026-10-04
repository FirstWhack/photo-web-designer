/**
 * Memoised SVG layers for the Scene. Each layer takes only the data it draws, so pointer
 * moves, hover and zoom (handled by CSS variables on the root) do not re-render them.
 */
import { memo, useMemo, type CSSProperties } from 'react';
import type { Edge, EdgeId, Nail, NailId, Pin, StrandGroup, Units, Wall } from '@/contracts/design';
import type { Issue } from '@/contracts/plan';
import { createRng } from '@/lib/rng';
import { pointOnSag } from '@/lib/geom';
import { niceStep, partialSagPath, photoBox, pinTilt, shade, sizes, luminance, type NailMap } from './math';
import s from './Scene.module.css';

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export interface GroupStyle {
  color: string;
  fibre: string;
  core: string;
  /** Real twine width in wall units. */
  tw: number;
}

export function groupStyles(groups: StrandGroup[], units: Units): Map<string, GroupStyle> {
  const out = new Map<string, GroupStyle>();
  for (const g of groups) out.set(g.id, strandStyle(g.color, g.thickness, units));
  return out;
}

export function strandStyle(color: string, thicknessMm: number, units: Units): GroupStyle {
  const lum = luminance(color);
  return {
    color,
    fibre: shade(color, lum > 0.75 ? 0.6 : 0.42),
    core: shade(color, lum < 0.2 ? 0.3 : -0.38),
    tw: Math.max(0, thicknessMm) / (units === 'cm' ? 10 : 25.4),
  };
}

const FALLBACK: GroupStyle = { color: '#999', fibre: '#ccc', core: '#666', tw: 0.08 };

// ── wall ──────────────────────────────────────────────────

export const WallLayer = memo(function WallLayer({ wall, uid }: { wall: Wall; uid: string }) {
  const k = wall.units === 'cm' ? 2.54 : 1;
  const tile = 6 * k;
  const specks = useMemo(() => {
    const rng = createRng(7);
    return Array.from({ length: 160 }, () => ({
      x: rng.range(0, tile),
      y: rng.range(0, tile),
      r: rng.range(0.008, 0.03) * k,
      light: rng.chance(0.45),
    }));
  }, [tile, k]);
  const { width: W, height: H, background: bg } = wall;
  const lip = Math.min(W, H) * 0.004;
  return (
    <g>
      <defs>
        <pattern id={`${uid}-speck`} width={tile} height={tile} patternUnits="userSpaceOnUse">
          {specks.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.r} className={p.light ? s.speckB : s.speckA} />
          ))}
        </pattern>
        <linearGradient id={`${uid}-light`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={s.lightA} />
          <stop offset="0.55" className={s.lightMid} />
          <stop offset="1" className={s.lightB} />
        </linearGradient>
      </defs>
      {[3, 2, 1].map((m) => (
        <rect key={m} className={s.wallShadow} x={-lip * m * 0.6} y={lip * m * 0.4} width={W + lip * m * 1.2} height={H + lip * m * 1.2} rx={lip * m} />
      ))}
      <rect className={s.wall} width={W} height={H} />
      <rect width={W} height={H} fill={`url(#${uid}-speck)`} />
      {bg && <image href={bg.dataUrl} x={bg.x} y={bg.y} width={bg.width} height={bg.height} opacity={bg.opacity} preserveAspectRatio="none" />}
      <rect width={W} height={H} fill={`url(#${uid}-light)`} />
      <rect className={s.wallEdge} width={W} height={H} />
    </g>
  );
});

export const GridLayer = memo(function GridLayer({ wall, step, uid }: { wall: Wall; step: number; uid: string }) {
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id={`${uid}-grid`} width={step} height={step} patternUnits="userSpaceOnUse">
          <path className={s.gridLine} d={`M${step} 0L0 0L0 ${step}`} />
        </pattern>
      </defs>
      <rect width={wall.width} height={wall.height} fill={`url(#${uid}-grid)`} />
    </g>
  );
});

/** Ruler ticks along the wall's top and left edges, spaced for the current zoom (`k` px/unit). */
export const Rulers = memo(function Rulers({ wall, k }: { wall: Wall; k: number }) {
  const major = niceStep(60 / k);
  const minor = (major / 5) * k >= 6 ? major / 5 : (major / 2) * k >= 6 ? major / 2 : major;
  const u = 1 / k;
  const along = (len: number) => {
    const out: { pos: number; major: boolean }[] = [];
    const n = Math.floor(len / minor + 1e-9);
    for (let i = 1; i <= n; i++) {
      const pos = i * minor;
      if (pos >= len - 1e-9) break;
      out.push({ pos, major: Math.abs(pos / major - Math.round(pos / major)) < 1e-6 });
    }
    return out;
  };
  const top = along(wall.width);
  const left = along(wall.height);
  const fmt = (v: number) => String(Number(v.toFixed(2)));
  let d = '';
  let dMajor = '';
  for (const t of top) {
    if (t.major) dMajor += `M${t.pos} 0V${8 * u}`;
    else d += `M${t.pos} 0V${4 * u}`;
  }
  for (const t of left) {
    if (t.major) dMajor += `M0 ${t.pos}H${8 * u}`;
    else d += `M0 ${t.pos}H${4 * u}`;
  }
  return (
    <g pointerEvents="none">
      {d && <path className={s.tick} d={d} />}
      {dMajor && <path className={`${s.tick} ${s.tickMajor}`} d={dMajor} />}
      {top
        .filter((t) => t.major)
        .map((t) => (
          <text key={`t${t.pos}`} className={s.rulerText} x={t.pos} y={18 * u} textAnchor="middle">
            {fmt(t.pos)}
          </text>
        ))}
      {left
        .filter((t) => t.major)
        .map((t) => (
          <text key={`l${t.pos}`} className={s.rulerText} x={11 * u} y={t.pos} dy="0.35em">
            {fmt(t.pos)}
          </text>
        ))}
      <text className={s.rulerText} x={5 * u} y={13 * u}>
        {wall.units}
      </text>
    </g>
  );
});

// ── twine ─────────────────────────────────────────────────

interface StrandProps {
  d: string;
  st: GroupStyle;
  edgeId?: string;
  tint?: string;
  data?: Record<string, string>;
  /** Draw the twisted-fibre texture (skipped for dense webs at low zoom). */
  detail?: boolean;
}

/** One stretch of twine: drop shadow, base colour, twisted-fibre highlights. */
export const Strand = memo(function Strand({ d, st, edgeId, tint, data, detail = true }: StrandProps) {
  const color = tint ?? st.color;
  const style: Vars = { '--c': color, '--cf': tint ? shade(tint, 0.45) : st.fibre, '--cd': tint ? shade(tint, -0.35) : st.core, '--tw': st.tw };
  return (
    <g className={s.strand} style={style} data-twine-edge={edgeId} {...data}>
      <path className={s.tShadow} d={d} />
      <path className={s.tBase} d={d} />
      {detail && <path className={s.tCore} d={d} />}
      {detail && <path className={s.tFibre} d={d} />}
    </g>
  );
});

export interface TwineLayerProps {
  edges: Edge[];
  paths: Map<EdgeId, string>;
  styles: Map<string, GroupStyle>;
  tints?: Record<EdgeId, string> | null;
  ghost?: boolean;
  detail?: boolean;
}

export const TwineLayer = memo(function TwineLayer({ edges, paths, styles, tints, ghost, detail = true }: TwineLayerProps) {
  // Chunks re-render only when one of their own paths changed (e.g. dragging one nail).
  const chunks = useMemo(() => {
    const out: Edge[][] = [];
    for (let i = 0; i < edges.length; i += CHUNK) out.push(edges.slice(i, i + CHUNK));
    return out;
  }, [edges]);
  const d = detail && !ghost;
  return (
    <g className={ghost ? s.ghost : undefined} data-layer="twine" data-ghost={ghost ? 'true' : undefined} pointerEvents="none">
      {chunks.map((c, i) => (
        <TwineChunk key={i} edges={c} paths={paths} styles={styles} tints={tints} detail={d} />
      ))}
    </g>
  );
});

const CHUNK = 128;

interface ChunkProps {
  edges: Edge[];
  paths: Map<EdgeId, string>;
  styles: Map<string, GroupStyle>;
  tints?: Record<EdgeId, string> | null;
  detail: boolean;
}

const TwineChunk = memo(
  function TwineChunk({ edges, paths, styles, tints, detail }: ChunkProps) {
    return (
      <>
        {edges.map((e) => {
          const d = paths.get(e.id);
          if (!d) return null;
          return <Strand key={e.id} edgeId={e.id} d={d} st={styles.get(e.groupId) ?? FALLBACK} tint={tints?.[e.id]} detail={detail} />;
        })}
      </>
    );
  },
  (p, n) => {
    if (p.edges !== n.edges || p.styles !== n.styles || p.tints !== n.tints || p.detail !== n.detail) return false;
    if (p.paths === n.paths) return true;
    for (const e of n.edges) if (p.paths.get(e.id) !== n.paths.get(e.id)) return false;
    return true;
  },
);

// ── halos ─────────────────────────────────────────────────

const SEVERITY_COLOR: Record<Issue['severity'], string> = {
  info: 'var(--accent-2)',
  warn: 'var(--warn)',
  error: 'var(--error)',
};
const SEVERITY_RANK: Record<Issue['severity'], number> = { info: 0, warn: 1, error: 2 };

export const IssueHalos = memo(function IssueHalos({
  issues,
  paths,
  edgeTw,
  nails,
}: {
  issues: Issue[];
  paths: Map<EdgeId, string>;
  edgeTw: (id: EdgeId) => number;
  nails: NailMap;
}) {
  const { edgeSev, nailSev } = useMemo(() => {
    const edgeSev = new Map<string, Issue['severity']>();
    const nailSev = new Map<string, Issue['severity']>();
    const bump = (m: Map<string, Issue['severity']>, id: string, sev: Issue['severity']) => {
      const cur = m.get(id);
      if (!cur || SEVERITY_RANK[sev] > SEVERITY_RANK[cur]) m.set(id, sev);
    };
    for (const is of issues) {
      is.edgeIds?.forEach((id) => bump(edgeSev, id, is.severity));
      is.nailIds?.forEach((id) => bump(nailSev, id, is.severity));
    }
    return { edgeSev, nailSev };
  }, [issues]);
  return (
    <g pointerEvents="none" data-layer="issues">
      {[...edgeSev].map(([id, sev]) => {
        const d = paths.get(id);
        return d ? (
          <path key={id} className={s.halo} d={d} data-issue-edge={id} style={{ stroke: SEVERITY_COLOR[sev], '--tw': edgeTw(id), '--hw': 11 } as Vars} />
        ) : null;
      })}
      {[...nailSev].map(([id, sev]) => {
        const n = nails.get(id);
        return n ? (
          <g key={id} transform={`translate(${n.x} ${n.y})`} data-issue-nail={id}>
            <g className={s.haloDotScale} style={{ '--hr': 9 } as Vars}>
              <circle r={1} className={s.haloDot} style={{ fill: SEVERITY_COLOR[sev] }} />
            </g>
          </g>
        ) : null;
      })}
    </g>
  );
});

export const EdgeHalos = memo(function EdgeHalos({
  ids,
  paths,
  edgeTw,
  className,
  data,
}: {
  ids: EdgeId[];
  paths: Map<EdgeId, string>;
  edgeTw: (id: EdgeId) => number;
  className: string;
  data: string;
}) {
  return (
    <g pointerEvents="none" data-layer={data}>
      {ids.map((id) => {
        const d = paths.get(id);
        return d ? <path key={id} className={className} d={d} style={{ '--tw': edgeTw(id) } as Vars} /> : null;
      })}
    </g>
  );
});

export const NailGlow = memo(function NailGlow({ ids, nails }: { ids: NailId[]; nails: NailMap }) {
  return (
    <g pointerEvents="none" data-layer="nail-glow">
      {ids.map((id) => {
        const n = nails.get(id);
        return n ? (
          <g key={id} transform={`translate(${n.x} ${n.y})`}>
            <g className={s.haloDotScale} style={{ '--hr': 10 } as Vars}>
              <circle r={1} style={{ fill: 'var(--accent)', opacity: 0.3 }} />
            </g>
            <g className={s.haloDotScale} style={{ '--hr': 4 } as Vars}>
              <circle r={1} style={{ fill: 'var(--accent)', opacity: 0.45 }} />
            </g>
          </g>
        ) : null;
      })}
    </g>
  );
});

// ── nails ─────────────────────────────────────────────────

export function NailDefs({ uid }: { uid: string }) {
  return (
    <defs>
      <radialGradient id={`${uid}-nail`} cx="0.36" cy="0.32" r="0.75">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.25" stopColor="#d9d6d1" />
        <stop offset="0.7" stopColor="#8f8a83" />
        <stop offset="1" stopColor="#57524c" />
      </radialGradient>
      <linearGradient id={`${uid}-wood`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#c9a172" />
        <stop offset="0.45" stopColor="#e6c9a0" />
        <stop offset="1" stopColor="#b58a5a" />
      </linearGradient>
      <linearGradient id={`${uid}-steel`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d5d8dc" />
        <stop offset="1" stopColor="#7d838b" />
      </linearGradient>
      <linearGradient id={`${uid}-ph`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d9e3e6" />
        <stop offset="0.6" stopColor="#eadfcd" />
        <stop offset="1" stopColor="#d8c6a8" />
      </linearGradient>
    </defs>
  );
}

const NailView = memo(function NailView({ id, x, y, label, load, loadColor, uid }: {
  id: string;
  x: number;
  y: number;
  label?: string;
  load?: number;
  loadColor?: string;
  uid: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`} data-nail-id={id}>
      <g className={s.nailHead} style={load ? ({ '--load': load } as Vars) : undefined}>
        {loadColor && <circle r={1.9} className={s.loadRing} style={{ stroke: loadColor, fill: loadColor, fillOpacity: 0.18 }} />}
        <circle cx={0.3} cy={0.55} r={1.08} className={s.nailShadow} />
        <circle r={1} fill={`url(#${uid}-nail)`} />
        <circle r={0.95} className={s.nailRim} />
      </g>
      {label && (
        <text className={s.label} dx="0.55em" dy="-0.45em">
          {label}
        </text>
      )}
    </g>
  );
});

export const NailLayer = memo(function NailLayer({
  nails,
  labels,
  load,
  maxLoad,
  uid,
}: {
  nails: Nail[];
  labels?: Record<NailId, string> | null;
  load?: Record<NailId, number> | null;
  maxLoad: number;
  uid: string;
}) {
  return (
    <g data-layer="nails">
      {nails.map((n) => {
        const l = load?.[n.id];
        const ratio = l === undefined ? 0 : l / Math.max(1, maxLoad);
        return (
          <NailView
            key={n.id}
            id={n.id}
            x={n.x}
            y={n.y}
            uid={uid}
            label={labels?.[n.id]}
            load={load ? 0.85 + Math.min(1.5, ratio) * 0.9 : undefined}
            loadColor={load ? `hsl(${Math.round(120 - Math.min(1, ratio) * 120)} 65% 45%)` : undefined}
          />
        );
      })}
    </g>
  );
});

// ── pins (clothespins + polaroids) ───────────────────────

const PinView = memo(function PinView({
  id,
  x,
  y,
  units,
  dataUrl,
  aspect,
  photoSize,
  selected,
  uid,
}: {
  id: string;
  x: number;
  y: number;
  units: Units;
  dataUrl?: string;
  aspect?: number;
  photoSize?: { width: number; height: number };
  selected: boolean;
  uid: string;
}) {
  const z = sizes(units);
  const box = photoBox(units, aspect, photoSize);
  const tilt = pinTilt(id);
  const clipY = box.y;
  const pw = z.pinW;
  const pl = z.pinLen;
  const top = -pl * 0.55;
  const k = units === 'cm' ? 2.54 : 1;
  const px = box.x + z.frameSide;
  const py = box.y + z.frameSide;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt * 0.35})`} data-pin-id={id}>
      <g transform={`rotate(${tilt * 0.65} 0 ${clipY})`}>
        <rect className={s.frameShadow} x={box.x + 0.12 * k} y={box.y + 0.2 * k} width={box.w} height={box.h} rx={0.05 * k} />
        <rect className={s.frameShadow} x={box.x + 0.05 * k} y={box.y + 0.08 * k} width={box.w} height={box.h} rx={0.05 * k} opacity={0.6} />
        <rect className={s.frame} x={box.x} y={box.y} width={box.w} height={box.h} rx={0.04 * k} />
        {dataUrl ? (
          <image href={dataUrl} x={px} y={py} width={box.pw} height={box.ph} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <g>
            <rect x={px} y={py} width={box.pw} height={box.ph} fill={`url(#${uid}-ph)`} />
            <circle cx={px + box.pw * 0.72} cy={py + box.ph * 0.3} r={box.pw * 0.11} fill="#f3d9a4" />
            <path
              d={`M${px} ${py + box.ph * 0.78}L${px + box.pw * 0.3} ${py + box.ph * 0.5}L${px + box.pw * 0.5} ${py + box.ph * 0.66}L${px + box.pw * 0.68} ${py + box.ph * 0.46}L${px + box.pw} ${py + box.ph * 0.74}V${py + box.ph}H${px}Z`}
              fill="#b9c2b0"
              opacity={0.8}
            />
          </g>
        )}
        <rect className={s.frameEdge} x={box.x} y={box.y} width={box.w} height={box.h} rx={0.04 * k} />
        {selected && <rect className={s.frameSel} x={box.x - 0.12 * k} y={box.y - 0.12 * k} width={box.w + 0.24 * k} height={box.h + 0.24 * k} rx={0.1 * k} />}
      </g>
      {/* clothespin */}
      <rect x={-pw / 2 + 0.05 * k} y={top + 0.08 * k} width={pw} height={pl} rx={pw * 0.3} fill="rgba(30,20,10,0.25)" />
      <rect x={-pw / 2} y={top} width={pw} height={pl} rx={pw * 0.3} fill={`url(#${uid}-wood)`} />
      <path d={`M0 ${top + pl * 0.04}V${top + pl * 0.96}`} stroke="rgba(90,60,30,0.55)" strokeWidth={0.025 * k} />
      <rect x={-pw / 2 - 0.03 * k} y={top + pl * 0.36} width={pw + 0.06 * k} height={pl * 0.12} rx={0.03 * k} fill={`url(#${uid}-steel)`} />
      <path d={`M${-pw * 0.3} ${top + pl * 0.15}h${pw * 0.6}`} stroke="rgba(255,240,220,0.5)" strokeWidth={0.02 * k} />
    </g>
  );
});

export const PinLayer = memo(function PinLayer({
  pins,
  anchors,
  units,
  selected,
  uid,
  photoSize,
}: {
  pins: Pin[];
  anchors: Map<string, { x: number; y: number }>;
  units: Units;
  selected: string[];
  uid: string;
  photoSize?: { width: number; height: number };
}) {
  const sel = new Set(selected);
  return (
    <g data-layer="pins">
      {pins.map((p) => {
        const a = anchors.get(p.id);
        return a ? (
          <PinView
            key={p.id}
            id={p.id}
            x={a.x}
            y={a.y}
            units={units}
            dataUrl={p.photo?.dataUrl}
            aspect={p.photo?.aspect}
            photoSize={photoSize}
            selected={sel.has(p.id)}
            uid={uid}
          />
        ) : null;
      })}
    </g>
  );
});

// ── playback ─────────────────────────────────────────────

export interface StepDraw {
  index: number;
  edgeId: EdgeId;
  from: NailId;
  to: NailId;
  groupId: string;
  /** Full sag path of the step's edge. */
  d: string;
}

export const PlaybackLayer = memo(function PlaybackLayer({
  steps,
  step,
  progress,
  nails,
  edges,
  styles,
}: {
  steps: StepDraw[];
  step: number;
  progress: number;
  nails: NailMap;
  edges: Map<EdgeId, Edge>;
  styles: Map<string, GroupStyle>;
}) {
  const done = Math.max(0, Math.min(step, steps.length));
  const cur = step >= 0 && step < steps.length ? steps[step] : null;
  let current = null;
  if (cur && progress > 0) {
    const e = edges.get(cur.edgeId);
    const a = nails.get(cur.from);
    const b = nails.get(cur.to);
    if (e && a && b) {
      const d = partialSagPath(a, b, e.sag, progress);
      const { x: tx, y: ty } = pointOnSag(a, b, e.sag, progress);
      current = (
        <g data-playback="current">
          <Strand d={d} st={styles.get(e.groupId) ?? FALLBACK} />
          <g transform={`translate(${tx} ${ty})`}>
            <g className={s.needleScale}>
              <circle r={9} className={s.needleGlow} />
              <circle r={3.5} className={s.needle} />
            </g>
          </g>
        </g>
      );
    }
  }
  return (
    <g data-layer="playback" pointerEvents="none">
      {steps.slice(0, done).map((st) => (
        <Strand key={st.index} d={st.d} st={styles.get(st.groupId) ?? FALLBACK} data={{ 'data-playback': 'done' }} />
      ))}
      {current}
    </g>
  );
});
