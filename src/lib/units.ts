import type { Units } from '@/contracts/design';

export const CM_PER_IN = 2.54;

export function convert(value: number, from: Units, to: Units): number {
  if (from === to) return value;
  return from === 'in' ? value * CM_PER_IN : value / CM_PER_IN;
}

/** Compact display, e.g. `12.5"` or `31.8 cm`. */
export function formatLength(value: number, units: Units, digits = 1): string {
  const v = Number(value.toFixed(digits));
  return units === 'in' ? `${v}"` : `${v} cm`;
}

/** Twine quantities: `3 ft 5 in` / `1.25 m`. */
export function formatTwine(value: number, units: Units): string {
  if (units === 'cm') return `${(value / 100).toFixed(2)} m`;
  const total = Math.ceil(value);
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  if (ft === 0) return `${inch} in`;
  return inch === 0 ? `${ft} ft` : `${ft} ft ${inch} in`;
}

/** Tape-measure friendly: inches to the nearest 1/8 (`12 3/8"`), cm to 1 mm (`31.8 cm`). */
export function formatMeasure(value: number, units: Units): string {
  if (units === 'cm') return `${value.toFixed(1)} cm`;
  const eighths = Math.round(value * 8);
  const whole = Math.trunc(eighths / 8);
  let num = Math.abs(eighths % 8);
  let den = 8;
  while (num !== 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const sign = eighths < 0 && whole === 0 ? '-' : '';
  return num === 0 ? `${whole}"` : `${sign}${whole === 0 ? '' : whole + ' '}${num}/${den}"`;
}
