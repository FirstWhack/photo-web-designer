import { useCallback, useState } from 'react';
import type { Design } from '@/contracts/design';
import { validateDesign } from '@/model';
import { newId } from '@/lib/id';

export interface Variation {
  id: string;
  design: Design;
  at: number;
}

export const VARIATIONS_KEY = 'photo-web:variations';
export const MAX_VARIATIONS = 16;

/** Drop heavy image data (wall photo, photo images) before keeping a snapshot. */
function slim(d: Design): Design {
  const { background: _bg, ...wall } = d.wall;
  return {
    ...d,
    wall,
    pins: d.pins.map((p) => (p.photo?.dataUrl ? { ...p, photo: { aspect: p.photo.aspect } } : p)),
  };
}

const same = (a: Design, b: Design) =>
  JSON.stringify([a.layers, a.nails, a.edges, a.groups]) === JSON.stringify([b.layers, b.nails, b.edges, b.groups]);

function load(): Variation[] {
  try {
    const raw = localStorage.getItem(VARIATIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as { id: string; design: unknown; at: number }[];
    const out: Variation[] = [];
    for (const v of arr) {
      try {
        out.push({ id: String(v.id), at: Number(v.at) || 0, design: validateDesign(v.design) });
      } catch {
        /* skip corrupt entries */
      }
    }
    return out.slice(0, MAX_VARIATIONS);
  } catch {
    return [];
  }
}

function save(items: Variation[]) {
  try {
    localStorage.setItem(VARIATIONS_KEY, JSON.stringify(items));
  } catch {
    /* storage full or unavailable */
  }
}

/** Recent design variations (newest first), persisted to localStorage. */
export function useVariations() {
  const [items, setItems] = useState<Variation[]>(load);
  const push = useCallback((design: Design) => {
    setItems((prev) => {
      if (prev[0] && same(prev[0].design, design)) return prev;
      const next = [{ id: newId('v'), design: slim(design), at: Date.now() }, ...prev].slice(0, MAX_VARIATIONS);
      save(next);
      return next;
    });
  }, []);
  return { items, push };
}
