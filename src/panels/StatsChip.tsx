import { Icon } from './icons';
import s from './panels.module.css';

export interface StatsChipProps {
  wall: string;
  nails: number;
  runs: number;
  twine: string;
  photoSlots: number;
  issues: number;
  severity?: 'info' | 'warn' | 'error';
  onIssues?: () => void;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Always-visible summary: wall size, nails, pieces of twine, twine total, photo slots, issues. */
export function StatsChip({ wall, nails, runs, twine, photoSlots, issues, severity = 'warn', onIssues }: StatsChipProps) {
  return (
    <div className={s.stats} data-testid="stats-chip">
      <span className={s.statWall} title="Wall area">
        <Icon name="wall" size={13} />
        {wall}
      </span>
      <span className={s.statSep} />
      <span data-stat="nails">{plural(nails, 'nail')}</span>
      <span className={s.dot}>·</span>
      <span data-stat="runs">{plural(runs, 'piece')} of twine</span>
      <span className={s.dot}>·</span>
      <span data-stat="twine">{twine}</span>
      <span className={s.dot}>·</span>
      <span data-stat="slots">{plural(photoSlots, 'photo slot')}</span>
      {issues > 0 && (
        <button
          type="button"
          className={s.statIssues}
          data-severity={severity}
          onClick={onIssues}
          title="Show issues in Refine"
          aria-label={`${issues} issues, show in Refine`}
        >
          <Icon name="warn" size={13} />
          {issues}
        </button>
      )}
    </div>
  );
}
