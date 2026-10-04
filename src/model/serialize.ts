import type { Design } from '@/contracts/design';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

export function serializeDesign(design: Design): string {
  return JSON.stringify(design);
}

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Invalid(`${path} must be an object`);
  return v as Obj;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Invalid(`${path} must be an array`);
  return v;
}
function num(o: Obj, k: string, path: string): void {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Invalid(`${path}.${k} must be a finite number`);
}
function str(o: Obj, k: string, path: string): void {
  if (typeof o[k] !== 'string') throw new Invalid(`${path}.${k} must be a string`);
}
function bool(o: Obj, k: string, path: string): void {
  if (typeof o[k] !== 'boolean') throw new Invalid(`${path}.${k} must be a boolean`);
}

/** Validate an already-parsed value as a Design (throws a descriptive Error). */
export function validateDesign(value: unknown): Design {
  try {
    const d = obj(value, 'design');
    if (d.version !== 1) throw new Invalid(`design.version must be 1 (got ${JSON.stringify(d.version)})`);

    const wall = obj(d.wall, 'design.wall');
    num(wall, 'width', 'design.wall');
    num(wall, 'height', 'design.wall');
    if ((wall.width as number) <= 0 || (wall.height as number) <= 0)
      throw new Invalid('design.wall width/height must be positive');
    if (wall.units !== 'in' && wall.units !== 'cm') throw new Invalid(`design.wall.units must be 'in' or 'cm'`);
    if (wall.background !== undefined) {
      const bg = obj(wall.background, 'design.wall.background');
      str(bg, 'dataUrl', 'design.wall.background');
      for (const k of ['x', 'y', 'width', 'height', 'opacity']) num(bg, k, 'design.wall.background');
    }

    const groups = arr(d.groups, 'design.groups');
    if (groups.length === 0) throw new Invalid('design.groups must contain at least one group');
    groups.forEach((g, i) => {
      const p = `design.groups[${i}]`;
      const o = obj(g, p);
      str(o, 'id', p);
      str(o, 'name', p);
      str(o, 'color', p);
      num(o, 'thickness', p);
    });

    arr(d.layers, 'design.layers').forEach((l, i) => {
      const p = `design.layers[${i}]`;
      const o = obj(l, p);
      for (const k of ['id', 'name', 'generatorId', 'groupId']) str(o, k, p);
      num(o, 'seed', p);
      num(o, 'sag', p);
      bool(o, 'visible', p);
      bool(o, 'locked', p);
      const params = obj(o.params, `${p}.params`);
      for (const [k, v] of Object.entries(params)) {
        const ok = typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
        if (!ok) throw new Invalid(`${p}.params.${k} must be a finite number, string or boolean`);
      }
      const t = obj(o.transform, `${p}.transform`);
      for (const k of ['x', 'y', 'scaleX', 'scaleY', 'rotation']) num(t, k, `${p}.transform`);
    });

    arr(d.nails, 'design.nails').forEach((n, i) => {
      const p = `design.nails[${i}]`;
      const o = obj(n, p);
      str(o, 'id', p);
      // The frozen nailLabels helper stores labels in a plain object.
      if (o.id === '__proto__') throw new Invalid(`${p}.id cannot be the reserved name '__proto__'`);
      num(o, 'x', p);
      num(o, 'y', p);
    });

    arr(d.edges, 'design.edges').forEach((e, i) => {
      const p = `design.edges[${i}]`;
      const o = obj(e, p);
      for (const k of ['id', 'a', 'b', 'groupId']) str(o, k, p);
      num(o, 'sag', p);
    });

    arr(d.pins, 'design.pins').forEach((pin, i) => {
      const p = `design.pins[${i}]`;
      const o = obj(pin, p);
      str(o, 'id', p);
      str(o, 'edgeId', p);
      num(o, 't', p);
      if (o.photo !== undefined) {
        const photo = obj(o.photo, `${p}.photo`);
        if (photo.dataUrl !== undefined) str(photo, 'dataUrl', `${p}.photo`);
        if (photo.aspect !== undefined) {
          num(photo, 'aspect', `${p}.photo`);
          if ((photo.aspect as number) <= 0) throw new Invalid(`${p}.photo.aspect must be positive`);
        }
      }
    });

    for (const key of ['groups', 'layers', 'nails', 'edges', 'pins']) {
      const ids = new Set<string>();
      for (const item of d[key] as Obj[]) {
        const id = item.id as string;
        if (ids.has(id)) throw new Invalid(`design.${key} contains duplicate id ${JSON.stringify(id)}`);
        ids.add(id);
      }
    }

    num(d, 'mergeTolerance', 'design');
    const meta = obj(d.meta, 'design.meta');
    str(meta, 'name', 'design.meta');
    num(meta, 'createdAt', 'design.meta');
    num(meta, 'updatedAt', 'design.meta');
    return d as unknown as Design;
  } catch (err) {
    if (err instanceof Invalid) throw new Error(`Invalid design: ${err.message}`, { cause: err });
    throw err;
  }
}

/** Throws a descriptive Error on invalid input. */
export function deserializeDesign(json: string): Design {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid design: not valid JSON (${(err as Error).message})`, { cause: err });
  }
  return validateDesign(parsed);
}

/**
 * URL hash fragment (without '#'). Drops the wall background image and photo
 * image data (both far too large for a URL); photo aspect ratios are kept.
 */
export function encodeShareLink(design: Design): string {
  const { background: _bg, ...wall } = design.wall;
  const pins = design.pins.map((p) => {
    if (!p.photo?.dataUrl) return p;
    const { dataUrl: _d, ...photo } = p.photo;
    return { ...p, photo };
  });
  return compressToEncodedURIComponent(JSON.stringify({ ...design, wall, pins }));
}

export function decodeShareLink(hash: string): Design | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!raw) return null;
    const json = decompressFromEncodedURIComponent(raw);
    if (!json) return null;
    return deserializeDesign(json);
  } catch {
    return null;
  }
}
