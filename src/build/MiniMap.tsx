import type { EdgeId, NailId, ResolvedDesign } from '@/contracts/design';
import type { WrapAction } from '@/contracts/plan';
import { sagPath } from '@/lib/geom';
import styles from './build.module.css';

export interface MiniMapProps {
  resolved: ResolvedDesign;
  labels: Record<NailId, string>;
  done?: Set<EdgeId>;
  current?: EdgeId;
  ring?: NailId[];
  /** Draw every edge at full strength (no progress state). */
  plain?: boolean;
  className?: string;
}

/** Small read-only SVG of the whole design. */
export function MiniMap({ resolved, labels, done, current, ring = [], plain, className }: MiniMapProps) {
  const { wall } = resolved;
  const pad = Math.max(wall.width, wall.height) * 0.04;
  const unit = Math.max(wall.width, wall.height) / 100;
  const nails = new Map(resolved.nails.map((n) => [n.id, n]));
  const color = new Map(resolved.groups.map((g) => [g.id, g.color]));
  const cur = resolved.edges.find((e) => e.id === current);
  const ringed = new Set(ring);

  return (
    <svg
      className={`${styles.minimap} ${className ?? ''}`}
      viewBox={`${-pad} ${-pad} ${wall.width + 2 * pad} ${wall.height + 2 * pad}`}
      role="img"
      aria-label="Design overview"
    >
      <rect x={0} y={0} width={wall.width} height={wall.height} className={styles.mapWall} />
      {resolved.edges.map((e) => {
        if (e.id === current) return null;
        const a = nails.get(e.a);
        const b = nails.get(e.b);
        if (!a || !b) return null;
        const isDone = plain || done?.has(e.id);
        return (
          <path
            key={e.id}
            d={sagPath(a, b, e.sag)}
            fill="none"
            stroke={color.get(e.groupId) ?? 'currentColor'}
            strokeWidth={isDone ? 2.5 : 1.5}
            strokeOpacity={isDone ? 1 : 0.22}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            data-state={isDone ? 'done' : 'todo'}
          />
        );
      })}
      {cur && nails.get(cur.a) && nails.get(cur.b) && (
        <>
          <path
            d={sagPath(nails.get(cur.a)!, nails.get(cur.b)!, cur.sag)}
            fill="none"
            className={styles.mapCurrentGlow}
            strokeWidth={9}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={sagPath(nails.get(cur.a)!, nails.get(cur.b)!, cur.sag)}
            fill="none"
            stroke={color.get(cur.groupId) ?? 'currentColor'}
            strokeWidth={3.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            data-state="current"
          />
        </>
      )}
      {resolved.nails.map((n) => (
        <g key={n.id}>
          {ringed.has(n.id) && <circle cx={n.x} cy={n.y} r={unit * 2.4} className={styles.mapRing} vectorEffect="non-scaling-stroke" />}
          <circle cx={n.x} cy={n.y} r={unit * 0.8} className={styles.mapNail} />
          <text
            x={n.x + unit * (ringed.has(n.id) ? 2.8 : 1.4)}
            y={n.y - unit * (ringed.has(n.id) ? 2.8 : 1.4)}
            fontSize={unit * (ringed.has(n.id) ? 4 : 2.8)}
            className={ringed.has(n.id) ? styles.mapLabelHot : styles.mapLabel}
          >
            {labels[n.id]}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Big arrow glyph showing which way to wrap the twine around the nail. */
export function WrapGlyph({ wrap, size = 72 }: { wrap: WrapAction; size?: number }) {
  const common = { width: size, height: size, viewBox: '-50 -50 100 100', className: styles.glyph, 'aria-hidden': true } as const;
  if (wrap === 'pass') {
    return (
      <svg {...common}>
        <circle r={7} className={styles.glyphNail} />
        <path d="M-42 12 L36 12" className={styles.glyphStroke} />
        <path d="M24 0 L40 12 L24 24" className={styles.glyphStroke} />
      </svg>
    );
  }
  if (wrap === 'tie-off') {
    return (
      <svg {...common}>
        <circle r={7} className={styles.glyphNail} />
        <path d="M-40 18 C-20 18 -16 -14 0 -14 C16 -14 18 14 4 14 C-8 14 -6 -2 6 -4 L40 -30" className={styles.glyphStroke} />
        <circle cx={6} cy={-4} r={5} className={styles.glyphKnot} />
      </svg>
    );
  }
  // 270° arc starting below the nail. In y-down SVG, sweep-flag 1 is clockwise on screen.
  const cw = wrap === 'cw';
  const d = cw ? 'M0 30 A30 30 0 1 1 30 0' : 'M0 30 A30 30 0 1 0 -30 0';
  const head = cw ? 'M19 -8 L30 4 L41 -8' : 'M-41 -8 L-30 4 L-19 -8';
  return (
    <svg {...common} data-wrap={wrap}>
      <circle r={7} className={styles.glyphNail} />
      <path d={d} className={styles.glyphStroke} />
      <path d={head} className={styles.glyphStroke} />
    </svg>
  );
}
