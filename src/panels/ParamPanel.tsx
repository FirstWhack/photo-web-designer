import type { ParamValue, ParamValues } from '@/contracts/design';
import type { ParamDef, ParamSchema } from '@/contracts/generator';
import { Chip, Chips, Field, Segmented, Select, SliderField, Toggle, type GestureProps } from './ui';
import s from './panels.module.css';

export interface ParamPanelProps extends GestureProps {
  schema: ParamSchema;
  values: ParamValues;
  /** Emits typed values: number for number/int, string for select, boolean for bool. */
  onChange: (key: string, value: ParamValue) => void;
}

/** Up to this many options render as a segmented control; more fall back to a select. */
const SEGMENT_MAX = 3;
/** Up to this many render as wrapping chips; more fall back to a select. */
const CHIP_MAX = 12;

function current(def: ParamDef, values: ParamValues): ParamValue {
  const v = values[def.key];
  switch (def.kind) {
    case 'number':
    case 'int':
      return typeof v === 'number' && Number.isFinite(v) ? v : def.default;
    case 'select':
      return typeof v === 'string' && def.options.some((o) => o.value === v) ? v : def.default;
    case 'bool':
      return typeof v === 'boolean' ? v : def.default;
  }
}

/** Auto-built controls for a generator's ParamSchema, in schema order. */
export function ParamPanel({ schema, values, onChange, onGestureStart, onGestureEnd }: ParamPanelProps) {
  if (!schema.length) return <p className={s.empty}>This pattern has no settings.</p>;
  return (
    <div className={s.stack} data-testid="param-panel">
      {schema.map((def) => {
        const v = current(def, values);
        switch (def.kind) {
          case 'number':
          case 'int': {
            const step = def.kind === 'int' ? Math.max(1, Math.round(def.step ?? 1)) : def.step;
            return (
              <div key={def.key} data-param={def.key} data-kind={def.kind}>
                <SliderField
                  label={def.label}
                  hint={def.hint}
                  value={v as number}
                  min={def.min}
                  max={def.max}
                  step={step}
                  onGestureStart={onGestureStart}
                  onGestureEnd={onGestureEnd}
                  onChange={(n) => onChange(def.key, def.kind === 'int' ? Math.round(n) : n)}
                />
              </div>
            );
          }
          case 'select':
            return (
              <div key={def.key} data-param={def.key} data-kind="select">
                <Field label={def.label} hint={def.hint}>
                  {def.options.length <= SEGMENT_MAX ? (
                    <Segmented
                      full
                      label={def.label}
                      value={v as string}
                      options={def.options.map((o) => ({ value: o.value, label: o.label }))}
                      onChange={(x) => onChange(def.key, x)}
                    />
                  ) : def.options.length <= CHIP_MAX ? (
                    <Chips>
                      {def.options.map((o) => (
                        <Chip key={o.value} pressed={v === o.value} onClick={() => onChange(def.key, o.value)}>
                          {o.label}
                        </Chip>
                      ))}
                    </Chips>
                  ) : (
                    <Select label={def.label} value={v as string} options={def.options} onChange={(x) => onChange(def.key, x)} />
                  )}
                </Field>
              </div>
            );
          case 'bool':
            return (
              <div key={def.key} data-param={def.key} data-kind="bool">
                <Toggle label={def.label} hint={def.hint} checked={v as boolean} onChange={(b) => onChange(def.key, b)} />
              </div>
            );
        }
      })}
    </div>
  );
}
