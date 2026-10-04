import { jsPDF } from 'jspdf';
import type { ResolvedDesign, Vec2 } from '@/contracts/design';
import type { TemplatePdfOptions } from '@/contracts/ui';
import { sagPoints } from '@/lib/geom';
import { nailLabels } from '@/lib/labels';
import { formatMeasure } from '@/lib/units';
import { clipSegment } from './clip';
import { measureFrom } from './coords';
import { computeTiles, DEFAULT_OVERLAP_MM, mmPerUnit, type PageChrome, type Tile, type TileLayout } from './tiles';

export interface TemplateLayout {
  /** mm per wall unit. */
  k: number;
  wallMm: { width: number; height: number };
  layout: TileLayout;
  calibration: { sizeMm: number; label: string };
  /** Assembly map + one page per tile. */
  pageCount: number;
}

/** Everything about the template that can be computed without drawing (pure). */
export function templateLayout(resolved: ResolvedDesign, opts: TemplatePdfOptions): TemplateLayout {
  const k = mmPerUnit(resolved.wall.units);
  const wallMm = { width: resolved.wall.width * k, height: resolved.wall.height * k };
  const calibration =
    resolved.wall.units === 'in' ? { sizeMm: 25.4, label: '1 inch' } : { sizeMm: 50, label: '5 cm' };
  const chrome: PageChrome = { top: 12, bottom: calibration.sizeMm + 7 };
  const layout = computeTiles(wallMm, opts.paper, opts.margin, DEFAULT_OVERLAP_MM, chrome);
  return { k, wallMm, layout, calibration, pageCount: 1 + layout.tiles.length };
}

type RGB = [number, number, number];

function parseColor(css: string): RGB {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return [120, 110, 100];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}
const mix = (c: RGB, t: number): RGB => c.map((v) => Math.round(v + (255 - v) * t)) as RGB;

interface Target {
  x: number;
  y: number;
}

/** Registration targets (wall mm) at the middle of every overlap strip, printed on both sheets. */
function registrationTargets(l: TileLayout): Target[] {
  const out: Target[] = [];
  const sx = l.contentW - l.overlap;
  const sy = l.contentH - l.overlap;
  for (let c = 0; c < l.cols - 1; c++) {
    const x = (c + 1) * sx + l.overlap / 2;
    for (let r = 0; r < l.rows; r++) out.push({ x, y: r * sy + l.contentH * 0.25 }, { x, y: r * sy + l.contentH * 0.75 });
  }
  for (let r = 0; r < l.rows - 1; r++) {
    const y = (r + 1) * sy + l.overlap / 2;
    for (let c = 0; c < l.cols; c++) out.push({ x: c * sx + l.contentW * 0.25, y }, { x: c * sx + l.contentW * 0.75, y });
  }
  return out;
}

const inside = (p: Vec2, t: { x: number; y: number; w: number; h: number }) =>
  p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;


/** 1:1-scale nail template, tiled across pages with registration marks. */
export async function exportTemplatePdf(resolved: ResolvedDesign, opts: TemplatePdfOptions): Promise<Blob> {
  const doc = buildTemplateDoc(resolved, opts);
  return doc.output('blob');
}

export function buildTemplateDoc(resolved: ResolvedDesign, opts: TemplatePdfOptions): jsPDF {
  const tl = templateLayout(resolved, opts);
  const { k, wallMm, layout, calibration } = tl;
  const labels = nailLabels(resolved.nails);
  const units = resolved.wall.units;
  const title = opts.title?.trim() || 'Photo web';
  const nailById = new Map(resolved.nails.map((n) => [n.id, n]));
  const groupColor = new Map(resolved.groups.map((g) => [g.id, parseColor(g.color)]));

  // Edge polylines in wall mm.
  const edgeLines = resolved.edges.flatMap((e) => {
    const a = nailById.get(e.a);
    const b = nailById.get(e.b);
    if (!a || !b) return [];
    const pts = sagPoints(a, b, e.sag, e.sag > 0 ? 24 : 1).map((p) => ({ x: p.x * k, y: p.y * k }));
    return [{ pts, color: groupColor.get(e.groupId) ?? ([120, 110, 100] as RGB) }];
  });
  const nailsMm = resolved.nails.map((n) => ({ id: n.id, x: n.x * k, y: n.y * k, label: labels[n.id] }));
  const targets = registrationTargets(layout);
  const wallLines: [Vec2, Vec2][] = [
    [{ x: 0, y: 0 }, { x: wallMm.width, y: 0 }],
    [{ x: wallMm.width, y: 0 }, { x: wallMm.width, y: wallMm.height }],
    [{ x: wallMm.width, y: wallMm.height }, { x: 0, y: wallMm.height }],
    [{ x: 0, y: wallMm.height }, { x: 0, y: 0 }],
  ];
  const originPt: Vec2 = {
    x: opts.origin.endsWith('right') ? wallMm.width : 0,
    y: opts.origin.startsWith('bottom') ? wallMm.height : 0,
  };

  const doc = new jsPDF({ unit: 'mm', format: opts.paper, orientation: 'portrait' });
  doc.setProperties({ title: `${title}: nail template`, creator: 'Photo Web Designer' });

  drawAssemblyMap(doc, tl, opts, title, edgeLines, nailsMm, originPt);

  const tileById = new Map(layout.tiles.map((t) => [`${t.row},${t.col}`, t]));
  const neighbour = (t: Tile, dr: number, dc: number) => tileById.get(`${t.row + dr},${t.col + dc}`);

  layout.tiles.forEach((t, i) => {
    doc.addPage(opts.paper, layout.orientation);
    const ox = layout.contentX - t.x;
    const oy = layout.contentY - t.y;
    const P = (p: Vec2) => ({ x: p.x + ox, y: p.y + oy });
    const rect = { x: t.x, y: t.y, w: t.w, h: t.h };
    const line = (p: Vec2, q: Vec2) => {
      const c = clipSegment(p, q, rect);
      if (!c) return;
      const a = P(c[0]);
      const b = P(c[1]);
      doc.line(a.x, a.y, b.x, b.y);
    };

    // Outside-the-wall shading.
    doc.setFillColor(236, 236, 236);
    const wx0 = Math.max(t.x, 0);
    const wy0 = Math.max(t.y, 0);
    const wx1 = Math.min(t.x + t.w, wallMm.width);
    const wy1 = Math.min(t.y + t.h, wallMm.height);
    if (wx1 <= wx0 || wy1 <= wy0) {
      doc.rect(layout.contentX, layout.contentY, t.w, t.h, 'F');
    } else {
      if (t.x + t.w > wallMm.width) doc.rect(P({ x: wallMm.width, y: 0 }).x, layout.contentY, t.x + t.w - wallMm.width, t.h, 'F');
      if (t.y + t.h > wallMm.height) doc.rect(layout.contentX, P({ x: 0, y: wallMm.height }).y, t.w, t.y + t.h - wallMm.height, 'F');
    }

    // Overlap strips (where the next sheet will lie on top).
    doc.setFillColor(246, 243, 236);
    const right = neighbour(t, 0, 1);
    const below = neighbour(t, 1, 0);
    const left = neighbour(t, 0, -1);
    const above = neighbour(t, -1, 0);
    doc.setFontSize(6);
    doc.setTextColor(150, 140, 125);
    if (right) {
      doc.rect(layout.contentX + t.w - layout.overlap, layout.contentY, layout.overlap, t.h, 'F');
      doc.text(`${right.id} overlaps here`, layout.contentX + t.w - layout.overlap / 2 + 1, layout.contentY + t.h / 2, {
        angle: 90,
        align: 'center',
      });
    }
    if (below) {
      doc.rect(layout.contentX, layout.contentY + t.h - layout.overlap, t.w, layout.overlap, 'F');
      doc.text(`${below.id} overlaps here`, layout.contentX + t.w / 2, layout.contentY + t.h - layout.overlap / 2 + 1, {
        align: 'center',
      });
    }

    // Sheet border: dashed cut lines on the sides that go on top of a neighbour.
    doc.setLineWidth(0.2);
    doc.setDrawColor(160, 160, 160);
    const cx0 = layout.contentX;
    const cy0 = layout.contentY;
    const cx1 = cx0 + t.w;
    const cy1 = cy0 + t.h;
    doc.line(cx1, cy0, cx1, cy1);
    doc.line(cx0, cy1, cx1, cy1);
    doc.setDrawColor(90, 90, 90);
    for (const [has, a, b] of [
      [left, { x: cx0, y: cy0 }, { x: cx0, y: cy1 }],
      [above, { x: cx0, y: cy0 }, { x: cx1, y: cy0 }],
    ] as const) {
      if (has) doc.setLineDashPattern([2, 1.5], 0);
      else doc.setDrawColor(160, 160, 160);
      doc.line(a.x, a.y, b.x, b.y);
      doc.setLineDashPattern([], 0);
      doc.setDrawColor(90, 90, 90);
    }
    doc.setFontSize(6);
    doc.setTextColor(90, 90, 90);
    if (left) doc.text(`cut on dashed line, lay over ${left.id}`, cx0 - 1.2, cy0 + t.h / 2, { angle: 90, align: 'center' });
    if (above) doc.text(`cut on dashed line, lay over ${above.id}`, cx0 + t.w / 2, cy0 - 1.2, { align: 'center' });

    // Faint twine for orientation.
    doc.setLineWidth(0.35);
    for (const e of edgeLines) {
      doc.setDrawColor(...mix(e.color, 0.6));
      for (let j = 1; j < e.pts.length; j++) line(e.pts[j - 1], e.pts[j]);
    }

    // Wall edges.
    doc.setDrawColor(40, 40, 40);
    doc.setLineWidth(0.8);
    doc.setFontSize(7);
    doc.setTextColor(40, 40, 40);
    for (const [a, b] of wallLines) {
      const c = clipSegment(a, b, rect);
      if (!c || (c[0].x === c[1].x && c[0].y === c[1].y)) continue;
      line(a, b);
      const mid = P({ x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 });
      const vertical = a.x === b.x;
      const outward = vertical ? (a.x === 0 ? -1 : 1) : a.y === 0 ? -1 : 1;
      if (vertical) doc.text('WALL EDGE', mid.x - outward * 2.5, mid.y, { angle: 90, align: 'center' });
      else doc.text('WALL EDGE', mid.x, mid.y - outward * 2 + (outward < 0 ? 2.5 : 0), { align: 'center' });
    }
    if (inside(originPt, rect)) {
      const o = P(originPt);
      doc.setFontSize(8);
      doc.text(`MEASURING ORIGIN (${opts.origin})`, o.x + (originPt.x === 0 ? 3 : -3), o.y + (originPt.y === 0 ? 6 : -4), {
        align: originPt.x === 0 ? 'left' : 'right',
      });
    }

    // Registration targets.
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    for (const g of targets) {
      if (!inside(g, rect)) continue;
      const p = P(g);
      doc.circle(p.x, p.y, 2.5, 'S');
      doc.line(p.x - 4, p.y, p.x + 4, p.y);
      doc.line(p.x, p.y - 4, p.x, p.y + 4);
    }

    // Nails: crosshair + circle + label at the exact position.
    const here = nailsMm.filter((n) => inside(n, rect));
    doc.setLineWidth(0.25);
    for (const n of here) {
      doc.setDrawColor(200, 40, 40);
      line({ x: n.x - 5, y: n.y }, { x: n.x + 5, y: n.y });
      line({ x: n.x, y: n.y - 5 }, { x: n.x, y: n.y + 5 });
      const p = P(n);
      doc.circle(p.x, p.y, 1.6, 'S');
      doc.setFontSize(9);
      doc.setTextColor(170, 20, 20);
      const lx = n.x + 6 > t.x + t.w ? p.x - 2.4 : p.x + 2.4;
      doc.text(`#${n.label}`, lx, p.y - 2.2, { align: n.x + 6 > t.x + t.w ? 'right' : 'left' });
    }
    if (here.length === 0) {
      doc.setFontSize(14);
      doc.setTextColor(170, 170, 170);
      doc.text('(no nails)', cx0 + t.w / 2, cy0 + t.h / 2, { align: 'center' });
    }

    // Header.
    const hy = layout.contentY - 4;
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Sheet ${t.id}`, layout.contentX, hy);
    const hx = layout.contentX + doc.getTextWidth(`Sheet ${t.id}`) + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const a = measureFrom({ x: Math.max(0, t.x) / k, y: Math.max(0, t.y) / k }, resolved.wall, opts.origin);
    const b = measureFrom(
      { x: Math.min(wallMm.width, t.x + t.w) / k, y: Math.min(wallMm.height, t.y + t.h) / k },
      resolved.wall,
      opts.origin,
    );
    const range = (p: number, q: number) => `${formatMeasure(Math.min(p, q), units)} to ${formatMeasure(Math.max(p, q), units)}`;
    doc.text(`${title}  |  sheet ${i + 1} of ${layout.tiles.length}  |  row ${t.id.replace(/\d+$/, '')}, column ${t.col + 1}`, hx, hy - 3.2);
    if (wx1 > wx0 && wy1 > wy0) {
      doc.text(`covers x ${range(a.x, b.x)}, y ${range(a.y, b.y)} from the ${opts.origin} corner`, hx, hy);
    } else {
      doc.text('outside the wall area', hx, hy);
    }

    // Footer: calibration square + neighbours.
    const s = calibration.sizeMm;
    const fy = layout.pageH - opts.margin - s;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(layout.contentX, fy, s, s, 'S');
    doc.setFontSize(7);
    doc.text(calibration.label, layout.contentX + s / 2, fy + s / 2 + 1, { align: 'center' });
    doc.setFontSize(8);
    const tx = layout.contentX + s + 4;
    doc.setFont('helvetica', 'bold');
    doc.text(`MEASURE ME: if this square isn't exactly ${calibration.label}, print at 100% / actual size.`, tx, fy + 4);
    doc.setFont('helvetica', 'normal');
    const nb = [
      `left: ${left?.id ?? '-'}`,
      `right: ${right?.id ?? '-'}`,
      `above: ${above?.id ?? '-'}`,
      `below: ${below?.id ?? '-'}`,
    ].join('   ');
    doc.text(`Neighbours  ${nb}`, tx, fy + 9);
    doc.text('Line up the black targets with the neighbouring sheet, then tape. Hammer each nail through its red crosshair.', tx, fy + 14, {
      maxWidth: layout.pageW - opts.margin - tx,
    });
  });

  return doc;
}

function drawAssemblyMap(
  doc: jsPDF,
  tl: TemplateLayout,
  opts: TemplatePdfOptions,
  title: string,
  edgeLines: { pts: Vec2[]; color: RGB }[],
  nailsMm: { x: number; y: number; label: string }[],
  originPt: Vec2,
) {
  const { layout, wallMm, calibration } = tl;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const m = opts.margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  doc.text(`${title}: 1:1 nail template`, m, m + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `${layout.tiles.length} sheets (${layout.rows} rows x ${layout.cols} columns, ${layout.orientation}), ${opts.paper === 'a4' ? 'A4' : 'US Letter'}. Assembly map:`,
    m,
    m + 14,
  );

  // Fit the whole tiled area (which may extend past the wall) into the map box.
  const sx = layout.contentW - layout.overlap;
  const sy = layout.contentH - layout.overlap;
  const fullW = Math.max(wallMm.width, (layout.cols - 1) * sx + layout.contentW);
  const fullH = Math.max(wallMm.height, (layout.rows - 1) * sy + layout.contentH);
  const boxX = m;
  const boxY = m + 20;
  const boxW = pw - 2 * m;
  const boxH = (ph - 2 * m) * 0.5;
  const s = Math.min(boxW / fullW, boxH / fullH);
  const X = (x: number) => boxX + x * s;
  const Y = (y: number) => boxY + y * s;

  // Wall.
  doc.setFillColor(248, 245, 238);
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.6);
  doc.rect(X(0), Y(0), wallMm.width * s, wallMm.height * s, 'FD');

  // Twine + nails.
  doc.setLineWidth(0.3);
  for (const e of edgeLines) {
    doc.setDrawColor(...e.color);
    for (let j = 1; j < e.pts.length; j++) doc.line(X(e.pts[j - 1].x), Y(e.pts[j - 1].y), X(e.pts[j].x), Y(e.pts[j].y));
  }
  doc.setFillColor(60, 60, 60);
  for (const n of nailsMm) doc.circle(X(n.x), Y(n.y), 0.5, 'F');

  // Tile grid.
  doc.setDrawColor(63, 110, 140);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 1], 0);
  doc.setTextColor(63, 110, 140);
  doc.setFontSize(Math.max(5, Math.min(11, sx * s * 0.35)));
  for (const t of layout.tiles) {
    doc.rect(X(t.x), Y(t.y), sx * s, sy * s, 'S');
    doc.text(t.id, X(t.x + sx / 2), Y(t.y + sy / 2) + 1, { align: 'center' });
  }
  doc.setLineDashPattern([], 0);

  // Origin.
  doc.setFillColor(181, 82, 59);
  doc.circle(X(originPt.x), Y(originPt.y), 1.5, 'F');
  doc.setFontSize(8);
  doc.setTextColor(181, 82, 59);
  doc.text(`origin (${opts.origin})`, X(originPt.x) + (originPt.x === 0 ? 2 : -2), Y(originPt.y) + (originPt.y === 0 ? -1.5 : 4), {
    align: originPt.x === 0 ? 'left' : 'right',
  });

  // Instructions.
  const steps = [
    `Print every page at 100% / "Actual size" (turn OFF "fit to page"). On any sheet, check the calibration square measures exactly ${calibration.label}.`,
    'Lay the sheets out like the map above: row A along the top, column 1 on the left.',
    'On each sheet, cut along the dashed line on its left and top sides (sheets in row A / column 1 keep that side). Lay it over its neighbour so the black registration targets sit exactly on top of each other, then tape.',
    'Tape the assembled template to the wall with painter\'s tape. Line the thick WALL EDGE lines up with the edges of your wall area, and use a level to keep it straight.',
    'Hammer each nail through the centre of its red crosshair, leaving the head standing proud. Nail numbers match the walkthrough and coordinate table.',
    'Tear the paper away around the nails, then follow the stringing walkthrough.',
  ];
  let y = boxY + fullH * s + 10;
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('How to use this template', m, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  y += 6;
  steps.forEach((txt, i) => {
    const lines = doc.splitTextToSize(`${i + 1}. ${txt}`, pw - 2 * m - 4) as string[];
    doc.text(lines, m, y);
    y += lines.length * 4.3 + 1.5;
  });

  // Calibration square on the map page too.
  const cs = calibration.sizeMm;
  const cy = Math.min(ph - m - cs, y + 3);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(m, cy, cs, cs, 'S');
  doc.setFontSize(7);
  doc.text(calibration.label, m + cs / 2, cy + cs / 2 + 1, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`MEASURE ME: if this isn't exactly ${calibration.label}, print at 100% / actual size.`, m + cs + 4, cy + 5);
  doc.setFont('helvetica', 'normal');
}
