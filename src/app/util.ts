import type { Design, Layer, ResolvedDesign, Wall } from '@/contracts/design';
import type { Generator, GeneratorRegistry } from '@/contracts/generator';
import type { BuildPlan } from '@/contracts/plan';
import { planSignature } from '@/build';
import { DEFAULT_GROUP_COLORS, emptyDesign } from '@/contracts/defaults';
import { resolveDesign, fallbackTransform } from '@/model';

/** Generators in gallery order: the rectangle frame first when it exists. */
export function galleryOrder(registry: GeneratorRegistry): Generator[] {
  const list = registry.list();
  const frame = list.find((g) => g.id === 'frame');
  return frame ? [frame, ...list.filter((g) => g !== frame)] : list;
}

const previewCache = new Map<string, ResolvedDesign>();

/** Live preview of one generator at its defaults on the given wall (cached). */
export function generatorPreview(gen: Generator, registry: GeneratorRegistry, wall: Pick<Wall, 'width' | 'height' | 'units'>, index: number) {
  const key = `${gen.id}|${wall.width}x${wall.height}${wall.units}`;
  const hit = previewCache.get(key);
  if (hit) return hit;
  const base = emptyDesign({ width: wall.width, height: wall.height, units: wall.units }, 0);
  const color = DEFAULT_GROUP_COLORS[[0, 1, 2, 3, 5][index % 5]];
  let transform;
  try {
    transform = gen.suggestTransform?.(base.wall);
  } catch {
    transform = undefined;
  }
  const layer: Layer = {
    id: 'preview',
    name: gen.label,
    generatorId: gen.id,
    params: registry.defaults(gen.id),
    seed: 7,
    transform: transform ?? fallbackTransform(base.wall),
    groupId: 'g-preview',
    sag: 0.15,
    visible: true,
    locked: false,
  };
  const design: Design = {
    ...base,
    groups: [{ id: 'g-preview', name: 'Preview', color, thickness: 3 }],
    layers: [layer],
  };
  let r: ResolvedDesign;
  try {
    r = resolveDesign(design, registry);
  } catch {
    r = resolveDesign(base, registry);
  }
  previewCache.set(key, r);
  return r;
}

export function isEmptyDesign(d: Design) {
  return d.layers.length === 0 && d.nails.length === 0 && d.edges.length === 0;
}

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'photo-web';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Small stable string hash (FNV-1a, base36). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const planHash = (plan: BuildPlan) => hashString(planSignature(plan));

/** Mirrors the walkthrough's screen sequence so the app can highlight the current step. */
export type WalkScreen =
  | { kind: 'start'; run: number }
  | { kind: 'step'; run: number; step: number }
  | { kind: 'complete'; run: number }
  | { kind: 'done' };

export function walkScreens(plan: BuildPlan): WalkScreen[] {
  const out: WalkScreen[] = [];
  plan.runs.forEach((run, r) => {
    out.push({ kind: 'start', run: r });
    run.steps.forEach((_, s) => out.push({ kind: 'step', run: r, step: s }));
    if (r < plan.runs.length - 1) out.push({ kind: 'complete', run: r });
  });
  if (plan.runs.length) out.push({ kind: 'done' });
  return out;
}

export function walkHighlight(plan: BuildPlan, screen: WalkScreen | undefined): { nails: string[]; edges: string[] } | undefined {
  if (!screen || screen.kind === 'done') return undefined;
  const run = plan.runs[screen.run];
  if (!run) return undefined;
  if (screen.kind === 'step') {
    const st = run.steps[screen.step];
    return st ? { nails: [st.from, st.to], edges: [st.edgeId] } : undefined;
  }
  if (screen.kind === 'start') return { nails: [run.nails[0]], edges: [] };
  return { nails: [run.nails[run.nails.length - 1]], edges: [] };
}
