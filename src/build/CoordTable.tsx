import { useMemo, useState } from 'react';
import type { CoordTableProps } from '@/contracts/ui';
import { formatMeasure } from '@/lib/units';
import { coordCsv, coordRows } from './coords';
import styles from './build.module.css';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Nail positions measured from a chosen wall corner, for marking without the paper template. */
export function CoordTable({ resolved, origin }: CoordTableProps) {
  const units = resolved.wall.units;
  const rows = useMemo(() => coordRows(resolved, origin), [resolved, origin]);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const horiz = origin.endsWith('left') ? 'left' : 'right';
  const vert = origin.startsWith('top') ? 'top' : 'bottom';

  const copy = async () => {
    const ok = await copyText(coordCsv(rows, units, origin));
    setCopied(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section className={`${styles.coords} ${styles.printable}`} aria-label="Nail coordinates">
      <div className={styles.coordsHead}>
        <h2 className={styles.h2}>Nail positions</h2>
        <button type="button" className={`${styles.btn} ${styles.noPrint}`} onClick={copy}>
          {copied === 'ok' ? 'Copied!' : copied === 'fail' ? 'Copy failed' : 'Copy as CSV'}
        </button>
      </div>
      <ol className={styles.howto}>
        <li>
          Mark the <strong>{origin}</strong> corner of your wall area: that's 0, 0.
        </li>
        <li>
          For each nail, measure <strong>x</strong> across from the {horiz} edge, using a level to keep the line straight.
        </li>
        <li>
          From there measure <strong>y</strong> {vert === 'top' ? 'down from the top' : 'up from the bottom'} edge and
          mark the spot with a pencil.
        </li>
        <li>Check the numbers against the walkthrough, then hammer in the nails.</li>
      </ol>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th className={styles.num}>x ({horiz === 'left' ? 'from left' : 'from right'})</th>
              <th className={styles.num}>y ({vert === 'top' ? 'from top' : 'from bottom'})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.strong}>{r.label}</td>
                <td className={styles.num}>{formatMeasure(r.x, units)}</td>
                <td className={styles.num}>{formatMeasure(r.y, units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
