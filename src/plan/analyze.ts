/** Practicality analysis + photo capacity (see contracts/plan.ts). */
import type { Edge, EdgeId, NailId, ResolvedDesign, Vec2 } from '@/contracts/design';
import type { AnalyzeOptions, BuildPlan, Issue, PhotoSpec, Report } from '@/contracts/plan';
import { defaultAnalyzeOptions } from '@/contracts/defaults';
import { bbox, chordAngleDeg, clamp, dist, sagLength } from '@/lib/geom';
import { formatLength } from '@/lib/units';

export function edgeLengthImpl(edge: Edge, a: Vec2, b: Vec2): number {
  return sagLength(a, b, edge.sag);
}

export function photoSlotsImpl(
  a: Vec2,
  b: Vec2,
  opts: Pick<AnalyzeOptions, 'maxPhotoAngleDeg' | 'endClearance'> & { photo: PhotoSpec },
): { slots: number; score: number } {
  const L = dist(a, b);
  const theta = chordAngleDeg(a, b);
  const pitch = opts.photo.width + opts.photo.gap;
  const slots =
    theta <= opts.maxPhotoAngleDeg && pitch > 0 ? Math.max(0, Math.floor((L - 2 * opts.endClearance) / pitch)) : 0;
  const score = slots > 0 ? clamp(opts.maxPhotoAngleDeg > 0 ? 1 - theta / opts.maxPhotoAngleDeg : 1, 0, 1) : 0;
  return { slots, score };
}

/** Pairs of nails (by index, i < j) closer than `minSpacing`, found with a spatial hash. */
export function closeNailPairs(points: Vec2[], minSpacing: number): [number, number][] {
  const out: [number, number][] = [];
  if (!(minSpacing > 0) || points.length < 2) return out;
  const cell = minSpacing;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  points.forEach((p, i) => {
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  });
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (const j of list) if (j > i && dist(p, points[j]) < minSpacing) out.push([i, j]);
      }
    }
  });
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

export function analyzeImpl(resolved: ResolvedDesign, opts?: Partial<AnalyzeOptions>, plan?: BuildPlan): Report {
  const units = resolved.wall.units;
  const base = defaultAnalyzeOptions(units);
  const o: AnalyzeOptions = { ...base, ...opts, photo: { ...base.photo, ...opts?.photo } };
  const fmt = (v: number) => formatLength(v, units, 2);

  const pos = new Map<NailId, Vec2>(resolved.nails.map((p) => [p.id, { x: p.x, y: p.y }]));
  const nailLoad: Record<NailId, number> = Object.create(null);
  for (const p of resolved.nails) nailLoad[p.id] = 0;
  const edgeScore: Record<EdgeId, number> = Object.create(null);
  const photoSlots: Record<EdgeId, number> = Object.create(null);
  let twineLength = 0;
  let totalSlots = 0;

  const errors: Issue[] = [];
  const warns: Issue[] = [];
  const infos: Issue[] = [];
  const shortEdges: Issue[] = [];

  for (const e of resolved.edges) {
    nailLoad[e.a] = (nailLoad[e.a] ?? 0) + 1;
    nailLoad[e.b] = (nailLoad[e.b] ?? 0) + 1;
    const a = pos.get(e.a)!;
    const b = pos.get(e.b)!;
    const length = edgeLengthImpl(e, a, b);
    twineLength += length;
    const ps = photoSlotsImpl(a, b, o);
    photoSlots[e.id] = ps.slots;
    edgeScore[e.id] = ps.score;
    totalSlots += ps.slots;
    if (length < o.minEdgeLength) {
      shortEdges.push({
        id: `edge-too-short:${e.id}`,
        kind: 'edge-too-short',
        severity: 'warn',
        message: `Twine between these nails is only ${fmt(length)} long (minimum ${fmt(o.minEdgeLength)}); it will be hard to string and hang photos on.`,
        nailIds: [e.a, e.b],
        edgeIds: [e.id],
      });
    }
  }

  // Errors: nails off the wall.
  const { width, height } = resolved.wall;
  for (const p of resolved.nails) {
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) {
      errors.push({
        id: `nail-outside-wall:${p.id}`,
        kind: 'nail-outside-wall',
        severity: 'error',
        message: `A nail at (${fmt(p.x)}, ${fmt(p.y)}) is outside the ${fmt(width)} × ${fmt(height)} wall area.`,
        nailIds: [p.id],
      });
    }
  }

  // Warnings: crowded nails, overloaded nails, short edges.
  for (const [i, j] of closeNailPairs(resolved.nails, o.minNailSpacing)) {
    const p = resolved.nails[i];
    const q = resolved.nails[j];
    warns.push({
      id: `nails-too-close:${p.id}|${q.id}`,
      kind: 'nails-too-close',
      severity: 'warn',
      message: `Two nails are only ${fmt(dist(p, q))} apart (minimum ${fmt(o.minNailSpacing)}); the wall may crack or the twine may slip between them.`,
      nailIds: [p.id, q.id],
    });
  }
  for (const p of resolved.nails) {
    const load = nailLoad[p.id];
    if (load > o.maxNailLoad) {
      warns.push({
        id: `nail-overload:${p.id}`,
        kind: 'nail-overload',
        severity: 'warn',
        message: `${load} strands meet at one nail (maximum ${o.maxNailLoad}); it may pull out or run out of room for wraps.`,
        nailIds: [p.id],
        edgeIds: resolved.edges.filter((e) => e.a === p.id || e.b === p.id).map((e) => e.id),
      });
    }
  }
  warns.push(...shortEdges);

  // Info: hairpins from the plan, no photo space.
  if (plan) {
    for (const run of plan.runs) {
      run.steps.forEach((s, i) => {
        if (!s.hairpin) return;
        const next = run.steps[i + 1];
        infos.push({
          id: `hairpin:${run.id}:${i}`,
          kind: 'hairpin',
          severity: 'info',
          message: `Run ${run.id} doubles back sharply at a nail (step ${i + 1}); wrap it firmly so the twine doesn't slip off.`,
          nailIds: [s.to],
          edgeIds: next ? [s.edgeId, next.edgeId] : [s.edgeId],
        });
      });
    }
  }
  if (resolved.edges.length > 0 && totalSlots === 0) {
    infos.push({
      id: 'no-photo-space',
      kind: 'no-photo-space',
      severity: 'info',
      message: `No strand is long and level enough for a photo (needs about ${fmt(2 * o.endClearance + o.photo.width)} of twine within ${o.maxPhotoAngleDeg}° of horizontal).`,
    });
  }

  return {
    issues: [...errors, ...warns, ...infos],
    nailLoad,
    edgeScore,
    photoSlots,
    stats: {
      nails: resolved.nails.length,
      edges: resolved.edges.length,
      twineLength,
      photoSlots: totalSlots,
      bbox: bbox(resolved.nails),
    },
  };
}
