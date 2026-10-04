import { useMemo } from 'react';
import type { CutListProps } from '@/contracts/ui';
import { nailLabels } from '@/lib/labels';
import { formatTwine } from '@/lib/units';
import { clothespinCount, formatBuyable, groupTotals, nailSpares } from './shopping';
import styles from './build.module.css';

/** Twine cut list per run, per-group totals and a shopping list. Print-friendly. */
export function CutList({ resolved, plan, report }: CutListProps) {
  const units = resolved.wall.units;
  const labels = useMemo(() => nailLabels(resolved.nails), [resolved.nails]);
  const groups = new Map(resolved.groups.map((g) => [g.id, g]));
  const totals = groupTotals(resolved, plan);
  const nails = resolved.nails.length;
  const spares = nailSpares(nails);
  const pins = clothespinCount(resolved, report);
  const swatch = (color?: string) => <span className={styles.swatch} style={{ background: color }} />;

  return (
    <section className={`${styles.cutList} ${styles.printable}`} aria-label="Cut list">
      <h2 className={styles.h2}>Cut list</h2>
      <p className={styles.muted}>
        Cut lengths already include tails for tying, a little extra for each wrap, and a waste allowance.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Twine</th>
              <th>Nails visited</th>
              <th className={styles.num}>Strung length</th>
              <th className={styles.num}>Cut</th>
            </tr>
          </thead>
          <tbody>
            {plan.runs.map((r, i) => {
              const g = groups.get(r.groupId);
              return (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td className={styles.nowrap}>
                    {swatch(g?.color)}
                    {g?.name ?? r.groupId}
                  </td>
                  <td>
                    {r.nails.length}
                    <div className={styles.seq}>{r.nails.map((n) => `#${labels[n]}`).join(' → ')}</div>
                  </td>
                  <td className={styles.num}>{formatTwine(r.rawLength, units)}</td>
                  <td className={`${styles.num} ${styles.strong}`}>{formatTwine(r.cutLength, units)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {totals.map((t) => {
              const g = groups.get(t.groupId);
              return (
                <tr key={t.groupId} data-testid={`group-total-${t.groupId}`}>
                  <td />
                  <td className={styles.nowrap}>
                    {swatch(g?.color)}
                    {g?.name ?? t.groupId} total
                  </td>
                  <td>
                    {t.runs} piece{t.runs === 1 ? '' : 's'}
                  </td>
                  <td className={styles.num}>{formatTwine(t.raw, units)}</td>
                  <td className={`${styles.num} ${styles.strong}`} data-testid="group-cut">
                    {formatTwine(t.cut, units)}
                  </td>
                </tr>
              );
            })}
            <tr className={styles.grand}>
              <td />
              <td>All twine</td>
              <td>
                {plan.totals.runs} piece{plan.totals.runs === 1 ? '' : 's'}
              </td>
              <td />
              <td className={styles.num} data-testid="total-cut">
                {formatTwine(plan.totals.cutLength, units)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className={styles.h2}>Shopping list</h2>
      <ul className={styles.shop}>
        {totals.map((t) => {
          const g = groups.get(t.groupId);
          return (
            <li key={t.groupId}>
              <input type="checkbox" aria-label={`Got ${g?.name ?? 'twine'}`} />
              <span>
                {swatch(g?.color)}
                <strong>{g?.name ?? t.groupId}</strong>: {formatBuyable(t.cut, units)}
                <span className={styles.muted}> (you need {formatTwine(t.cut, units)})</span>
              </span>
            </li>
          );
        })}
        <li>
          <input type="checkbox" aria-label="Got nails" />
          <span>
            <strong data-testid="nail-count">{nails + spares} nails</strong>
            <span className={styles.muted}>
              {' '}
              ({nails} + {spares} spare)
            </span>
            <br />
            Small finishing nails or brads, about {units === 'in' ? '1 in' : '25 mm'} long. Choose ones with a small head:
            the head is what keeps the twine from slipping off. Leave about {units === 'in' ? '1/2 in' : '12 mm'} standing
            out from the wall.
          </span>
        </li>
        <li>
          <input type="checkbox" aria-label="Got clothespins" />
          <span>
            <strong data-testid="pin-count">
              {pins} mini clothespin{pins === 1 ? '' : 's'}
            </strong>
            <span className={styles.muted}>{report ? ' (one per photo slot)' : ' (one per placed photo)'}</span>
          </span>
        </li>
        <li className={styles.optional}>
          <span className={styles.muted}>Handy to have:</span> a level, a tape measure, painter's tape, a pencil and a
          small hammer.
        </li>
      </ul>
      <button type="button" className={`${styles.btn} ${styles.noPrint}`} onClick={() => window.print()}>
        Print
      </button>
    </section>
  );
}
