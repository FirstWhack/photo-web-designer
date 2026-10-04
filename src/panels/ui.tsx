import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';
import s from './ui.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── buttons ───────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  icon?: IconName;
  block?: boolean;
}

export function Button({ variant = 'default', size = 'medium', icon, block, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        s.btn,
        variant === 'primary' && s.primary,
        variant === 'ghost' && s.ghost,
        variant === 'danger' && s.danger,
        size === 'small' && s.small,
        size === 'large' && s.large,
        block && s.block,
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'small' ? 14 : size === 'large' ? 20 : 16} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  small?: boolean;
  pressed?: boolean;
}

export function IconButton({ icon, label, small, pressed, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx(s.iconBtn, small && s.iconBtnSm, className)}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={small ? 15 : 18} />
    </button>
  );
}

// ── segmented ─────────────────────────────────────────

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
  label,
}: {
  value: T | null;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  full?: boolean;
  label?: string;
}) {
  return (
    <div className={cx(s.seg, full && s.segFull)} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={s.segBtn}
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── fields ────────────────────────────────────────────

export function Field({
  label,
  hint,
  value,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <label className={s.label} htmlFor={htmlFor}>
          {label}
        </label>
        {value !== undefined && <span className={s.hint}>{value}</span>}
      </div>
      {children}
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}

const decimals = (step: number) => {
  const t = String(step);
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
};

/** Number input that only commits valid numbers, and re-syncs when the value changes elsewhere. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
  label,
  className,
  digits,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  label?: string;
  className?: string;
  digits?: number;
}) {
  const d = digits ?? Math.min(3, decimals(step));
  const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(d))) : '');
  const [text, setText] = useState(() => fmt(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : fmt(value);
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(v)) return;
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    if (c !== value) onChange(c);
  };
  return (
    <input
      id={id}
      aria-label={label}
      className={cx(s.input, s.num, className)}
      type="number"
      inputMode="decimal"
      value={shown}
      min={min}
      max={max}
      step={step}
      onFocus={() => {
        setText(fmt(value));
        setFocused(true);
      }}
      onBlur={() => {
        commit(text);
        setFocused(false);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max))
          onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export interface GestureProps {
  /** Called once when a slider drag starts (wrap with beginGesture). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

/** Range slider. Pointer drags are reported as one gesture so they become one undo step. */
export function Range({
  value,
  min,
  max,
  step,
  onChange,
  onGestureStart,
  onGestureEnd,
  id,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  id?: string;
  label?: string;
} & GestureProps) {
  const active = useRef(false);
  const endRef = useRef(onGestureEnd);
  useEffect(() => {
    endRef.current = onGestureEnd;
  }, [onGestureEnd]);
  useEffect(
    () => () => {
      if (active.current) endRef.current?.();
    },
    [],
  );
  const start = () => {
    if (active.current) return;
    active.current = true;
    onGestureStart?.();
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!active.current) return;
      active.current = false;
      endRef.current?.();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      id={id}
      aria-label={label}
      type="range"
      className={s.range}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onPointerDown={start}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Label + slider + number box. */
export function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  onGestureStart,
  onGestureEnd,
  suffix,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: ReactNode;
} & GestureProps) {
  const id = useId();
  const text = typeof label === 'string' ? label : undefined;
  return (
    <Field label={label} hint={hint} htmlFor={id} value={suffix}>
      <div className={s.sliderRow}>
        <Range
          id={id}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <NumberInput value={value} min={min} max={max} step={step} onChange={onChange} label={text ? `${text} value` : undefined} />
      </div>
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <div className={s.field}>
      <label className={s.toggle}>
        <span className={s.label}>{label}</span>
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={s.switch} aria-hidden="true" />
      </label>
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  id?: string;
  label?: string;
}) {
  return (
    <select id={id} aria-label={label} className={s.select} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── layout bits ───────────────────────────────────────

export function Section({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx(s.section, className)}>
      {(title || actions) && (
        <div className={s.sectionHead}>
          {title && <h3 className={s.sectionTitle}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className={cx(s.note, tone === 'warn' && s.noteWarn)} role={tone === 'warn' ? 'status' : undefined}>
      <Icon name={tone === 'warn' ? 'warn' : 'info'} size={14} />
      <div>{children}</div>
    </div>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className={s.chips}>{children}</div>;
}

export function Chip({
  pressed,
  children,
  ...rest
}: { pressed?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={s.chip} aria-pressed={pressed} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'error' }) {
  return <span className={cx(s.badge, tone === 'error' && s.badgeError)}>{children}</span>;
}

// ── tabs ──────────────────────────────────────────────

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
}: {
  value: T;
  tabs: { value: T; label: ReactNode; icon?: IconName }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className={s.tabs} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          className={s.tab}
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── dialog / menu ─────────────────────────────────────

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className={s.scrim} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={s.dialogHead}>
          <h2 id={titleId} className={s.dialogTitle}>
            {title}
          </h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className={s.dialogBody}>{children}</div>
        {footer && <div className={s.dialogFoot}>{footer}</div>}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  separatorBefore?: boolean;
}

export function Menu({ items, trigger }: { items: MenuItem[]; trigger: (open: boolean, toggle: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={s.popWrap} ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={s.menu} role="menu">
          {items.map((it) => (
            <div key={it.label}>
              {it.separatorBefore && <div className={s.menuSep} />}
              <button
                type="button"
                role="menuitem"
                className={s.menuItem}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon && <Icon name={it.icon} size={16} />}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className={s.toast} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export { cx };
