import type { GroupId, StrandGroup } from '@/contracts/design';
import s from './panels.module.css';

/** Twine colour picker: one swatch per group. `value` null = mixed selection. */
export function GroupPicker({
  groups,
  value,
  onChange,
  label = 'Twine',
}: {
  groups: StrandGroup[];
  value: GroupId | null;
  onChange: (id: GroupId) => void;
  label?: string;
}) {
  return (
    <div className={s.groupPicker} role="radiogroup" aria-label={label}>
      {groups.map((g) => (
        <button
          key={g.id}
          type="button"
          role="radio"
          aria-checked={value === g.id}
          className={s.groupOption}
          title={g.name}
          onClick={() => onChange(g.id)}
        >
          <span className={s.swatch} style={{ background: g.color }} />
          <span className={s.groupOptionName}>{g.name}</span>
        </button>
      ))}
    </div>
  );
}
