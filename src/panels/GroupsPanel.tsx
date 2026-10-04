import type { DesignActions } from '@/contracts/actions';
import type { GroupId, StrandGroup } from '@/contracts/design';
import { IconButton, Button, cx } from './ui';
import s from './panels.module.css';

export type GroupActions = Pick<DesignActions, 'addGroup' | 'updateGroup' | 'removeGroup' | 'setActiveGroup'>;

const THICKNESS = [1, 1.5, 2, 3, 4, 5];

/** Twine colours: colour, name, thickness; add/remove. The active group is used by the connect tool. */
export function GroupsPanel({
  groups,
  activeGroupId,
  actions,
  usage,
}: {
  groups: StrandGroup[];
  activeGroupId: GroupId;
  actions: GroupActions;
  /** Strand count per group. */
  usage?: Record<GroupId, number>;
}) {
  return (
    <div className={s.stackSm}>
      <ul className={s.groupList} aria-label="Twine colours">
        {groups.map((g) => (
          <li key={g.id} className={cx(s.groupRow, g.id === activeGroupId && s.groupActive)}>
            <label className={s.colorWell} title="Change colour" style={{ background: g.color }}>
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#c8a165'}
                aria-label={`${g.name} colour`}
                onChange={(e) => actions.updateGroup(g.id, { color: e.target.value })}
              />
            </label>
            <div className={s.groupMain}>
              <input
                key={g.id + g.name}
                className={s.groupName}
                defaultValue={g.name}
                aria-label="Twine name"
                onFocus={() => actions.setActiveGroup(g.id)}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== g.name) actions.updateGroup(g.id, { name: v });
                  else e.target.value = g.name;
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <div className={s.groupMeta}>
                <select
                  className={s.thickSelect}
                  value={g.thickness}
                  aria-label={`${g.name} thickness`}
                  onChange={(e) => actions.updateGroup(g.id, { thickness: Number(e.target.value) })}
                >
                  {[...new Set([...THICKNESS, g.thickness])]
                    .sort((a, b) => a - b)
                    .map((t) => (
                      <option key={t} value={t}>
                        {t} mm
                      </option>
                    ))}
                </select>
                {usage && <span>{usage[g.id] ?? 0} strands</span>}
              </div>
            </div>
            <IconButton
              small
              icon="check"
              label={g.id === activeGroupId ? 'Active twine for new strands' : 'Use for new strands'}
              pressed={g.id === activeGroupId}
              onClick={() => actions.setActiveGroup(g.id)}
            />
            <IconButton
              small
              icon="trash"
              label="Remove twine colour"
              disabled={groups.length <= 1}
              onClick={() => actions.removeGroup(g.id)}
            />
          </li>
        ))}
      </ul>
      <Button size="small" icon="plus" onClick={() => actions.setActiveGroup(actions.addGroup())}>
        Add twine colour
      </Button>
    </div>
  );
}
