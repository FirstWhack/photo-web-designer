import type { ToolId } from '@/contracts/actions';
import type { GroupId, NailId, StrandGroup, Units } from '@/contracts/design';
import type { Issue } from '@/contracts/plan';
import type { Overlay, PlaybackControls, SnapOptions } from '@/contracts/ui';
import { formatLength } from '@/lib/units';
import { GroupPicker } from './GroupPicker';
import { Icon, type IconName } from './icons';
import { PHOTO_PRESETS } from './sizing';
import { Button, Chip, Chips, Field, IconButton, NumberInput, Range, Segmented, SliderField, Toggle, cx, type GestureProps } from './ui';
import s from './panels.module.css';

// ── tools ─────────────────────────────────────────────

export const TOOLS: { id: ToolId; label: string; key: string; icon: IconName; help: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'pointer', help: 'Click or drag a box to select. Drag nails to move them.' },
  { id: 'add-nail', label: 'Add nail', key: 'N', icon: 'nail', help: 'Click the wall to place a nail.' },
  { id: 'connect', label: 'Connect', key: 'C', icon: 'link', help: 'Click nails in turn to string twine between them. Esc ends the chain.' },
  { id: 'pin', label: 'Pin photo', key: 'P', icon: 'pin', help: 'Click a strand to clip a photo onto it.' },
  { id: 'pan', label: 'Pan', key: 'H', icon: 'hand', help: 'Drag to move around. Scroll to zoom.' },
];

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

export function ToolPalette({ tool, onTool, vertical }: { tool: ToolId; onTool: (t: ToolId) => void; vertical?: boolean }) {
  return (
    <div className={cx(s.toolPalette, vertical && s.toolPaletteV)} role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={s.toolBtn}
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          aria-label={`${t.label} (${t.key})`}
          onClick={() => onTool(t.id)}
        >
          <Icon name={t.icon} size={18} />
          <kbd className={s.kbd}>{t.key}</kbd>
        </button>
      ))}
    </div>
  );
}

export const toolHelp = (tool: ToolId) => TOOLS.find((t) => t.id === tool)?.help ?? '';

// ── view options ──────────────────────────────────────

const OVERLAYS: { value: Overlay; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'issues', label: 'Issues' },
  { value: 'photos', label: 'Photos' },
  { value: 'load', label: 'Load' },
];

export function ViewOptions({
  snap,
  onSnap,
  labels,
  onLabels,
  overlay,
  onOverlay,
  units,
}: {
  snap: SnapOptions;
  onSnap: (s: SnapOptions) => void;
  labels: boolean;
  onLabels: (v: boolean) => void;
  overlay: Overlay;
  onOverlay: (o: Overlay) => void;
  units: Units;
}) {
  return (
    <div className={s.stack}>
      <Toggle label="Snap to grid" checked={snap.grid} onChange={(grid) => onSnap({ ...snap, grid })} />
      {snap.grid && (
        <Field label="Grid size">
          <div className={s.dimInput}>
            <NumberInput
              label="Grid size"
              value={snap.gridSize}
              min={units === 'cm' ? 0.5 : 0.25}
              max={units === 'cm' ? 50 : 24}
              step={units === 'cm' ? 0.5 : 0.25}
              onChange={(gridSize) => onSnap({ ...snap, gridSize })}
            />
            <span className={s.unit}>{units}</span>
          </div>
        </Field>
      )}
      <Toggle label="Align to other nails" checked={snap.nails} onChange={(nails) => onSnap({ ...snap, nails })} />
      <Toggle label="Nail numbers" checked={labels} onChange={onLabels} />
      <Field label="Overlay">
        <Segmented full label="Overlay" value={overlay} options={OVERLAYS} onChange={onOverlay} />
      </Field>
    </div>
  );
}

// ── issues ────────────────────────────────────────────

const SEV_ICON: Record<Issue['severity'], IconName> = { info: 'info', warn: 'warn', error: 'error' };

export function IssuesList({
  issues,
  activeId,
  onPick,
}: {
  issues: Issue[];
  activeId: string | null;
  onPick: (issue: Issue) => void;
}) {
  if (!issues.length) {
    return (
      <div className={s.allGood}>
        <Icon name="check" size={16} /> No issues. This web is ready to build.
      </div>
    );
  }
  return (
    <ul className={s.issueList} aria-label="Issues">
      {issues.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            className={cx(s.issue, activeId === i.id && s.issueActive)}
            data-severity={i.severity}
            onClick={() => onPick(i)}
          >
            <Icon name={SEV_ICON[i.severity]} size={15} />
            <span>{i.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── selection ─────────────────────────────────────────

export function SelectionPanel({
  nails,
  edges,
  pins,
  liveNails,
  sag,
  groupId,
  groups,
  onSag,
  onGroup,
  onBake,
  onDelete,
  onGestureStart,
  onGestureEnd,
}: {
  nails: NailId[];
  edges: number;
  pins: number;
  /** Selected nails that belong to live layers. */
  liveNails: number;
  /** Shared sag of the selected edges (first edge's when mixed). */
  sag: number | null;
  groupId: GroupId | null;
  groups: StrandGroup[];
  onSag: (v: number) => void;
  onGroup: (id: GroupId) => void;
  onBake?: () => void;
  onDelete: () => void;
} & GestureProps) {
  const count = nails.length + edges + pins;
  if (!count) return <p className={s.empty}>Nothing selected. Click a nail or strand, or drag a box around several.</p>;
  const parts = [
    nails.length && `${nails.length} nail${nails.length === 1 ? '' : 's'}`,
    edges && `${edges} strand${edges === 1 ? '' : 's'}`,
    pins && `${pins} photo${pins === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return (
    <div className={s.stack}>
      <div className={s.selSummary}>
        <span>{parts.join(', ')}</span>
        <Button size="small" variant="ghost" icon="trash" onClick={onDelete}>
          Delete
        </Button>
      </div>
      {edges > 0 && sag !== null && (
        <>
          <SliderField
            label="Sag"
            value={sag}
            min={0}
            max={1}
            step={0.01}
            onChange={onSag}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
          <Field label="Twine">
            <GroupPicker groups={groups} value={groupId} onChange={onGroup} />
          </Field>
        </>
      )}
      {liveNails > 0 && (
        <div className={s.bakeHint}>
          <Icon name="bake" size={16} />
          <div>
            <strong>Part of a live pattern.</strong> Moving these nails bakes the pattern into plain nails, so its sliders stop
            working.
            {onBake && (
              <div style={{ marginTop: 8 }}>
                <Button size="small" onClick={onBake}>
                  Bake layer now
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── photos ────────────────────────────────────────────

export function PhotoSettings({
  preset,
  onPreset,
  slots,
  pins,
  onAutoFill,
  onClear,
  units,
  photoWidth,
}: {
  preset: string;
  onPreset: (id: string) => void;
  slots: number;
  pins: number;
  onAutoFill: () => void;
  onClear: () => void;
  units: Units;
  photoWidth: number;
}) {
  return (
    <div className={s.stack}>
      <Field label="Photo size" hint={`Each photo needs about ${formatLength(photoWidth, units)} of fairly level twine.`}>
        <Chips>
          {PHOTO_PRESETS.map((p) => (
            <Chip key={p.id} pressed={preset === p.id} onClick={() => onPreset(p.id)}>
              {p.label}
            </Chip>
          ))}
        </Chips>
      </Field>
      <div className={s.photoStats}>
        <span>
          <strong>{slots}</strong> slots
        </span>
        <span>
          <strong>{pins}</strong> pinned
        </span>
      </div>
      <div className={s.rowTight}>
        <Button icon="photo" onClick={onAutoFill} disabled={slots === 0}>
          Auto-fill photos
        </Button>
        {pins > 0 && (
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ── playback ──────────────────────────────────────────

const SPEEDS = [1, 2, 4, 8, 20, 60];

export function PlaybackBar({ controls, runs, onClose }: { controls: PlaybackControls; runs: number; onClose: () => void }) {
  const st = controls.state;
  return (
    <div className={s.playback} role="group" aria-label="Stringing playback">
      <IconButton icon={st.playing ? 'pause' : 'play'} label={st.playing ? 'Pause' : 'Play'} onClick={controls.toggle} className={s.playBtn} />
      <IconButton small icon="restart" label="Back to start" onClick={controls.reset} />
      <div className={s.playScrub}>
        <Range label="Scrub" value={st.step} min={0} max={Math.max(1, st.totalSteps)} step={1} onChange={controls.seek} />
        <span className={s.playMeta}>
          Step {Math.min(st.step + (st.step < st.totalSteps ? 1 : 0), st.totalSteps)} of {st.totalSteps} · {runs} piece{runs === 1 ? '' : 's'}
        </span>
      </div>
      <select
        className={s.speed}
        value={st.speed}
        aria-label="Speed"
        onChange={(e) => controls.setSpeed(Number(e.target.value))}
      >
        {SPEEDS.map((v) => (
          <option key={v} value={v}>
            {v} steps/s
          </option>
        ))}
      </select>
      <IconButton small icon="close" label="Close playback" onClick={onClose} />
    </div>
  );
}
