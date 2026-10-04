import { useState } from 'react';
import type { ResolvedDesign, Wall } from '@/contracts/design';
import { Thumbnail } from '@/canvas';
import { presetSize, fillWallSize, sizePresets, type Shape, type Size } from './sizing';
import { Chip, Chips, IconButton, Segmented, Button, cx } from './ui';
import s from './panels.module.css';

export interface GalleryItem {
  id: string;
  label: string;
  description: string;
}

export interface PatternGalleryProps {
  items: GalleryItem[];
  /** Live preview per generator id (resolved at defaults). */
  previews: Record<string, ResolvedDesign | undefined>;
  wall: Pick<Wall, 'width' | 'height' | 'units'>;
  /** size null = the generator's suggested size. */
  onAdd: (generatorId: string, size: Size | null, fill?: boolean) => void;
  thumbWidth?: number;
}

const SHAPES: { value: Shape; label: string }[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' },
];

const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });

/** "Add pattern": one live card per generator. Picking one asks for a size in a single extra click. */
export function PatternGallery({ items, previews, wall, onAdd, thumbWidth = 112 }: PatternGalleryProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [shape, setShape] = useState<Shape>(wall.width >= wall.height ? 'landscape' : 'portrait');
  const presets = sizePresets(wall.units);
  const openItem = items.find((i) => i.id === open);

  const add = (size: Size | null, fill = false) => {
    if (!open) return;
    onAdd(open, size, fill);
    setOpen(null);
  };

  const visible = presets.filter((p) => (shape === 'square' ? p.w === p.h : p.w !== p.h));

  return (
    <div className={s.gallery}>
      <div className={s.galleryGrid}>
        {items.map((it) => {
          const r = previews[it.id];
          return (
            <button
              key={it.id}
              type="button"
              className={cx(s.card, open === it.id && s.cardOpen)}
              aria-expanded={open === it.id}
              title={it.description}
              onClick={() => setOpen((o) => (o === it.id ? null : it.id))}
              data-generator={it.id}
            >
              <span className={s.cardThumb}>{r ? <Thumbnail resolved={r} width={thumbWidth} /> : null}</span>
              <span className={s.cardLabel}>{it.label}</span>
            </button>
          );
        })}
      </div>
      {openItem && (
        <div
          className={s.sizeSheet}
          role="dialog"
          aria-label={`Add ${openItem.label}`}
          key={openItem.id}
          ref={scrollIntoView}
        >
          <div className={s.sizeSheetHead}>
            <strong>Add {openItem.label}</strong>
            <IconButton small icon="close" label="Cancel" onClick={() => setOpen(null)} />
          </div>
          <Segmented full label="Orientation" value={shape} options={SHAPES} onChange={setShape} />
          <Chips>
            {visible.map((p) => {
              const sz = presetSize(p, shape);
              return (
                <Chip key={p.id} onClick={() => add(sz)}>
                  {sz.w} × {sz.h}
                  {wall.units === 'in' ? '″' : ' cm'}
                </Chip>
              );
            })}
            <Chip onClick={() => add(fillWallSize(wall), true)} title="Fill the wall, keeping a margin at the edges">
              Fill wall
            </Chip>
          </Chips>
          <Button size="small" variant="ghost" onClick={() => add(null)}>
            Use suggested size
          </Button>
        </div>
      )}
    </div>
  );
}
