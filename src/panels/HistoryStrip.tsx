import type { ResolvedDesign } from '@/contracts/design';
import { Thumbnail } from '@/canvas';
import { Button, cx } from './ui';
import s from './panels.module.css';

export interface HistoryItem {
  id: string;
  resolved: ResolvedDesign;
  label: string;
}

/** Strip of recent variations (newest first). Clicking one brings it back. */
export function HistoryStrip({
  items,
  currentId,
  onPick,
  onKeep,
  canKeep,
}: {
  items: HistoryItem[];
  currentId?: string | null;
  onPick: (id: string) => void;
  onKeep: () => void;
  canKeep: boolean;
}) {
  return (
    <div className={s.history}>
      <div className={s.historyLead}>
        <Button size="small" onClick={onKeep} disabled={!canKeep} title="Save this variation to the strip">
          Keep ✦
        </Button>
        <span className={s.historyHint}>Variations</span>
      </div>
      <div className={s.historyScroll} role="list" aria-label="Recent variations">
        {items.length === 0 && <span className={s.historyEmpty}>Surprises and kept designs land here, so you can always go back.</span>}
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="listitem"
            className={cx(s.historyItem, it.id === currentId && s.historyCurrent)}
            title={it.label}
            aria-label={`Restore ${it.label}`}
            onClick={() => onPick(it.id)}
          >
            <Thumbnail resolved={it.resolved} width={72} />
          </button>
        ))}
      </div>
    </div>
  );
}
