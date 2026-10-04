/**
 * "Surprise me": deterministic, tasteful random compositions.
 *
 * Ring-based generators (spider-web anchors, string-art circle, star outer copy, curve-stitch
 * n-gon tips) all place nail i at ringPoint(i, n). Giving two layers the same transform and
 * compatible counts therefore makes them share nails on purpose — they interlock on the wall.
 */
import type { LayerTransform, ParamValues, Wall } from '@/contracts/design';
import type { Generator, SurpriseResult } from '@/contracts/generator';
import { createRng, type Rng } from '@/lib/rng';
import { frameTransform } from './frame';
import { schemaDefaults } from './util';

type SurpriseLayer = SurpriseResult['layers'][number];

export const NATURALS = ['#c8a165', '#e8e1d0', '#a67c52', '#d9c3a0', '#8b6b4a'];
export const ACCENTS = ['#b5523b', '#3f6e8c', '#5a8a5e', '#c9a227', '#7a4b6b'];

interface Motif {
  generatorId: string;
  name: string;
  params: ParamValues;
  sag: number;
}

const fmt = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(1));

function spider(rng: Rng, spokes?: number): Motif {
  return {
    generatorId: 'spider-web',
    name: 'Spider web',
    sag: 0.08,
    params: {
      spokes: spokes ?? rng.pick([6, 8, 10, 12]),
      rings: rng.int(3, 7),
      style: rng.chance(0.65) ? 'spiral' : 'rings',
      spacing: Math.round(rng.range(-0.2, 0.6) * 20) / 20,
      irregularity: Math.round(rng.range(0, 0.3) * 20) / 20,
      hubNail: rng.chance(0.75),
    },
  };
}

function stringArt(rng: Rng, multipleOf?: number): Motif {
  let nails: number;
  if (multipleOf) {
    const opts: number[] = [];
    for (let m = 2; m * multipleOf <= 100; m++) if (m * multipleOf >= 30) opts.push(m * multipleOf);
    nails = opts.length ? rng.pick(opts) : multipleOf * 4;
  } else nails = rng.int(40, 90);
  const k = rng.pick([2, 2, 3, 3, 4, 5, 6, 7, 1.5, 2.5, 3.5]);
  const shared = multipleOf !== undefined;
  const name = k === 2 ? 'Cardioid ring' : k === 3 ? 'Nephroid ring' : `String-art ring ×${fmt(k)}`;
  return {
    generatorId: 'string-art',
    name,
    sag: 0,
    params: {
      nails,
      multiplier: k,
      offset: 0,
      shape: shared ? 'circle' : rng.pick(['circle', 'circle', 'ellipse', 'rounded-square']),
      outline: shared ? true : rng.chance(0.6),
    },
  };
}

function star(rng: Rng, points?: number): Motif {
  const n = points ?? rng.int(5, 12);
  const kMax = Math.max(2, Math.floor((n - 1) / 2));
  const k = n < 5 ? 1 : rng.int(2, kMax);
  return {
    generatorId: 'star',
    name: `Star {${n}/${k}}`,
    sag: 0,
    params: {
      points: n,
      skip: k,
      copies: rng.int(1, 4),
      rotationStep: Math.round(rng.pick([0, 180 / n, 90 / n, -180 / n]) * 2) / 2,
      scaleStep: Math.round(rng.range(0.55, 0.78) * 100) / 100,
      outline: rng.chance(0.3),
      linkCopies: rng.chance(0.25),
    },
  };
}

function curveStitch(rng: Rng, arms?: number): Motif {
  const shape = arms !== undefined ? 'polygon' : rng.pick(['polygon', 'polygon', 'fan', 'angle', 'corner']);
  const a = arms ?? rng.int(4, 8);
  const label = shape === 'polygon' ? `Stitched ${a}-point star` : shape === 'fan' ? 'Stitched fan' : 'Stitched curve';
  return {
    generatorId: 'curve-stitch',
    name: label,
    sag: 0,
    params: {
      shape,
      points: rng.int(8, 16),
      arms: a,
      angle: Math.round(rng.range(40, 120)),
      drawArms: rng.chance(0.7),
    },
  };
}

function lattice(rng: Rng): Motif {
  const pattern = rng.pick(['triangular', 'square', 'hex', 'diamond']);
  const names: Record<string, string> = {
    triangular: 'Triangle net',
    square: 'Square net',
    hex: 'Honeycomb net',
    diamond: 'Diamond net',
  };
  const size = pattern === 'hex' ? rng.int(3, 5) : rng.int(5, 9);
  return {
    generatorId: 'lattice',
    name: names[pattern],
    sag: 0.05,
    params: {
      pattern,
      rows: size,
      cols: size,
      removal: rng.pick([0, 0, 0.1, 0.2]),
      warp: rng.pick(['none', 'sine', 'pinch', 'bulge']),
      warpAmount: Math.round(rng.range(0.2, 0.7) * 100) / 100,
    },
  };
}

function organic(rng: Rng): Motif {
  return {
    generatorId: 'organic',
    name: 'Organic net',
    sag: 0.06,
    params: {
      count: rng.int(25, 60),
      density: Math.round(rng.range(0.3, 0.8) * 100) / 100,
      boundary: rng.pick(['circle', 'blob', 'blob', 'rect']),
      relax: rng.int(1, 3),
    },
  };
}

function swag(rng: Rng): Motif {
  return {
    generatorId: 'swag',
    name: 'Photo garland',
    sag: 0,
    params: {
      nails: rng.int(5, 8),
      tiers: rng.int(2, 3),
      layout: rng.pick(['row', 'row', 'arc', 'smile']),
      sag: Math.round(rng.range(0.55, 0.85) * 100) / 100,
      stagger: rng.chance(0.6),
      crissCross: rng.chance(0.3),
    },
  };
}

function galleryFrame(rng: Rng): Motif {
  const pattern = rng.chance(0.6) ? 'rows' : 'zigzag';
  return {
    generatorId: 'frame',
    name: pattern === 'rows' ? 'Gallery frame' : 'Garland frame',
    sag: 0,
    params: {
      pattern,
      nailsX: rng.int(7, 11),
      nailsY: rng.int(5, 8),
      outline: true,
      tiers: rng.int(1, 3),
    },
  };
}

/** Accent on the same perimeter nails as `base` (same counts + same transform = shared nails). */
function frameAccent(rng: Rng, base: Motif): Motif {
  const pattern = rng.pick(['corners', 'corners', 'diamond'] as const);
  return {
    generatorId: 'frame',
    name: pattern === 'corners' ? 'Stitched corners' : 'Diamond lattice',
    sag: 0,
    params: {
      pattern,
      nailsX: base.params.nailsX,
      nailsY: base.params.nailsY,
      outline: false,
      cornerSet: rng.pick(['all', 'top', 'diagonal']),
    },
  };
}

const centrepiece = (rng: Rng): Motif =>
  rng.pick([spider, star, curveStitch, stringArt, organic] as const)(rng);

function circleAt(x: number, y: number, r: number): LayerTransform {
  return { x, y, scaleX: r, scaleY: r, rotation: 0 };
}

function palette(rng: Rng, count: number): string[] {
  const out: string[] = [];
  const naturals = NATURALS.slice();
  const accents = ACCENTS.slice();
  const take = (arr: string[]) => arr.splice(Math.floor(rng.next() * arr.length), 1)[0];
  const maxAccents = count >= 3 ? 2 : 1;
  let used = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0 && used < maxAccents && rng.chance(0.55)) {
      out.push(take(accents));
      used++;
    } else out.push(take(naturals));
  }
  return out;
}

export function surprise(seed: number, wall: Wall, get: (id: string) => Generator | undefined): SurpriseResult {
  const rng = createRng(seed);
  const W = wall.width;
  const H = wall.height;
  const short = Math.min(W, H);
  const margin = 0.06 * short;
  const centre = circleAt(W / 2, H / 2, 0.4 * short);
  const placed: { motif: Motif; transform: LayerTransform }[] = [];

  const recipe = rng.pick(['mandala-web', 'mandala-web', 'star-ring', 'stitched-star', 'garland', 'pair', 'net', 'gallery-frame', 'framed-centrepiece'] as const);
  switch (recipe) {
    case 'mandala-web': {
      const web = spider(rng);
      const spokes = web.params.spokes as number;
      placed.push({ motif: web, transform: centre });
      placed.push({ motif: stringArt(rng, spokes), transform: centre });
      if (rng.chance(0.35)) {
        const s = star(rng, spokes);
        s.params.copies = 1;
        placed.push({ motif: s, transform: centre });
      }
      break;
    }
    case 'star-ring': {
      const s = star(rng);
      placed.push({ motif: stringArt(rng, s.params.points as number), transform: centre });
      placed.push({ motif: s, transform: centre });
      break;
    }
    case 'stitched-star': {
      const arms = rng.int(5, 8);
      placed.push({ motif: curveStitch(rng, arms), transform: centre });
      if (rng.chance(0.5)) placed.push({ motif: star(rng, arms), transform: centre });
      else placed.push({ motif: stringArt(rng, arms), transform: centre });
      break;
    }
    case 'garland': {
      // Photo garland across the top, a centrepiece below it.
      const top = { x: W / 2, y: 0.2 * H, scaleX: 0.42 * W, scaleY: 0.12 * H, rotation: 0 };
      const regionTop = 0.4 * H;
      const r = Math.min((H - margin - regionTop) / 2, 0.4 * W);
      placed.push({ motif: swag(rng), transform: top });
      placed.push({ motif: centrepiece(rng), transform: circleAt(W / 2, regionTop + r, r) });
      break;
    }
    case 'pair': {
      // Two motifs side by side along the wall's long axis.
      const landscape = W >= H;
      const long = landscape ? W : H;
      const r = Math.min(0.2 * long, (landscape ? H : W) / 2 - margin);
      const a = centrepiece(rng);
      let b = centrepiece(rng);
      if (b.generatorId === a.generatorId) b = centrepiece(rng);
      const pos = (f: number) => (landscape ? circleAt(W * f, H / 2, r) : circleAt(W / 2, H * f, r));
      placed.push({ motif: a, transform: pos(0.27) });
      placed.push({ motif: b, transform: pos(0.73) });
      break;
    }
    case 'net': {
      const m = rng.chance(0.5) ? lattice(rng) : organic(rng);
      placed.push({ motif: m, transform: circleAt(W / 2, H / 2, 0.42 * short) });
      if (rng.chance(0.4)) {
        const top = { x: W / 2, y: 0.08 * H + margin, scaleX: 0.4 * W, scaleY: 0.06 * H, rotation: 0 };
        // Only add a garland if it clears the net's top edge.
        if (top.y + top.scaleY < H / 2 - 0.42 * short) placed.push({ motif: swag(rng), transform: top });
      }
      break;
    }
    case 'gallery-frame': {
      // A practical photo display: rows or a zig-zag inside a frame, maybe with an accent
      // on the very same nails.
      const t = frameTransform(wall);
      const base = galleryFrame(rng);
      placed.push({ motif: base, transform: t });
      if (rng.chance(0.45)) placed.push({ motif: frameAccent(rng, base), transform: t });
      break;
    }
    case 'framed-centrepiece': {
      const t = frameTransform(wall);
      placed.push({
        motif: {
          generatorId: 'frame',
          name: 'Frame',
          sag: 0,
          params: { pattern: 'border', nailsX: rng.int(7, 13), nailsY: rng.int(7, 13), outline: true },
        },
        transform: t,
      });
      const r = 0.72 * Math.min(t.scaleX, t.scaleY);
      const inner = rng.chance(0.5) ? star(rng) : stringArt(rng);
      placed.push({ motif: inner, transform: circleAt(t.x, t.y, r) });
      break;
    }
  }

  const layers: SurpriseLayer[] = placed.map(({ motif, transform }) => {
    const g = get(motif.generatorId);
    const defaults = g ? schemaDefaults(g.schema) : {};
    return {
      name: motif.name,
      generatorId: motif.generatorId,
      params: { ...defaults, ...motif.params },
      seed: rng.int(1, 2 ** 31 - 2),
      transform,
      sag: motif.sag,
    };
  });
  return { layers, palette: palette(rng, layers.length) };
}
