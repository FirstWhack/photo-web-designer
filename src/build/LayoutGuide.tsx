import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ResolvedDesign } from '@/contracts/design';
import type { MeasureOrigin } from '@/contracts/ui';
import { coordRows } from './coords';
import {
  DATUM_WORDS,
  buildItems,
  checkMeasurement,
  checkTolerance,
  clusterTolerance,
  formatLength,
  markOrder,
  parseLength,
  type LayoutItem,
  type MarkOrder,
} from './layout';
import styles from './build.module.css';
import ls from './layout.module.css';

export interface LayoutGuideProps {
  resolved: ResolvedDesign;
  /** The datum corner every mark is measured from. */
  origin: MeasureOrigin;
  /** localStorage key for remembering progress. */
  storageKey?: string;
}

interface Saved {
  sig: string;
  index: number;
  skipped: string[];
  inputs: Record<number, string>;
}

const ORDERS: { value: MarkOrder; label: string }[] = [
  { value: 'rows', label: 'Row by row' },
  { value: 'columns', label: 'Column by column' },
  { value: 'number', label: 'By nail number' },
];

function read<T>(key: string | undefined): T | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string | undefined, value: unknown) {
  if (!key) return;
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: progress just isn't remembered */
  }
}

/** Marks nails on the wall one at a time, always measured from the datum corner. */
export function LayoutGuide(props: LayoutGuideProps) {
  const orderKey = props.storageKey ? `${props.storageKey}:order` : undefined;
  const [by, setBy] = useState<MarkOrder>(() => read<MarkOrder>(orderKey) ?? 'rows');
  const choose = (v: MarkOrder) => {
    write(orderKey, v);
    setBy(v);
  };
  const rows = useMemo(() => coordRows(props.resolved, props.origin), [props.resolved, props.origin]);
  const sig = useMemo(() => `${props.origin}|${by}|` + rows.map((r) => `${r.id}:${r.x.toFixed(3)},${r.y.toFixed(3)}`).join(';'), [rows, props.origin, by]);
  return <LayoutInner key={`${props.storageKey ?? ''}::${sig}`} {...props} rows={rows} by={by} onOrder={choose} sig={sig} />;
}

function LayoutInner({
  resolved,
  origin,
  storageKey,
  rows,
  by,
  onOrder,
  sig,
}: LayoutGuideProps & { rows: ReturnType<typeof coordRows>; by: MarkOrder; onOrder: (v: MarkOrder) => void; sig: string }) {
  const { wall } = resolved;
  const units = wall.units;
  const tol = checkTolerance(units);
  const items = useMemo<LayoutItem[]>(() => buildItems(markOrder(rows, by, clusterTolerance(units))), [rows, by, units]);
  const nailCount = rows.length;
  // Screen 0 is the datum briefing, the last is the summary.
  const last = items.length + 1;

  const saved = useMemo(() => {
    const s = read<Saved>(storageKey);
    return s && s.sig === sig ? s : null;
  }, [storageKey, sig]);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(last, saved?.index ?? 0)));
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set(saved?.skipped ?? []));
  const [inputs, setInputs] = useState<Record<number, string>>(() => saved?.inputs ?? {});
  const [wallW, setWallW] = useState('');
  const [wallH, setWallH] = useState('');

  useEffect(() => write(storageKey, { sig, index, skipped: [...skipped], inputs } satisfies Saved), [storageKey, sig, index, skipped, inputs]);

  const next = useCallback(() => setIndex((i) => Math.min(last, i + 1)), [last]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const skip = () => {
    const it = items[index - 1];
    if (it?.kind === 'nail') setSkipped((s) => new Set(s).add(it.row.id));
    next();
  };
  const mark = () => {
    const it = items[index - 1];
    if (it?.kind === 'nail') {
      setSkipped((s) => {
        if (!s.has(it.row.id)) return s;
        const n = new Set(s);
        n.delete(it.row.id);
        return n;
      });
    }
    next();
  };
  const reset = () => {
    write(storageKey, null);
    setIndex(0);
    setSkipped(new Set());
    setInputs({});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (items[index - 1]?.kind === 'nail') mark();
        else next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!nailCount) {
    return (
      <section className={styles.walk}>
        <p className={styles.empty}>No nails to mark yet: add a pattern or some nails first.</p>
      </section>
    );
  }

  const words = DATUM_WORDS[origin];
  const item = index >= 1 && index <= items.length ? items[index - 1] : null;
  const nailsDone = items.slice(0, Math.max(0, index - 1)).filter((i) => i.kind === 'nail').length;
  const markedIds = new Set<string>();
  items.slice(0, Math.max(0, index - 1)).forEach((i) => {
    if (i.kind === 'nail' && !skipped.has(i.row.id)) markedIds.add(i.row.id);
  });
  const doneCount = index > items.length ? nailCount : nailsDone;
  const pct = (doneCount / nailCount) * 100;
  const current = item?.kind === 'nail' ? item.row : null;
  const nailNo = current ? items.slice(0, index).filter((i) => i.kind === 'nail').length : 0;

  let card;
  if (index === 0) {
    const dw = parseLength(wallW);
    const dh = parseLength(wallH);
    const offW = dw != null && Math.abs(dw - wall.width) > tol;
    const offH = dh != null && Math.abs(dh - wall.height) > tol;
    card = (
      <>
        <div className={styles.cardKicker}>Before you start</div>
        <p className={styles.cardMain}>Measure everything from the {words.corner} corner</p>
        <p className={styles.cardHint}>
          Every mark is measured from that corner of the wall, never from the previous nail, so a slip can&rsquo;t carry over. Use a level or
          plumb line to keep your tape straight. Mark lightly in pencil, and nail once the marks look right.
        </p>
        <fieldset className={ls.set}>
          <legend className={ls.legend}>Order</legend>
          {ORDERS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`${ls.pill} ${by === o.value ? ls.pillOn : ''}`}
              aria-pressed={by === o.value}
              onClick={() => onOrder(o.value)}
            >
              {o.label}
            </button>
          ))}
        </fieldset>
        <div className={ls.set}>
          <span className={ls.legend}>
            Recommended: check your wall is {formatLength(wall.width, units)} × {formatLength(wall.height, units)}
          </span>
          <label className={ls.field}>
            Width
            <input value={wallW} onChange={(e) => setWallW(e.target.value)} inputMode="decimal" placeholder={formatLength(wall.width, units)} />
          </label>
          <label className={ls.field}>
            Height
            <input value={wallH} onChange={(e) => setWallH(e.target.value)} inputMode="decimal" placeholder={formatLength(wall.height, units)} />
          </label>
        </div>
        {(offW || offH) && (
          <div className={styles.chipWarn} role="note">
            Your wall doesn&rsquo;t match the setup ({offW && `width is ${formatLength(dw!, units)}`}
            {offW && offH && ', '}
            {offH && `height is ${formatLength(dh!, units)}`}). Fix it in Wall setup before marking, or every mark will be off.
          </div>
        )}
      </>
    );
  } else if (item?.kind === 'nail') {
    card = (
      <>
        <div className={styles.cardKicker}>
          Nail #{item.row.label} · {nailNo} of {nailCount}
        </div>
        <div className={ls.readout} data-testid="readout">
          <div>
            <span className={ls.readoutVal}>{formatLength(item.row.x, units)}</span>
            <span className={ls.readoutAxis}>across, {words.across}</span>
          </div>
          <div>
            <span className={ls.readoutVal}>{formatLength(item.row.y, units)}</span>
            <span className={ls.readoutAxis}>{words.down}</span>
          </div>
        </div>
        <p className={styles.cardHint}>
          {item.row.x.toFixed(2)} × {item.row.y.toFixed(2)} {units}. Mark where the two measurements cross.
        </p>
      </>
    );
  } else if (item?.kind === 'check') {
    const typed = inputs[index] ?? '';
    const measured = parseLength(typed);
    const result = measured == null ? null : checkMeasurement(measured, item.distance, tol);
    card = (
      <>
        <div className={styles.cardKicker}>Quick check (recommended)</div>
        <p className={styles.cardMain}>
          Measure from nail #{item.a.label} to nail #{item.b.label}
        </p>
        <p className={styles.cardHint}>
          It should be <strong>{formatLength(item.distance, units)}</strong> straight line, centre to centre. This catches a mark that drifted.
        </p>
        <label className={ls.field}>
          You measured
          <input
            value={typed}
            onChange={(e) => setInputs((m) => ({ ...m, [index]: e.target.value }))}
            inputMode="decimal"
            placeholder={formatLength(item.distance, units)}
            aria-label="Measured distance"
          />
        </label>
        {result && (
          <div className={result.ok ? ls.checkOk : styles.chipWarn} role="status">
            {result.ok
              ? `Matches (off by ${formatLength(Math.abs(result.diff), units)}).`
              : `Off by ${formatLength(Math.abs(result.diff), units)}. Re-measure #${item.a.label} and #${item.b.label} from the ${words.corner} corner before going on.`}
          </div>
        )}
      </>
    );
  } else {
    const checks = items.map((it, i) => ({ it, i })).filter((x): x is { it: Extract<LayoutItem, { kind: 'check' }>; i: number } => x.it.kind === 'check');
    const results = checks.map(({ it, i }) => {
      const m = parseLength(inputs[i + 1] ?? '');
      return m == null ? 'skipped' : checkMeasurement(m, it.distance, tol).ok ? 'ok' : 'off';
    });
    const skippedLabels = rows.filter((r) => skipped.has(r.id)).map((r) => `#${r.label}`);
    card = (
      <>
        <div className={styles.cardKicker}>Finished</div>
        <p className={styles.cardMain} data-testid="summary">
          {nailCount - skipped.size} of {nailCount} nails marked
        </p>
        <p className={styles.cardHint}>
          {skippedLabels.length > 0 && <>Skipped: {skippedLabels.join(', ')}. </>}
          {checks.length > 0 && (
            <>
              Checks: {results.filter((r) => r === 'ok').length} matched, {results.filter((r) => r === 'off').length} off,{' '}
              {results.filter((r) => r === 'skipped').length} skipped.{' '}
            </>
          )}
          Nail through your marks, then switch to the String twine tab.
        </p>
      </>
    );
  }

  return (
    <section className={styles.walk} aria-label="Guided layout">
      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={nailCount} aria-valuenow={doneCount} aria-label="Nails marked">
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.progressText}>
        {doneCount} of {nailCount} nails marked
      </div>

      <div className={`${styles.card} ${index > items.length ? styles.cardDone : ''}`} aria-live="polite">
        {card}
      </div>

      <nav className={styles.nav}>
        <button type="button" className={styles.navBtn} onClick={back} disabled={index === 0}>
          ← Back
        </button>
        {item?.kind === 'nail' ? (
          <button type="button" className={`${styles.navBtn} ${styles.navNext}`} onClick={mark}>
            Marked ✓
          </button>
        ) : (
          <button type="button" className={`${styles.navBtn} ${styles.navNext}`} onClick={next} disabled={index >= last}>
            {index === 0 ? 'Start marking →' : item ? (inputs[index] ? 'Continue →' : 'Skip check →') : 'Next →'}
          </button>
        )}
      </nav>

      <LayoutMap resolved={resolved} origin={origin} marked={markedIds} current={current?.id} rows={rows} />

      <footer className={styles.walkFoot}>
        {item?.kind === 'nail' && (
          <button type="button" className={styles.linkBtn} onClick={skip}>
            Skip this nail
          </button>
        )}
        <button type="button" className={styles.linkBtn} onClick={reset}>
          Reset progress
        </button>
        <span className={styles.keysHint}>Keys: Enter = marked, ← back</span>
      </footer>
    </section>
  );
}

/** The wall with the datum corner flagged, finished nails filled and the current one crosshaired. */
function LayoutMap({
  resolved,
  origin,
  marked,
  current,
  rows,
}: {
  resolved: ResolvedDesign;
  origin: MeasureOrigin;
  marked: Set<string>;
  current?: string;
  rows: ReturnType<typeof coordRows>;
}) {
  const { wall } = resolved;
  const pad = Math.max(wall.width, wall.height) * 0.04;
  const unit = Math.max(wall.width, wall.height) / 100;
  const nails = new Map(resolved.nails.map((n) => [n.id, n]));
  const labelOf = new Map(rows.map((r) => [r.id, r.label]));
  const dx = origin.endsWith('left') ? 0 : wall.width;
  const dy = origin.startsWith('top') ? 0 : wall.height;
  const cur = current ? nails.get(current) : undefined;

  return (
    <svg
      className={`${styles.minimap} ${styles.walkMap}`}
      viewBox={`${-pad} ${-pad} ${wall.width + 2 * pad} ${wall.height + 2 * pad}`}
      role="img"
      aria-label="Wall layout progress"
    >
      <rect x={0} y={0} width={wall.width} height={wall.height} className={styles.mapWall} />
      {cur && (
        <g className={ls.guide}>
          <line x1={dx} y1={cur.y} x2={cur.x} y2={cur.y} vectorEffect="non-scaling-stroke" />
          <line x1={cur.x} y1={dy} x2={cur.x} y2={cur.y} vectorEffect="non-scaling-stroke" />
        </g>
      )}
      <circle cx={dx} cy={dy} r={unit * 2.2} className={ls.datum} />
      <text x={dx + (dx === 0 ? 1 : -1) * unit * 3.4} y={dy + (dy === 0 ? 1 : -1) * unit * 4.4} fontSize={unit * 3} textAnchor={dx === 0 ? 'start' : 'end'} className={styles.mapLabelHot}>
        datum
      </text>
      {resolved.nails.map((n) => {
        const isCur = n.id === current;
        return (
          <g key={n.id}>
            {isCur && <circle cx={n.x} cy={n.y} r={unit * 2.4} className={styles.mapRing} vectorEffect="non-scaling-stroke" />}
            <circle cx={n.x} cy={n.y} r={unit * (isCur ? 1 : 0.8)} className={marked.has(n.id) ? ls.nailDone : isCur ? ls.nailNow : ls.nailTodo} />
            {isCur && (
              <text x={n.x + unit * 2.8} y={n.y - unit * 2.8} fontSize={unit * 4} className={styles.mapLabelHot}>
                {labelOf.get(n.id)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
