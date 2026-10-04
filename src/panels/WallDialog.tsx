import { useRef, useState } from 'react';
import type { Units, Wall, WallBackground } from '@/contracts/design';
import { orient, shapeOf, wallPresets, type Shape } from './sizing';import { Button, Chip, Chips, Dialog, Field, Note, NumberInput, Segmented, SliderField } from './ui';
import s from './panels.module.css';

/** Cover-fit an image of natural size (iw, ih) over a wall, centred. */
export function coverPlacement(iw: number, ih: number, W: number, H: number) {
  const k = Math.max(W / Math.max(1, iw), H / Math.max(1, ih));
  const width = iw * k;
  const height = ih * k;
  return { x: (W - width) / 2, y: (H - height) / 2, width, height };
}

const readImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });

/** Longest side of the stored background, in px (keeps autosave small). */
const MAX_BG_PX = 1600;

/**
 * Background that exactly fills the wall: the photo is centre-cropped to the wall's aspect
 * (and downscaled) so nothing spills past the wall edges. Falls back to a cover placement
 * of the original when canvas isn't available.
 */
export function fitBackground(img: HTMLImageElement, W: number, H: number, opacity: number): WallBackground {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const aspect = W / H;
  let sw = iw;
  let sh = iw / aspect;
  if (sh > ih) {
    sh = ih;
    sw = ih * aspect;
  }
  const k = Math.min(1, MAX_BG_PX / Math.max(sw, sh));
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      return { dataUrl: c.toDataURL('image/jpeg', 0.85), x: 0, y: 0, width: W, height: H, opacity };
    }
  } catch {
    /* fall through */
  }
  return { dataUrl: img.src, opacity, ...coverPlacement(iw, ih, W, H) };
}

const SHAPES: { value: Shape; label: string }[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' },
];

/** Wall size, units and an optional background photo of the real wall. */
export function WallDialog({
  wall,
  hasGeometry,
  onboarding = false,
  onApply,
  onClose,
}: {
  wall: Wall;
  /** True when the design already has nails/layers (unit changes don't convert them). */
  hasGeometry: boolean;
  /** First-run framing: a welcome line and a single "Continue" button. */
  onboarding?: boolean;
  onApply: (wall: Wall) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(wall.width);
  const [height, setHeight] = useState(wall.height);
  const [units, setUnits] = useState<Units>(wall.units);
  const [bg, setBg] = useState<WallBackground | undefined>(wall.background);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shape = shapeOf({ w: width, h: height });
  const presets = wallPresets(units);

  const resize = (w: number, h: number) => {
    setWidth(w);
    setHeight(h);
    if (bg) {
      // Re-crop a freshly uploaded photo; an existing one is just stretched to the new size.
      setBg(source ? fitBackground(source, w, h, bg.opacity) : { ...bg, x: 0, y: 0, width: w, height: h });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const img = await readImage(file);
      setSource(img);
      setBg(fitBackground(img, width, height, bg?.opacity ?? 0.6));
    } catch (e) {
      setError((e as Error).message || 'Could not read that image');
    }
  };

  const apply = () => {
    const next: Wall = { width, height, units };
    if (bg) next.background = bg;
    onApply(next);
    onClose();
  };

  return (
    <Dialog
      title={onboarding ? 'Set up your wall' : 'Wall setup'}
      onClose={onClose}
      footer={
        <>
          {!onboarding && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button variant="primary" onClick={apply} disabled={!(width > 0 && height > 0)}>
            {onboarding ? 'Continue' : 'Apply'}
          </Button>
        </>
      }
    >
      {onboarding && <p className={s.lede}>Tell us about the space you’re filling. Everything is drawn to real size, and you can change this any time.</p>}
      <Field label="Common spaces">
        <Chips>
          {presets.map((p) => {
            const sz = { w: p.w, h: p.h };
            const pressed = Math.abs(sz.w - width) < 0.01 && Math.abs(sz.h - height) < 0.01;
            return (
              <Chip key={p.id} pressed={pressed} onClick={() => resize(sz.w, sz.h)} title={`${sz.w} × ${sz.h} ${units}`}>
                {p.label} · {sz.w}×{sz.h}
              </Chip>
            );
          })}
        </Chips>
      </Field>
      <Field label="Orientation">
        <Segmented
          full
          label="Orientation"
          value={shape}
          options={SHAPES}
          onChange={(v) => {
            const sz = orient({ w: width, h: height }, v);
            resize(sz.w, sz.h);
          }}
        />
      </Field>
      <div className={s.wallDims}>
        <Field label="Width" htmlFor="wall-w">
          <NumberInput id="wall-w" value={width} min={1} max={1000} step={units === 'cm' ? 1 : 0.5} onChange={(w) => resize(w, height)} />
        </Field>
        <span className={s.times}>×</span>
        <Field label="Height" htmlFor="wall-h">
          <NumberInput id="wall-h" value={height} min={1} max={1000} step={units === 'cm' ? 1 : 0.5} onChange={(h) => resize(width, h)} />
        </Field>
        <Field label="Units">
          <Segmented
            label="Units"
            value={units}
            options={[
              { value: 'in', label: 'in' },
              { value: 'cm', label: 'cm' },
            ]}
            onChange={setUnits}
          />
        </Field>
      </div>
      {units !== wall.units && hasGeometry && (
        <Note tone="warn">
          Changing units doesn’t convert existing nails: a nail at 24 stays at 24 {units}. Best done on a fresh design.
        </Note>
      )}
      <Field label="Photo of your wall" hint="Optional. Helps you see the web in place. It stays on this device and isn’t included in share links.">
        <div className={s.bgRow}>
          {bg ? <img className={s.bgPreview} src={bg.dataUrl} alt="Wall background" /> : <div className={s.bgPlaceholder} />}
          <div className={s.rowTight}>
            <Button size="small" icon="upload" onClick={() => fileRef.current?.click()}>
              {bg ? 'Replace' : 'Upload photo'}
            </Button>
            {bg && (
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  setBg(undefined);
                  setSource(null);
                }}
              >
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </Field>
      {error && <Note tone="warn">{error}</Note>}
      {bg && (
        <SliderField label="Photo opacity" value={bg.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setBg({ ...bg, opacity })} />
      )}
    </Dialog>
  );
}
