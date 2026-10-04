import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DesignActions } from '@/contracts/actions';
import type { Layer, LayerId, StrandGroup } from '@/contracts/design';
import { Icon } from './icons';
import { IconButton, cx } from './ui';
import s from './panels.module.css';

export type LayerActions = Pick<DesignActions, 'updateLayer' | 'removeLayer' | 'moveLayer' | 'duplicateLayer' | 'bakeLayer'>;

export interface LayersPanelProps {
  /** Bottom → top, as stored. Displayed top-first. */
  layers: Layer[];
  groups: StrandGroup[];
  selectedId: LayerId | null;
  onSelect: (id: LayerId | null) => void;
  actions: LayerActions;
  /** Generator label per layer (for the subtitle). */
  describe?: (layer: Layer) => string;
  /** Edge count per layer id. */
  counts?: Record<LayerId, number>;
}

interface DragState {
  id: LayerId;
  pointerId: number;
  /** Target index in display order (0 = top). */
  over: number;
}

/** Layer list: swatch, rename, visibility, lock, duplicate, bake, delete, drag to reorder. */
export function LayersPanel({ layers, groups, selectedId, onSelect, actions, describe, counts }: LayersPanelProps) {
  const display = [...layers].reverse();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const indexAt = (clientY: number) => {
    const items = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-layer-row]')) : [];
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return Math.max(0, items.length - 1);
  };

  const onGripDown = (e: ReactPointerEvent, id: LayerId, displayIndex: number) => {
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers */
    }
    setDrag({ id, pointerId: e.pointerId, over: displayIndex });
  };
  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const over = indexAt(e.clientY);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onGripUp = (e: ReactPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const from = display.findIndex((l) => l.id === drag.id);
    if (from >= 0 && drag.over !== from) actions.moveLayer(drag.id, layers.length - 1 - drag.over);
    setDrag(null);
  };

  const moveBy = (id: LayerId, delta: number) => {
    const i = layers.findIndex((l) => l.id === id);
    if (i >= 0) actions.moveLayer(id, i + delta);
  };

  if (!layers.length) {
    return <p className={s.empty}>No patterns yet. Add one from the list, or press Surprise me.</p>;
  }

  return (
    <ul className={s.layerList} ref={listRef} aria-label="Layers">
      {display.map((layer, i) => {
        const g = groupById.get(layer.groupId);
        const selected = layer.id === selectedId;
        const dragging = drag?.id === layer.id;
        const dropBefore = drag && !dragging && drag.over === i && display.findIndex((l) => l.id === drag.id) > i;
        const dropAfter = drag && !dragging && drag.over === i && display.findIndex((l) => l.id === drag.id) < i;
        return (
          <li
            key={layer.id}
            data-layer-row
            className={cx(
              s.layerRow,
              selected && s.layerSelected,
              !layer.visible && s.layerHidden,
              dragging && s.layerDragging,
              dropBefore && s.dropBefore,
              dropAfter && s.dropAfter,
            )}
            onClick={() => onSelect(layer.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(layer.id);
              } else if (e.altKey && e.key === 'ArrowUp') moveBy(layer.id, 1);
              else if (e.altKey && e.key === 'ArrowDown') moveBy(layer.id, -1);
            }}
            tabIndex={0}
            aria-current={selected || undefined}
          >
            <span
              className={s.grip}
              title="Drag to reorder (Alt+↑/↓)"
              onPointerDown={(e) => onGripDown(e, layer.id, i)}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={() => setDrag(null)}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="grip" size={14} />
            </span>
            <span className={s.layerSwatch} style={{ background: g?.color ?? 'var(--border)' }} title={g?.name} />
            <span className={s.layerText}>
              <LayerName layer={layer} onRename={(name) => actions.updateLayer(layer.id, { name })} />
              <span className={s.layerSub}>
                {describe?.(layer) ?? layer.generatorId}
                {counts?.[layer.id] !== undefined && ` · ${counts[layer.id]} strands`}
              </span>
            </span>
            <span className={s.layerTools} onClick={(e) => e.stopPropagation()}>
              <IconButton
                small
                icon={layer.visible ? 'eye' : 'eyeOff'}
                label={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={() => actions.updateLayer(layer.id, { visible: !layer.visible })}
                className={cx(!layer.visible && s.toolOn)}
              />
              <IconButton
                small
                icon={layer.locked ? 'lock' : 'unlock'}
                label={layer.locked ? 'Unlock layer' : 'Lock layer'}
                pressed={layer.locked}
                onClick={() => actions.updateLayer(layer.id, { locked: !layer.locked })}
                className={cx(!layer.locked && s.hoverOnly)}
              />
              <IconButton small icon="copy" label="Duplicate layer" className={s.hoverOnly} onClick={() => onSelect(actions.duplicateLayer(layer.id) || layer.id)} />
              <IconButton small icon="bake" label="Bake into editable nails" className={s.hoverOnly} onClick={() => actions.bakeLayer(layer.id)} />
              <IconButton
                small
                icon="trash"
                label="Delete layer"
                className={s.hoverOnly}
                onClick={() => {
                  if (selected) onSelect(null);
                  actions.removeLayer(layer.id);
                }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LayerName({ layer, onRename }: { layer: Layer; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <span
        className={s.layerName}
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {layer.name}
      </span>
    );
  }
  return (
    <input
      className={s.layerNameInput}
      defaultValue={layer.name}
      aria-label="Layer name"
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== layer.name) onRename(v);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
