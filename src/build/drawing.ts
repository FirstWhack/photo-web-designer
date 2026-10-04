/**
 * The engineering drawing as a pure "drawing model": lists of lines, polylines, circles, rects
 * and texts in sheet millimetres. Rendered twice: to SVG (`PlanSheet`) and to jsPDF
 * (`exportPlanPdf`), so screen and paper match exactly.
 */
import type { NailId, ResolvedDesign, Units, Vec2 } from '@/contracts/design';
import type { BuildPlan, Report } from '@/contracts/plan';
import type { MeasureOrigin } from '@/contracts/ui';
import { clamp, dist, pointOnSag, sagPoints, tangentOnSag } from '@/lib/geom';
import { formatMeasure, formatTwine } from '@/lib/units';
import { nailDimensions, type AxisDims } from './dimensions';
import { clothespinCount, formatBuyable, groupTotals, nailSpares } from './shopping';
import { mmPerUnit, rowName } from './tiles';

export type PlanPaper = 'tabloid' | 'letter' | 'a3' | 'a4';

/** Landscape sheet sizes in mm. */
export const SHEET_MM: Record<PlanPaper, { w: number; h: number }> = {
  tabloid: { w: 431.8, h: 279.4 },
  a3: { w: 420, h: 297 },
  letter: { w: 279.4, h: 215.9 },
  a4: { w: 297, h: 210 },
};

export const PAPER_LABEL: Record<PlanPaper, string> = { tabloid: 'Tabloid', a3: 'A3', letter: 'Letter', a4: 'A4' };

/** Standard drawing scales (denominators), largest drawing first. */
export const SCALES: Record<Units, number[]> = {
  in: [2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96],
  cm: [2, 5, 10, 20, 25, 50, 100],
};

export type Anchor = 'start' | 'middle' | 'end';
export type Prim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color?: string; dash?: number[] }
  | { kind: 'poly'; pts: Vec2[]; w: number; color?: string; dash?: number[]; closed?: boolean; fill?: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; w: number; stroke?: string | null; fill?: string | null }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; w: number; stroke?: string | null; fill?: string | null }
  | { kind: 'text'; x: number; y: number; text: string; size: number; anchor?: Anchor; rotate?: -90; bold?: boolean; color?: string };

export interface Sheet {
  items: Prim[];
}

export interface PlanDrawingOptions {
  paper?: PlanPaper;
  origin?: MeasureOrigin;
  title?: string;
  report?: Report;
  /** Shown in the title block; defaults to today (YYYY-MM-DD). */
  date?: string;
}

export interface PlanDrawing {
  paper: PlanPaper;
  width: number;
  height: number;
  units: Units;
  origin: MeasureOrigin;
  scale: { den: number; label: string; k: number };
  /** Sheet-mm rectangle of the drawing field and of the wall inside it. */
  field: { x: number; y: number; w: number; h: number };
  wall: { x: number; y: number; w: number; h: number };
  nails: { id: NailId; label: string; x: number; y: number; labelled: boolean }[];
  tags: { runId: string; letter: string; x: number; y: number }[];
  nailRows: { label: string; x: string; y: string; sheet: number }[];
  runRows: { letter: string; name: string; color: string; route: string; cut: string; sheet: number }[];
  dims: { x: AxisDims; y: AxisDims };
  sheets: Sheet[];
}

// ── text metrics (Helvetica-ish, in em) ─────────────────────────────────

function charW(ch: string): number {
  if (ch >= '0' && ch <= '9') return 0.556;
  if (ch === ' ') return 0.278;
  if ('.,:;\'|!ilIjft()[]'.includes(ch)) return 0.3;
  if (ch === '/' || ch === '-') return 0.333;
  if (ch === '"') return 0.355;
  if (ch === '–' || ch === '#' || ch === '+' || ch === '=' || ch === '@') return 0.6;
  if (ch === '…') return 1;
  if ('mwMW'.includes(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.69;
  return 0.53;
}

/** Estimated rendered width (mm) of `s` at font size `size` (mm). */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += charW(ch);
  return w * size * (bold ? 1.07 : 1);
}

const capH = (size: number) => size * 0.72;

function truncate(s: string, size: number, maxW: number, bold = false): string {
  if (textWidth(s, size, bold) <= maxW) return s;
  let t = s;
  while (t.length > 1 && textWidth(t + '…', size, bold) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function wrap(s: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > maxW) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

// ── collision boxes ─────────────────────────────────────────────────────

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

class Occupancy {
  private cells = new Map<string, Box[]>();
  constructor(private cell = 6) {}
  private *keys(b: Box) {
    const c = this.cell;
    for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++)
      for (let j = Math.floor(b.y0 / c); j <= Math.floor(b.y1 / c); j++) yield `${i},${j}`;
  }
  hits(b: Box): boolean {
    for (const k of this.keys(b))
      for (const o of this.cells.get(k) ?? []) if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
    return false;
  }
  add(b: Box) {
    for (const k of this.keys(b)) {
      const list = this.cells.get(k);
      if (list) list.push(b);
      else this.cells.set(k, [b]);
    }
  }
}

const within = (b: Box, r: Box) => b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;

// ── ink: a tiny builder for primitives ─────────────────────────────────

const INK = '#000';
const r2 = (v: number) => Math.round(v * 100) / 100;

class Ink {
  items: Prim[] = [];
  line(x1: number, y1: number, x2: number, y2: number, w = 0.18, o: { color?: string; dash?: number[] } = {}) {
    this.items.push({ kind: 'line', x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), w, ...o });
  }
  poly(pts: Vec2[], w: number, o: { color?: string; dash?: number[]; closed?: boolean; fill?: string } = {}) {
    this.items.push({ kind: 'poly', pts: pts.map((p) => ({ x: r2(p.x), y: r2(p.y) })), w, ...o });
  }
  circle(cx: number, cy: number, r: number, w = 0.18, o: { stroke?: string | null; fill?: string | null } = {}) {
    this.items.push({ kind: 'circle', cx: r2(cx), cy: r2(cy), r, w, ...o });
  }
  rect(x: number, y: number, width: number, height: number, w = 0.18, o: { stroke?: string | null; fill?: string | null } = {}) {
    this.items.push({ kind: 'rect', x: r2(x), y: r2(y), width: r2(width), height: r2(height), w, ...o });
  }
  text(x: number, y: number, text: string, size: number, o: { anchor?: Anchor; rotate?: -90; bold?: boolean; color?: string } = {}) {
    this.items.push({ kind: 'text', x: r2(x), y: r2(y), text, size, ...o });
  }
  /** 45° architectural tick at (x, y). */
  tick(x: number, y: number) {
    this.line(x - 0.8, y + 0.8, x + 0.8, y - 0.8, 0.3);
  }
}

// ── sizes ───────────────────────────────────────────────────────────────

const B = 7; // border inset
const P = 11; // content inset
const DIM = 2.2;
const TAB = 2.1;
const HEAD = 2.8;
const RH = 3.3; // schedule row height
const EXT_GAP = 3.5; // gap between the wall and the start of extension lines
const TB_H = 43;
const NAILS_ON_SHEET_1 = 60;
const TWINE_ON_SHEET_1 = 12;

/** Dash patterns per run, so pieces read apart in black & white. */
export const RUN_DASHES: number[][] = [
  [],
  [2.6, 0.9],
  [0.9, 0.7],
  [3.6, 0.8, 0.8, 0.8],
  [5, 1.4],
  [1.6, 0.6, 0.4, 0.6],
  [3, 0.7, 0.7, 0.7, 0.7, 0.7],
  [1.2, 1.6],
];

const NOTE_TEXT = (units: Units, origin: MeasureOrigin) => [
  `ALL DIMENSIONS ARE FROM THE DATUM (${origin.toUpperCase()} CORNER OF THE WALL AREA), IN ${units === 'in' ? 'INCHES' : 'CENTIMETRES'}.`,
  'MARK NAIL POSITIONS WITH A PENCIL USING A TAPE AND LEVEL BEFORE NAILING.',
  `DRIVE NAILS AT A SLIGHT UPWARD ANGLE, LEAVING ABOUT ${units === 'in' ? '3/8"' : '1 CM'} PROUD.`,
  'TIE ON AT THE START NAIL OF EACH PIECE AND WRAP ONCE AROUND EVERY NAIL IN THE ORDER LISTED. TIE OFF AT THE END.',
  'CUT LENGTHS INCLUDE TAILS AND 10% WASTE.',
];

/** Smallest standard scale (largest drawing) at which `size` fits into `avail`. */
export function chooseScale(units: Units, wall: { width: number; height: number }, avail: { w: number; h: number }): number {
  const u = mmPerUnit(units);
  const list = SCALES[units];
  return list.find((den) => (wall.width * u) / den <= avail.w && (wall.height * u) / den <= avail.h) ?? list[list.length - 1];
}

/** "1–5–9–13–1", shortened to "1–5–…–1 (40 nails)" when it doesn't fit `maxW`. */
export function routeText(labels: string[], size: number, maxW: number): string {
  const full = labels.join('–');
  if (textWidth(full, size) <= maxW) return full;
  const tail = `–…–${labels[labels.length - 1]} (${labels.length} nails)`;
  for (let k = labels.length - 2; k >= 1; k--) {
    const s = labels.slice(0, k).join('–') + tail;
    if (textWidth(s, size) <= maxW) return s;
  }
  return `${labels[0]}${tail}`;
}

export function buildPlanDrawing(resolved: ResolvedDesign, plan: BuildPlan, opts: PlanDrawingOptions = {}): PlanDrawing {
  const paper = opts.paper ?? 'tabloid';
  const origin = opts.origin ?? 'top-left';
  const { w: W, h: H } = SHEET_MM[paper];
  const { units } = resolved.wall;
  const title = opts.title?.trim() || 'Photo web';
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const dims = nailDimensions(resolved, origin);
  const fromRight = origin.endsWith('right');
  const fromBottom = origin.startsWith('bottom');

  // ── sheet regions ──
  const colW = clamp(W * 0.29, 82, 128);
  const colX1 = W - P;
  const colX0 = colX1 - colW;
  const field = { x: P, y: P, w: colX0 - 8 - P, h: H - 2 * P };
  const tb = { x0: colX0 - 4, x1: W - B, y1: H - B, y0: H - B - TB_H };

  // ── dimension bands (independent of scale: they depend on text only) ──
  const runMaxX = Math.max(0, ...dims.x.running.map((d) => textWidth(d.text, DIM)));
  const runMaxY = Math.max(0, ...dims.y.running.map((d) => textWidth(d.text, DIM)));
  const topBand = EXT_GAP + 1.5 + 1 + runMaxX + 3.5 + 6 + 3.5;
  const leftBand = EXT_GAP + 1.5 + 1 + runMaxY + 3.5 + 6 + 3.5;
  const rightBand = 12;
  const bottomBand = 16;
  const avail = { w: field.w - leftBand - rightBand, h: field.h - topBand - bottomBand };
  const den = chooseScale(units, resolved.wall, avail);
  const k = mmPerUnit(units) / den;
  const wallW = resolved.wall.width * k;
  const wallH = resolved.wall.height * k;
  const wx = field.x + leftBand + Math.max(0, (avail.w - wallW) / 2);
  const wy = field.y + topBand + Math.max(0, (avail.h - wallH) / 2) * 0.5;
  const S = (p: Vec2) => ({ x: wx + p.x * k, y: wy + p.y * k });
  const X = (v: number) => (fromRight ? wx + wallW - v * k : wx + v * k);
  const Y = (v: number) => (fromBottom ? wy + wallH - v * k : wy + v * k);

  const sheet1 = new Ink();
  const ink = sheet1;
  const occ = new Occupancy();
  const labelArea: Box = { x0: wx - 2.5, y0: wy - 2.5, x1: wx + wallW + 2.5, y1: wy + wallH + 2.5 };

  // ── twine ──
  const nailById = new Map(resolved.nails.map((n) => [n.id, n]));
  const edgeById = new Map(resolved.edges.map((e) => [e.id, e]));
  const groupById = new Map(resolved.groups.map((g) => [g.id, g]));
  const dense = resolved.edges.length > 400;
  const runLetters = plan.runs.map((_, i) => rowName(i));
  plan.runs.forEach((run, i) => {
    const pts: Vec2[] = [];
    for (const st of run.steps) {
      const a = nailById.get(st.from);
      const b = nailById.get(st.to);
      if (!a || !b) continue;
      const sag = edgeById.get(st.edgeId)?.sag ?? 0;
      const seg = sagPoints(a, b, sag, sag > 0 ? 12 : 1).map(S);
      pts.push(...(pts.length ? seg.slice(1) : seg));
    }
    if (pts.length > 1) {
      ink.poly(pts, dense ? 0.16 : 0.3, { color: groupById.get(run.groupId)?.color ?? '#777', dash: RUN_DASHES[i % RUN_DASHES.length] });
    }
  });

  // ── wall, centre lines ──
  ink.rect(wx, wy, wallW, wallH, 0.7, { stroke: INK });
  const CL_DASH = [6, 1, 1, 1];
  const cy = wy + wallH / 2;
  const cx = wx + wallW / 2;
  ink.line(wx - 3, cy, wx + wallW + 3, cy, 0.18, { dash: CL_DASH });
  ink.line(cx, wy - 1.5, cx, wy + wallH + 3, 0.18, { dash: CL_DASH });
  ink.text(wx + wallW + 3.6, cy - 0.7, 'CL', 1.8, { bold: true });
  ink.text(wx + wallW + 3.6, cy + 2.3, 'LEVEL', 1.6);
  ink.text(cx + 0.8, wy + wallH + 4, 'CL', 1.8, { bold: true });

  // ── datum ──
  const dpt = { x: fromRight ? wx + wallW : wx, y: fromBottom ? wy + wallH : wy };
  {
    const R = 2;
    ink.circle(dpt.x, dpt.y, R, 0.25, { stroke: INK, fill: '#fff' });
    for (const a0 of [0, Math.PI]) {
      const arc: Vec2[] = [{ x: dpt.x, y: dpt.y }];
      for (let i = 0; i <= 8; i++) {
        const a = a0 - (i / 8) * (Math.PI / 2);
        arc.push({ x: dpt.x + R * Math.cos(a), y: dpt.y + R * Math.sin(a) });
      }
      ink.poly(arc, 0.1, { closed: true, fill: INK, color: INK });
    }
    const sx = fromRight ? 1 : -1;
    const sy = fromBottom ? 1 : -1;
    ink.text(dpt.x + sx * 3, dpt.y + sy * 3 + (sy > 0 ? capH(2.4) : 0), 'DATUM', 2.4, {
      bold: true,
      anchor: sx < 0 ? 'end' : 'start',
    });
  }

  // ── nails (symbols) ──
  const labels = Object.fromEntries(dims.rows.map((r) => [r.id, r.label]));
  const nailPts = resolved.nails.map((n) => ({ id: n.id, label: labels[n.id], ...S(n) }));
  let minD = Infinity;
  if (nailPts.length < 3000) {
    for (let i = 0; i < nailPts.length; i++)
      for (let j = i + 1; j < nailPts.length; j++) minD = Math.min(minD, dist(nailPts[i], nailPts[j]) || Infinity);
  }
  const nr = clamp(Number.isFinite(minD) ? minD * 0.38 : 1.1, 0.45, 1.1);
  for (const n of nailPts) {
    ink.circle(n.x, n.y, nr, 0.18, { stroke: INK, fill: '#fff' });
    ink.line(n.x - nr * 1.6, n.y, n.x + nr * 1.6, n.y, 0.13);
    ink.line(n.x, n.y - nr * 1.6, n.x, n.y + nr * 1.6, 0.13);
    occ.add({ x0: n.x - nr, y0: n.y - nr, x1: n.x + nr, y1: n.y + nr });
  }

  // ── run tags + direction arrows ──
  const DIRS: [number, number][] = [
    [-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1],
  ];
  const tags: PlanDrawing['tags'] = [];
  const TR = 1.8;
  plan.runs.forEach((run, i) => {
    const first = run.steps[0];
    const s = nailById.get(run.nails[0]);
    if (!s) return;
    const sp = S(s);
    // Direction arrow at the middle of the first piece of twine.
    if (first) {
      const a = nailById.get(first.from)!;
      const b = nailById.get(first.to)!;
      const sag = edgeById.get(first.edgeId)?.sag ?? 0;
      const m = S(pointOnSag(a, b, sag, 0.5));
      const t = tangentOnSag(a, b, sag, 0.5);
      const nx = -t.y;
      const ny = t.x;
      const L = dense ? 1.6 : 2.2;
      ink.poly(
        [
          { x: m.x + t.x * L * 0.6, y: m.y + t.y * L * 0.6 },
          { x: m.x - t.x * L * 0.4 + nx * L * 0.35, y: m.y - t.y * L * 0.4 + ny * L * 0.35 },
          { x: m.x - t.x * L * 0.4 - nx * L * 0.35, y: m.y - t.y * L * 0.4 - ny * L * 0.35 },
        ],
        0.1,
        { closed: true, fill: INK, color: INK },
      );
    }
    // Prefer the side away from the first step.
    let away: Vec2 = { x: -1, y: -1 };
    if (first) {
      const b = S(nailById.get(first.to)!);
      const l = Math.hypot(sp.x - b.x, sp.y - b.y) || 1;
      away = { x: (sp.x - b.x) / l, y: (sp.y - b.y) / l };
    }
    const cands = [away, ...DIRS.map(([dx, dy]) => ({ x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) }))];
    let at: Vec2 | null = null;
    for (const d of [nr + TR + 1.2, nr + TR + 3.5, nr + TR + 6.5]) {
      for (const c of cands) {
        const p = { x: sp.x + c.x * d, y: sp.y + c.y * d };
        const box = { x0: p.x - TR, y0: p.y - TR, x1: p.x + TR, y1: p.y + TR };
        if (within(box, labelArea) && !occ.hits(box)) {
          at = p;
          break;
        }
      }
      if (at) break;
    }
    at ??= { x: sp.x + cands[0].x * (nr + TR + 1.2), y: sp.y + cands[0].y * (nr + TR + 1.2) };
    occ.add({ x0: at.x - TR, y0: at.y - TR, x1: at.x + TR, y1: at.y + TR });
    const dl = Math.hypot(at.x - sp.x, at.y - sp.y);
    if (dl > TR + nr + 0.3) {
      const ux = (at.x - sp.x) / dl;
      const uy = (at.y - sp.y) / dl;
      ink.line(sp.x + ux * nr, sp.y + uy * nr, at.x - ux * TR, at.y - uy * TR, 0.15);
    }
    ink.circle(at.x, at.y, TR, 0.25, { stroke: INK, fill: '#fff' });
    const letter = runLetters[i];
    const ts = letter.length > 1 ? 1.6 : 2.1;
    ink.text(at.x, at.y + capH(ts) / 2, letter, ts, { anchor: 'middle', bold: true });
    tags.push({ runId: run.id, letter, x: r2(at.x), y: r2(at.y) });
  });

  // ── nail numbers ──
  const NS = nailPts.length > 120 ? 1.6 : nailPts.length > 50 ? 1.8 : 2.0;
  const nailsOut: PlanDrawing['nails'] = [];
  for (const n of [...nailPts].sort((a, b) => Number(a.label) - Number(b.label))) {
    const tw = textWidth(n.label, NS);
    const th = capH(NS);
    let placed: Box | null = null;
    outer: for (const extra of [0, 1.2, 2.6]) {
      for (const [dx, dy] of DIRS) {
        const g = nr + 0.6 + extra;
        const gd = dx !== 0 && dy !== 0 ? g * 0.72 : g;
        const x0 = dx > 0 ? n.x + gd : dx < 0 ? n.x - gd - tw : n.x - tw / 2;
        const y1 = dy < 0 ? n.y - gd : dy > 0 ? n.y + gd + th : n.y + th / 2;
        const box = { x0: x0 - 0.15, y0: y1 - th - 0.15, x1: x0 + tw + 0.15, y1: y1 + 0.15 };
        if (within(box, labelArea) && !occ.hits(box)) {
          placed = box;
          break outer;
        }
      }
    }
    if (placed) {
      occ.add(placed);
      ink.text(placed.x0 + 0.15, placed.y1 - 0.15, n.label, NS);
    }
    nailsOut.push({ id: n.id, label: n.label, x: r2(n.x), y: r2(n.y), labelled: !!placed });
  }
  nailsOut.sort((a, b) => Number(a.label) - Number(b.label));

  // ── dimensions ──
  drawAxis(ink, 'x', dims.x, X, wy, runMaxX);
  drawAxis(ink, 'y', dims.y, Y, wx, runMaxY);

  // ── view title ──
  ink.text(cx, wy + wallH + 10, 'WALL ELEVATION', 3.2, { anchor: 'middle', bold: true });
  ink.line(cx - textWidth('WALL ELEVATION', 3.2, true) / 2, wy + wallH + 11, cx + textWidth('WALL ELEVATION', 3.2, true) / 2, wy + wallH + 11, 0.3);
  ink.text(cx, wy + wallH + 14.2, `SCALE 1:${den}`, 2.2, { anchor: 'middle' });
  const omitted = nailsOut.filter((n) => !n.labelled).length;
  if (omitted) {
    ink.text(field.x, H - P, `${omitted} NAIL NUMBER${omitted > 1 ? 'S' : ''} OMITTED FOR CLARITY: SEE NAIL SCHEDULE.`, 1.8);
  }

  // ── right column: schedules, BOM, notes ──
  const nailRowsAll = dims.rows.map((r) => ({ label: r.label, x: formatMeasure(r.x, units), y: formatMeasure(r.y, units) }));
  const totals = groupTotals(resolved, plan);
  const runRowsAll = plan.runs.map((r, i) => {
    const g = groupById.get(r.groupId);
    return {
      letter: runLetters[i],
      name: g?.name ?? r.groupId,
      color: g?.color ?? '#777',
      dash: RUN_DASHES[i % RUN_DASHES.length],
      nails: r.nails.map((id) => labels[id] ?? '?'),
      cut: formatTwine(r.cutLength, units),
    };
  });

  const colTop = P;
  const colBottom = tb.y0 - 4;
  // Notes (bottom of the column).
  const notes = NOTE_TEXT(units, origin);
  const noteLines = notes.map((n) => wrap(n, TAB, colW - 5));
  const notesH = 5 + noteLines.reduce((s, l) => s + l.length * 2.9 + 0.8, 0);
  // Bill of materials.
  const nailCount = resolved.nails.length;
  const spares = nailSpares(nailCount);
  const bom: { item: string; qty: string; color?: string }[] = [
    ...totals.map((t) => ({
      item: `TWINE, ${(groupById.get(t.groupId)?.name ?? t.groupId).toUpperCase()}`,
      qty: formatBuyable(t.cut, units),
      color: groupById.get(t.groupId)?.color,
    })),
    { item: 'NAILS (SMALL PANEL PINS / BRADS)', qty: `${nailCount} + ${spares} SPARE = ${nailCount + spares}` },
    { item: 'CLOTHESPINS', qty: String(clothespinCount(resolved, opts.report)) },
  ];
  const bomH = 5 + RH * (bom.length + 1) + 1;
  const budgetBom = colBottom - notesH - 4 - bomH;
  let twineRows1 = Math.min(runRowsAll.length, TWINE_ON_SHEET_1);
  const twineH = (n: number) => (n ? 5 + RH * (n + 1) + (n < runRowsAll.length ? 3.5 : 0) + 1 : 0);
  const minNailH = 5 + RH * 5;
  while (twineRows1 > 1 && budgetBom - 4 - twineH(twineRows1) - 4 - colTop < minNailH) twineRows1--;
  const nailH = budgetBom - 4 - twineH(twineRows1) - 4 - colTop;

  const nailRows: PlanDrawing['nailRows'] = [];
  const runRows: PlanDrawing['runRows'] = [];

  const { placed: placedNails, height: nailTabH } = nailTable(ink, nailRowsAll, colX0, colTop, colW, nailH - 4, 'NAIL SCHEDULE', NAILS_ON_SHEET_1);
  nailRowsAll.slice(0, placedNails).forEach((r) => nailRows.push({ ...r, sheet: 1 }));
  if (placedNails < nailRowsAll.length) {
    const yNote = colTop + nailTabH + 3.5;
    ink.text(colX0, yNote, `NAILS #${nailRowsAll[placedNails].label}–#${nailRowsAll[nailRowsAll.length - 1].label}: SEE SHEET 2.`, TAB, { bold: true });
  }
  const nailSecH = nailTabH + (placedNails < nailRowsAll.length ? 4 : 0);
  const twineY = colTop + nailSecH + 5;
  const bomY = twineY + twineH(twineRows1) + (twineRows1 ? 4 : 0);
  const notesY = bomY + bomH + 4;
  if (twineRows1) {
    twineTable(ink, runRowsAll.slice(0, twineRows1), colX0, twineY, colW, 'TWINE SCHEDULE');
    runRowsAll.slice(0, twineRows1).forEach((r) => runRows.push({ letter: r.letter, name: r.name, color: r.color, route: r.nails.join('–'), cut: r.cut, sheet: 1 }));
    if (twineRows1 < runRowsAll.length) {
      ink.text(colX0, twineY + twineH(twineRows1) - 2, `PIECES ${runRowsAll[twineRows1].letter}–${runRowsAll[runRowsAll.length - 1].letter}: SEE SHEET 2.`, TAB, { bold: true });
    }
  }
  // BOM
  ink.text(colX0, bomY + 3.2, 'BILL OF MATERIALS', HEAD, { bold: true });
  {
    const top = bomY + 5;
    const qtyW = Math.max(...bom.map((b) => textWidth(b.qty, TAB)), textWidth('QTY', TAB, true)) + 3;
    ink.rect(colX0, top, colW, RH * (bom.length + 1), 0.25, { stroke: INK });
    ink.line(colX0, top + RH, colX0 + colW, top + RH, 0.25);
    ink.line(colX0 + colW - qtyW, top, colX0 + colW - qtyW, top + RH * (bom.length + 1), 0.15);
    ink.text(colX0 + 1, top + RH - 0.9, 'ITEM', TAB * 0.9, { bold: true });
    ink.text(colX0 + colW - 1, top + RH - 0.9, 'QTY', TAB * 0.9, { bold: true, anchor: 'end' });
    bom.forEach((b, i) => {
      const y = top + RH * (i + 2) - 0.9;
      let x = colX0 + 1;
      if (b.color) {
        ink.rect(x, y - 2.1, 2.4, 2.4, 0.12, { stroke: INK, fill: b.color });
        x += 3.4;
      }
      ink.text(x, y, truncate(b.item, TAB, colW - qtyW - (x - colX0) - 1), TAB);
      ink.text(colX0 + colW - 1, y, b.qty, TAB, { anchor: 'end' });
    });
  }
  // Notes
  ink.text(colX0, notesY + 3.2, 'GENERAL NOTES', HEAD, { bold: true });
  {
    let y = notesY + 5 + 2.4;
    noteLines.forEach((lines, i) => {
      ink.text(colX0, y, `${i + 1}.`, TAB);
      lines.forEach((l) => {
        ink.text(colX0 + 4, y, l, TAB);
        y += 2.9;
      });
      y += 0.8;
    });
  }

  // ── continuation sheets ──
  const sheets: Ink[] = [sheet1];
  let nailRest = nailRowsAll.slice(placedNails);
  let runRest = runRowsAll.slice(twineRows1);
  while (nailRest.length || runRest.length) {
    const sh = new Ink();
    const no = sheets.length + 1;
    sheets.push(sh);
    const area = { x: P, y: P, w: W - 2 * P, h: tb.y0 - 4 - P };
    let y = area.y;
    if (nailRest.length) {
      const { placed: n, height: nh } = nailTable(sh, nailRest, area.x, y, area.w, area.h, 'NAIL SCHEDULE (CONTINUED)', Infinity);
      nailRest.slice(0, n).forEach((r) => nailRows.push({ ...r, sheet: no }));
      y += nh + 8;
      nailRest = nailRest.slice(n);
      if (nailRest.length) continue;
    }
    if (runRest.length) {
      const fit = Math.max(1, Math.floor((area.y + area.h - y - 5) / RH) - 1);
      const n = Math.min(fit, runRest.length);
      twineTable(sh, runRest.slice(0, n), area.x, y, area.w, 'TWINE SCHEDULE (CONTINUED)');
      runRest.slice(0, n).forEach((r) => runRows.push({ letter: r.letter, name: r.name, color: r.color, route: r.nails.join('–'), cut: r.cut, sheet: no }));
      runRest = runRest.slice(n);
    }
  }

  // ── border + title block on every sheet ──
  const scaleBar = { k, units };
  sheets.forEach((sh, i) => {
    sh.rect(B, B, W - 2 * B, H - 2 * B, 0.5, { stroke: INK });
    if (i === 0) sh.line(tb.x0, B, tb.x0, tb.y0, 0.35);
    titleBlock(sh, tb, { title, wall: resolved.wall, den, date, sheet: i + 1, of: sheets.length }, scaleBar);
  });

  return {
    paper,
    width: W,
    height: H,
    units,
    origin,
    scale: { den, label: `1:${den}`, k },
    field,
    wall: { x: r2(wx), y: r2(wy), w: r2(wallW), h: r2(wallH) },
    nails: nailsOut,
    tags,
    nailRows,
    runRows,
    dims,
    sheets: sheets.map((s) => ({ items: s.items })),
  };
}

// ── dimension chains ────────────────────────────────────────────────────

/**
 * One axis of dimensions. For 'x' the tiers stack upward from the wall's top edge (`edge` = wall
 * top y); for 'y' they stack leftward from the wall's left edge (`edge` = wall left x).
 * `P(v)` maps a datum distance to the sheet coordinate along the axis.
 */
function drawAxis(ink: Ink, axis: 'x' | 'y', d: AxisDims, P: (v: number) => number, edge: number, runMax: number) {
  const runT = edge - EXT_GAP - 1.5;
  const chainT = runT - 1 - runMax - 3.5;
  const overallT = chainT - 6;
  const ext0 = edge - EXT_GAP;
  // Helpers in (along, across) coordinates.
  const L = (a1: number, c1: number, a2: number, c2: number, w = 0.18) =>
    axis === 'x' ? ink.line(a1, c1, a2, c2, w) : ink.line(c1, a1, c2, a2, w);
  const tick = (a: number, c: number) => (axis === 'x' ? ink.tick(a, c) : ink.tick(c, a));
  const ext = (a: number, to: number) => L(a, ext0, a, to - 1.2, 0.13);
  const along = (text: string, a: number, c: number, size = DIM) =>
    axis === 'x'
      ? ink.text(a, c - 0.9, text, size, { anchor: 'middle' })
      : ink.text(c - 0.9, a, text, size, { anchor: 'middle', rotate: -90 });

  // Extension lines: each position goes out to the outermost tier it appears on.
  const reach = new Map<number, number>();
  const key = (v: number) => Math.round(v * 1000) / 1000;
  const setReach = (v: number, t: number) => reach.set(key(v), Math.min(reach.get(key(v)) ?? Infinity, t));
  for (const r of d.running) setReach(r.value, runT);
  for (const s of d.chain) for (let i = 0; i <= s.count; i++) setReach(s.start + i * s.spacing, chainT);
  setReach(0, overallT);
  setReach(d.overall.value, overallT);
  for (const [v, t] of reach) ext(P(v), t);

  // Running (baseline) dimensions from the datum.
  if (d.running.length) {
    const vmax = Math.max(...d.running.map((r) => r.value));
    L(P(0), runT, P(vmax), runT);
    if (axis === 'x') ink.circle(P(0), runT, 0.7, 0.2, { stroke: INK, fill: '#fff' });
    else ink.circle(runT, P(0), 0.7, 0.2, { stroke: INK, fill: '#fff' });
    // Each label sits just before its extension line (left of it / above it), so it needs a clear
    // gap to the neighbouring extension line on that side.
    const minSp = capH(DIM) + 0.9;
    const lines = [...reach.keys()].map(P).sort((a, b) => a - b);
    for (const r of d.running) {
      const s = P(r.value);
      tick(s, runT);
      let prev = -Infinity;
      for (const q of lines) if (q < s - 1e-6) prev = q;
      if (s - prev < minSp) continue;
      if (axis === 'x') ink.text(s - 0.6, runT - 1, r.text, DIM, { rotate: -90 });
      else ink.text(runT - 1, s - 0.6, r.text, DIM, { anchor: 'end' });
    }
  }

  // Chain, with EQ SP groups.
  if (d.chain.length) {
    L(P(d.chain[0].start), chainT, P(d.chain[d.chain.length - 1].end), chainT);
    const seen = new Set<number>();
    for (const s of d.chain) {
      for (let i = 0; i <= s.count; i++) {
        const v = key(s.start + i * s.spacing);
        if (seen.has(v)) continue;
        seen.add(v);
        tick(P(v), chainT);
      }
      const span = Math.abs(P(s.end) - P(s.start));
      const text = [s.text, ...s.short].find((t) => textWidth(t, DIM) <= span - 1);
      if (text) along(text, (P(s.start) + P(s.end)) / 2, chainT);
    }
  }

  // Overall.
  L(P(0), overallT, P(d.overall.value), overallT);
  tick(P(0), overallT);
  tick(P(d.overall.value), overallT);
  along(d.overall.text, (P(0) + P(d.overall.value)) / 2, overallT, DIM * 1.1);
}

// ── schedules ───────────────────────────────────────────────────────────

type NailRow = { label: string; x: string; y: string };

function nailCols(rows: NailRow[], w: number) {
  const c0 = Math.max(textWidth('#', TAB, true), ...rows.map((r) => textWidth(r.label, TAB))) + 2.4;
  const c1 = Math.max(textWidth('X', TAB, true), ...rows.map((r) => textWidth(r.x, TAB))) + 3;
  const c2 = Math.max(textWidth('Y', TAB, true), ...rows.map((r) => textWidth(r.y, TAB))) + 3;
  const block = c0 + c1 + c2;
  const ncols = Math.max(1, Math.floor((w + 3) / (block + 3)));
  return { c0, c1, c2, block, ncols };
}

/** Nail schedule split into side-by-side column blocks. Returns how many rows were placed and the height used. */
function nailTable(ink: Ink, rows: NailRow[], x: number, y: number, w: number, maxH: number, title: string, limit: number): { placed: number; height: number } {
  if (!rows.length) {
    ink.text(x, y + 3.2, title, HEAD, { bold: true });
    ink.text(x, y + 8, 'NO NAILS.', TAB);
    return { placed: 0, height: 10 };
  }
  const { c0, c1, block, ncols } = nailCols(rows, w);
  const rowsPerCol = Math.max(1, Math.floor((maxH - 5) / RH) - 1);
  const placed = Math.min(rows.length, ncols * rowsPerCol, limit);
  const perCol = Math.min(rowsPerCol, Math.max(Math.ceil(placed / ncols), Math.min(placed, 20)));
  ink.text(x, y + 3.2, title, HEAD, { bold: true });
  const top = y + 5;
  for (let c = 0; c * perCol < placed; c++) {
    const bx = x + c * (block + 3);
    const chunk = rows.slice(c * perCol, Math.min(placed, (c + 1) * perCol));
    ink.rect(bx, top, block, RH * (chunk.length + 1), 0.25, { stroke: INK });
    ink.line(bx, top + RH, bx + block, top + RH, 0.25);
    ink.line(bx + c0, top, bx + c0, top + RH * (chunk.length + 1), 0.13);
    ink.line(bx + c0 + c1, top, bx + c0 + c1, top + RH * (chunk.length + 1), 0.13);
    ink.text(bx + c0 / 2, top + RH - 0.9, '#', TAB * 0.95, { anchor: 'middle', bold: true });
    ink.text(bx + c0 + c1 - 1.2, top + RH - 0.9, 'X', TAB * 0.95, { anchor: 'end', bold: true });
    ink.text(bx + block - 1.2, top + RH - 0.9, 'Y', TAB * 0.95, { anchor: 'end', bold: true });
    chunk.forEach((r, i) => {
      const ry = top + RH * (i + 2) - 0.9;
      if (i > 0 && i % 5 === 0) ink.line(bx, top + RH * (i + 1), bx + block, top + RH * (i + 1), 0.08);
      ink.text(bx + c0 / 2, ry, r.label, TAB, { anchor: 'middle' });
      ink.text(bx + c0 + c1 - 1.2, ry, r.x, TAB, { anchor: 'end' });
      ink.text(bx + block - 1.2, ry, r.y, TAB, { anchor: 'end' });
    });
  }
  return { placed, height: 5 + RH * (perCol + 1) };
}

type RunRow = { letter: string; name: string; color: string; dash: number[]; nails: string[]; cut: string };

function twineTable(ink: Ink, rows: RunRow[], x: number, y: number, w: number, title: string) {
  ink.text(x, y + 3.2, title, HEAD, { bold: true });
  const top = y + 5;
  const cPc = 6.5;
  const cLine = 9;
  const cName = Math.min(w * 0.3, Math.max(textWidth('TWINE', TAB, true), ...rows.map((r) => textWidth(r.name, TAB))) + 5);
  const cCut = Math.max(textWidth('CUT', TAB, true), ...rows.map((r) => textWidth(r.cut, TAB))) + 3;
  const cRoute = w - cPc - cLine - cName - cCut;
  const xs = [x, x + cPc, x + cPc + cLine, x + cPc + cLine + cName, x + w - cCut, x + w];
  const h = RH * (rows.length + 1);
  ink.rect(x, top, w, h, 0.25, { stroke: INK });
  ink.line(x, top + RH, x + w, top + RH, 0.25);
  for (const cx of xs.slice(1, -1)) ink.line(cx, top, cx, top + h, 0.13);
  const hy = top + RH - 0.9;
  const hs = TAB * 0.95;
  ink.text(xs[0] + cPc / 2, hy, 'PC', hs, { anchor: 'middle', bold: true });
  ink.text(xs[1] + cLine / 2, hy, 'LINE', hs * 0.85, { anchor: 'middle', bold: true });
  ink.text(xs[2] + 1, hy, 'TWINE', hs, { bold: true });
  ink.text(xs[3] + 1, hy, 'ROUTE (NAIL ORDER)', hs, { bold: true });
  ink.text(xs[5] - 1.2, hy, 'CUT', hs, { anchor: 'end', bold: true });
  rows.forEach((r, i) => {
    const mid = top + RH * (i + 1) + RH / 2;
    const by = top + RH * (i + 2) - 0.9;
    ink.circle(xs[0] + cPc / 2, mid, 1.35, 0.2, { stroke: INK, fill: '#fff' });
    const ls = r.letter.length > 1 ? 1.3 : 1.8;
    ink.text(xs[0] + cPc / 2, mid + capH(ls) / 2, r.letter, ls, { anchor: 'middle', bold: true });
    ink.line(xs[1] + 1, mid, xs[2] - 1, mid, 0.45, { color: r.color, dash: r.dash });
    ink.rect(xs[2] + 1, mid - 1.2, 2.4, 2.4, 0.12, { stroke: INK, fill: r.color });
    ink.text(xs[2] + 4.4, by, truncate(r.name, TAB, cName - 5), TAB);
    ink.text(xs[3] + 1, by, routeText(r.nails, TAB, cRoute - 2), TAB);
    ink.text(xs[5] - 1.2, by, r.cut, TAB, { anchor: 'end', bold: true });
  });
}

// ── title block ─────────────────────────────────────────────────────────

function titleBlock(
  ink: Ink,
  tb: { x0: number; x1: number; y0: number; y1: number },
  info: { title: string; wall: { width: number; height: number; units: Units }; den: number; date: string; sheet: number; of: number },
  bar: { k: number; units: Units },
) {
  const { x0, x1, y0 } = tb;
  const w = x1 - x0;
  const rows = [13, 9, 12, 9];
  const ys = rows.reduce<number[]>((a, h) => [...a, a[a.length - 1] + h], [y0]);
  ink.rect(x0, y0, w, TB_H, 0.5, { stroke: INK });
  for (const y of ys.slice(1, -1)) ink.line(x0, y, x1, y, 0.25);
  const cap = (x: number, y: number, t: string) => ink.text(x + 1.2, y + 2.3, t, 1.5);
  const val = (x: number, y: number, h: number, t: string, maxW: number, size = 2.6, bold = false) =>
    ink.text(x + 1.2, y + h - 2, truncate(t, size, maxW - 2.4, bold), size, { bold });
  const cells = (y: number, h: number, parts: [number, string, string][]) => {
    let x = x0;
    parts.forEach(([frac, c, v], i) => {
      const cw = w * frac;
      if (i > 0) ink.line(x, y, x, y + h, 0.25);
      cap(x, y, c);
      val(x, y, h, v, cw);
      x += cw;
    });
  };
  const { width, height, units } = info.wall;
  cap(x0, ys[0], 'TITLE');
  val(x0, ys[0], rows[0], info.title.toUpperCase(), w, 4.4, true);
  cells(ys[1], rows[1], [
    [0.42, 'WALL (W × H)', `${formatMeasure(width, units)} × ${formatMeasure(height, units)}`],
    [0.28, 'SCALE', `SCALE 1:${info.den}`],
    [0.3, 'UNITS', units === 'in' ? 'INCHES' : 'CENTIMETRES'],
  ]);
  // Graphic scale bar.
  cap(x0, ys[2], 'GRAPHIC SCALE');
  {
    const steps = units === 'in' ? [1, 2, 3, 6, 12, 24, 36, 48, 60, 120] : [1, 2, 5, 10, 20, 50, 100, 200];
    const room = w - 16;
    const step = [...steps].reverse().find((s) => 4 * s * bar.k <= room) ?? steps[0];
    const sx = x0 + 4;
    const sy = ys[2] + 4.2;
    for (let i = 0; i < 4; i++) {
      ink.rect(sx + i * step * bar.k, sy, step * bar.k, 1.6, 0.2, { stroke: INK, fill: i % 2 === 0 ? INK : '#fff' });
      ink.text(sx + i * step * bar.k, sy + 4.6, i === 0 ? '0' : formatMeasure(i * step, units), 1.6, { anchor: 'middle' });
    }
    ink.text(sx + 4 * step * bar.k, sy + 4.6, formatMeasure(4 * step, units), 1.6, { anchor: 'middle' });
  }
  cells(ys[3], rows[3], [
    [0.27, 'DATE', info.date],
    [0.28, 'SHEET', `SHEET ${info.sheet} OF ${info.of}`],
    [0.45, 'DRAWN', 'DRAWN: Photo Web Designer'],
  ]);
}

