import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EdgeId } from '@/contracts/design';
import type { WalkthroughProps } from '@/contracts/ui';
import { nailLabels } from '@/lib/labels';
import { formatTwine } from '@/lib/units';
import { MiniMap, WrapGlyph } from './MiniMap';
import { buildScreens, planSignature, runStartText, stepText, totalSteps, WRAP_HINT } from './walk';
import styles from './build.module.css';

interface Saved {
  sig: string;
  index: number;
}

function load(key: string | undefined, sig: string, max: number): number {
  if (!key) return 0;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const v = JSON.parse(raw) as Saved;
    return v.sig === sig && Number.isInteger(v.index) ? Math.max(0, Math.min(max, v.index)) : 0;
  } catch {
    return 0;
  }
}

function save(key: string | undefined, value: Saved | null) {
  if (!key) return;
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable: progress just isn't remembered */
  }
}

/** Step-by-step stringing guide, used standing at the wall. */
export function Walkthrough(props: WalkthroughProps) {
  const sig = useMemo(() => planSignature(props.plan), [props.plan]);
  return <WalkthroughInner key={`${props.storageKey ?? ''}::${sig}`} {...props} sig={sig} />;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

function useWakeLock(enabled: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!enabled || !wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let alive = true;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      wl.request('screen')
        .then((s) => {
          if (alive) sentinel = s;
          else void s.release();
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}

function WalkthroughInner({ resolved, plan, storageKey, sig }: WalkthroughProps & { sig: string }) {
  const screens = useMemo(() => buildScreens(plan), [plan]);
  const total = totalSteps(plan);
  const labels = useMemo(() => nailLabels(resolved.nails), [resolved.nails]);
  const groups = useMemo(() => new Map(resolved.groups.map((g) => [g.id, g])), [resolved.groups]);
  const units = resolved.wall.units;
  const [index, setIndex] = useState(() => load(storageKey, sig, screens.length - 1));
  const [wake, setWake] = useState(false);
  const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  useWakeLock(wake);

  useEffect(() => save(storageKey, { sig, index }), [storageKey, sig, index]);

  const last = screens.length - 1;
  const next = useCallback(() => setIndex((i) => Math.min(last, i + 1)), [last]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const reset = () => {
    save(storageKey, null);
    setIndex(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      // Let focused buttons handle their own Space/Enter activation.
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back]);

  const screen = screens[Math.min(index, last)];

  // Done edges = every step before the current global position.
  const { done, current, ring } = useMemo(() => {
    const done = new Set<EdgeId>();
    let current: EdgeId | undefined;
    let ring: string[] = [];
    if (!screen) return { done, current, ring };
    let g = 0;
    for (const run of plan.runs) {
      for (const s of run.steps) {
        if (g < screen.global) done.add(s.edgeId);
        g++;
      }
    }
    if (screen.kind === 'step') {
      const s = plan.runs[screen.run].steps[screen.step];
      current = s.edgeId;
      ring = [s.from, s.to];
    } else if (screen.kind === 'start') {
      ring = [plan.runs[screen.run].nails[0]];
    } else if (screen.kind === 'complete') {
      const r = plan.runs[screen.run];
      ring = [r.nails[r.nails.length - 1]];
    }
    return { done, current, ring };
  }, [plan, screen]);

  if (!screen) {
    return (
      <section className={styles.walk}>
        <p className={styles.empty}>Nothing to string yet: add some twine to your design first.</p>
      </section>
    );
  }

  const runIdx = screen.kind === 'done' ? plan.runs.length - 1 : screen.run;
  const run = plan.runs[runIdx];
  const group = groups.get(run.groupId);
  const stepsDone = screen.kind === 'done' ? total : screen.global;
  const pct = total ? (stepsDone / total) * 100 : 0;

  let card: ReactNode;
  if (screen.kind === 'start') {
    card = (
      <>
        <div className={styles.cardKicker}>Start piece {screen.run + 1}</div>
        <p className={styles.cardMain} data-testid="instruction">
          {runStartText(run, group, labels, units)}
        </p>
        <p className={styles.cardHint}>
          Knot it firmly around nail #{labels[run.nails[0]]}, leaving a short tail. {run.steps.length} stretch
          {run.steps.length === 1 ? '' : 'es'} in this piece.
        </p>
      </>
    );
  } else if (screen.kind === 'step') {
    const s = run.steps[screen.step];
    card = (
      <>
        <div className={styles.cardKicker}>
          Step {screen.global + 1} of {total}
        </div>
        <div className={styles.stepRow}>
          <WrapGlyph wrap={s.wrap} />
          <p className={styles.cardMain} data-testid="instruction">
            {stepText(s, labels)}
          </p>
        </div>
        {s.hairpin && (
          <div className={styles.chipWarn} role="note">
            Hairpin turn: the twine nearly doubles back here. Wrap firmly so it can't slip off.
          </div>
        )}
        <p className={styles.cardHint}>{WRAP_HINT[s.wrap]}</p>
      </>
    );
  } else if (screen.kind === 'complete') {
    const nr = plan.runs[screen.run + 1];
    const ng = groups.get(nr.groupId);
    card = (
      <>
        <div className={styles.cardKicker}>Nice work</div>
        <p className={styles.cardMain} data-testid="instruction">
          Run {screen.run + 1} complete
        </p>
        <p className={styles.cardHint}>
          Next up: piece {screen.run + 2} of {plan.runs.length}, {formatTwine(nr.cutLength, units)} of {ng?.name ?? 'twine'}.
        </p>
      </>
    );
  } else {
    card = (
      <>
        <div className={styles.cardKicker}>Finished</div>
        <p className={styles.cardMain} data-testid="instruction">
          All done! Your web is strung.
        </p>
        <p className={styles.cardHint}>Time to clip up the photos.</p>
      </>
    );
  }

  return (
    <section className={styles.walk} aria-label="Stringing walkthrough">
      <header className={styles.walkHead}>
        <div className={styles.walkRun} data-testid="run-header">
          Run {runIdx + 1} of {plan.runs.length}
        </div>
        <div className={styles.walkGroup}>
          <span className={styles.swatch} style={{ background: group?.color }} />
          {group?.name ?? 'Twine'}
        </div>
        <div className={styles.walkCut}>
          cut <strong>{formatTwine(run.cutLength, units)}</strong>
        </div>
      </header>

      <div
        className={styles.progress}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={stepsDone}
        aria-label="Steps done"
      >
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.progressText}>
        {stepsDone} of {total} stretches done
      </div>

      <div className={`${styles.card} ${screen.kind === 'complete' || screen.kind === 'done' ? styles.cardDone : ''}`} aria-live="polite">
        {card}
      </div>

      <MiniMap resolved={resolved} labels={labels} done={done} current={current} ring={ring} className={styles.walkMap} />

      <nav className={styles.nav}>
        <button type="button" className={styles.navBtn} onClick={back} disabled={index === 0}>
          ← Back
        </button>
        <button type="button" className={`${styles.navBtn} ${styles.navNext}`} onClick={next} disabled={index >= last}>
          {screen.kind === 'complete' ? 'Start next piece →' : 'Next →'}
        </button>
      </nav>

      <footer className={styles.walkFoot}>
        <button type="button" className={styles.linkBtn} onClick={reset}>
          Reset progress
        </button>
        {wakeSupported && (
          <label className={styles.wake}>
            <input type="checkbox" checked={wake} onChange={(e) => setWake(e.target.checked)} /> Keep screen awake
          </label>
        )}
        <span className={styles.keysHint}>Keys: ← → / Space / Enter</span>
      </footer>
    </section>
  );
}
