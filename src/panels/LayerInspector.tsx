import { useState } from 'react';
import type { Layer, LayerTransform, ParamValue, StrandGroup, Wall } from '@/contracts/design';
import type { Generator } from '@/contracts/generator';
import { formatLength } from '@/lib/units';
import { GroupPicker } from './GroupPicker';
import { Icon } from './icons';
import { ParamPanel } from './ParamPanel';
import { visibleParams } from './paramVisibility';
import {
  alignDelta,
  fillWallSize,
  formatSize,
  orient,
  overflow,
  presetSize,
  shapeOf,
  sizeOf,
  sizePresets,
  transformBounds,
  withSize,
  type AlignX,
  type AlignY,
  type Bounds,
  type Shape,
  type Size,
} from './sizing';
import { Button, Chip, Chips, Field, IconButton, NumberInput, Range, Section, Segmented, SliderField, Note, type GestureProps } from './ui';
import s from './panels.module.css';

export interface LayerInspectorProps extends GestureProps {
  layer: Layer;
  generator?: Generator;
  groups: StrandGroup[];
  wall: Wall;
  /** Actual nail bounds of the layer on the wall (null when it has no nails). */
  bounds: Bounds | null;
  onUpdate: (patch: Partial<Omit<Layer, 'id'>>) => void;
  onReroll: () => void;
  onBake?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}

const SHAPES: { value: Shape; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];

const ALIGN_X: { v: AlignX; icon: 'alignLeft' | 'alignCenterH' | 'alignRight'; label: string }[] = [
  { v: 'left', icon: 'alignLeft', label: 'Align left' },
  { v: 'center', icon: 'alignCenterH', label: 'Centre horizontally' },
  { v: 'right', icon: 'alignRight', label: 'Align right' },
];
const ALIGN_Y: { v: AlignY; icon: 'alignTop' | 'alignMiddle' | 'alignBottom'; label: string }[] = [
  { v: 'top', icon: 'alignTop', label: 'Align top' },
  { v: 'middle', icon: 'alignMiddle', label: 'Centre vertically' },
  { v: 'bottom', icon: 'alignBottom', label: 'Align bottom' },
];

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Inspector for one live layer: pattern params, seed, real-world size & position, twine. */
export function LayerInspector(props: LayerInspectorProps) {
  const { layer, generator, groups, wall, bounds, onUpdate, onReroll, onGestureStart, onGestureEnd } = props;
  const t = layer.transform;
  const units = wall.units;
  const size = sizeOf(t);
  const shape = shapeOf(size, 0.002);
  const [lockAspect, setLockAspect] = useState(true);
  const g = { onGestureStart, onGestureEnd };
  const fine = units === 'cm' ? 1 : 0.5;
  const maxDim = Math.max(wall.width, wall.height) * 1.5;

  const setT = (patch: Partial<LayerTransform>) => onUpdate({ transform: { ...t, ...patch } });
  const setSize = (next: Size) => onUpdate({ transform: withSize(t, { w: Math.max(fine, next.w), h: Math.max(fine, next.h) }) });

  const setW = (w: number) => {
    if (shape === 'square') return setSize({ w, h: w });
    setSize(lockAspect && size.w > 0 ? { w, h: (w * size.h) / size.w } : { w, h: size.h });
  };
  const setH = (h: number) => {
    if (shape === 'square') return setSize({ w: h, h });
    setSize(lockAspect && size.h > 0 ? { w: (h * size.w) / size.h, h } : { w: size.w, h });
  };

  const box = bounds ?? transformBounds(t);
  const out = overflow(box, wall);
  const align = (ax?: AlignX, ay?: AlignY) => {
    const { dx, dy } = alignDelta(box, wall, ax, ay);
    setT({ x: t.x + dx, y: t.y + dy });
  };

  const presets = sizePresets(units);
  const fill = fillWallSize(wall);
  const orientFor = shape === 'square' ? 'landscape' : shape;

  return (
    <div className={s.inspector}>
      <div className={s.inspectorHead}>
        <input
          key={layer.id + layer.name}
          className={s.titleInput}
          defaultValue={layer.name}
          aria-label="Layer name"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== layer.name) onUpdate({ name: v });
            else e.target.value = layer.name;
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className={s.inspectorKind}>{generator?.label ?? layer.generatorId} layer</span>
      </div>
      <Section
        title="Pattern"
        actions={
          <div className={s.rowTight}>
            {props.onDuplicate && <IconButton small icon="copy" label="Duplicate layer" onClick={props.onDuplicate} />}
            {props.onBake && <IconButton small icon="bake" label="Bake into editable nails" onClick={props.onBake} />}
            {props.onRemove && <IconButton small icon="trash" label="Delete layer" onClick={props.onRemove} />}
          </div>
        }
      >
        {generator ? (
          <>
            {generator.description && <p className={s.lede}>{generator.description}</p>}
            <ParamPanel
              schema={visibleParams(generator.id, generator.schema, layer.params)}
              values={layer.params}
              onChange={(key: string, value: ParamValue) => onUpdate({ params: { ...layer.params, [key]: value } })}
              {...g}
            />
          </>
        ) : (
          <Note tone="warn">Unknown pattern “{layer.generatorId}”. It can still be moved or deleted.</Note>
        )}
        <Field label="Seed" hint="Same seed, same pattern. Roll for a fresh variation.">
          <div className={s.seedRow}>
            <NumberInput label="Seed" value={layer.seed} step={1} min={0} onChange={(v) => onUpdate({ seed: Math.round(v) })} />
            <Button icon="dice" onClick={onReroll} title="New random seed">
              Reroll
            </Button>
          </div>
        </Field>
      </Section>

      <Section title="Size on the wall" actions={<span className={s.sizeReadout}>{formatSize(size, units)}</span>}>
        <Segmented
          full
          label="Shape"
          value={shape}
          options={SHAPES}
          onChange={(v) => {
            if (v !== shape) setSize(orient(size, v));
          }}
        />
        <Chips>
          {presets.map((p) => {
            const sz = presetSize(p, orientFor);
            return (
              <Chip key={p.id} pressed={near(sz.w, size.w) && near(sz.h, size.h)} onClick={() => setSize(sz)}>
                {sz.w} × {sz.h}
              </Chip>
            );
          })}
          <Chip
            pressed={near(fill.w, size.w) && near(fill.h, size.h)}
            onClick={() => onUpdate({ transform: { ...withSize(t, fill), x: wall.width / 2, y: wall.height / 2 } })}
            title={`Fill the wall, keeping ${formatLength(units === 'cm' ? 15 : 6, units)} clear at the edges`}
          >
            Fill wall
          </Chip>
        </Chips>
        <div className={s.dimGrid}>
          <Field label="Width" htmlFor={`${layer.id}-w`}>
            <div className={s.dimInput}>
              <NumberInput id={`${layer.id}-w`} value={size.w} min={fine} max={maxDim} step={fine} onChange={setW} />
              <span className={s.unit}>{units}</span>
            </div>
          </Field>
          <IconButton
            className={s.lockBtn}
            small
            icon={lockAspect || shape === 'square' ? 'lock' : 'unlock'}
            label={lockAspect ? 'Aspect locked' : 'Aspect unlocked'}
            pressed={lockAspect || shape === 'square'}
            disabled={shape === 'square'}
            onClick={() => setLockAspect((v) => !v)}
          />
          <Field label="Height" htmlFor={`${layer.id}-h`}>
            <div className={s.dimInput}>
              <NumberInput id={`${layer.id}-h`} value={size.h} min={fine} max={maxDim} step={fine} onChange={setH} />
              <span className={s.unit}>{units}</span>
            </div>
          </Field>
        </div>
        <Range label="Overall size" value={size.w} min={fine} max={Math.max(maxDim, size.w)} step={fine} onChange={(w) => setSize({ w, h: size.w > 0 ? (w * size.h) / size.w : w })} {...g} />
      </Section>

      <Section title="Position">
        <div className={s.dimGrid2}>
          <Field label="Centre X" htmlFor={`${layer.id}-x`}>
            <div className={s.dimInput}>
              <NumberInput id={`${layer.id}-x`} value={t.x} step={fine} onChange={(x) => setT({ x })} />
              <span className={s.unit}>{units}</span>
            </div>
          </Field>
          <Field label="Centre Y" htmlFor={`${layer.id}-y`}>
            <div className={s.dimInput}>
              <NumberInput id={`${layer.id}-y`} value={t.y} step={fine} onChange={(y) => setT({ y })} />
              <span className={s.unit}>{units}</span>
            </div>
          </Field>
        </div>
        <div className={s.alignRow}>
          <div className={s.alignGroup}>
            {ALIGN_X.map((a) => (
              <IconButton key={a.v} small icon={a.icon} label={a.label} onClick={() => align(a.v, undefined)} />
            ))}
          </div>
          <div className={s.alignGroup}>
            {ALIGN_Y.map((a) => (
              <IconButton key={a.v} small icon={a.icon} label={a.label} onClick={() => align(undefined, a.v)} />
            ))}
          </div>
        </div>
        <SliderField label="Rotation (°)" value={t.rotation} min={-180} max={180} step={1} onChange={(rotation) => setT({ rotation })} {...g} />
        {out > 0.01 && (
          <Note tone="warn">
            Pokes {formatLength(out, units)} outside the wall. Shrink it or use the align buttons.
          </Note>
        )}
      </Section>

      <Section title="Twine">
        <GroupPicker groups={groups} value={layer.groupId} onChange={(groupId) => onUpdate({ groupId })} />
        <SliderField
          label="Sag"
          hint="0 is taut, 1 is a lazy swag."
          value={layer.sag}
          min={0}
          max={1}
          step={0.01}
          onChange={(sag) => onUpdate({ sag })}
          {...g}
        />
      </Section>
      {layer.locked && (
        <div className={s.lockedNote}>
          <Icon name="lock" size={14} /> This layer is locked on the canvas.
        </div>
      )}
    </div>
  );
}
