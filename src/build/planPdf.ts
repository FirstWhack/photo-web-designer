import { jsPDF } from 'jspdf';
import type { ResolvedDesign } from '@/contracts/design';
import type { BuildPlan, Report } from '@/contracts/plan';
import type { MeasureOrigin } from '@/contracts/ui';
import { buildPlanDrawing, type PlanDrawing, type PlanPaper, type Prim } from './drawing';

export interface PlanPdfOptions {
  paper: PlanPaper;
  origin: MeasureOrigin;
  title?: string;
  report?: Report;
  date?: string;
}

type RGB = [number, number, number];
const NAMED: Record<string, RGB> = { black: [0, 0, 0], white: [255, 255, 255] };

function rgb(css: string | undefined, fallback: RGB = [0, 0, 0]): RGB {
  if (!css) return fallback;
  const s = css.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  const f = /^rgba?\(([^)]+)\)$/.exec(s);
  if (f) return f[1].split(/[ ,/]+/).slice(0, 3).map((v) => Math.round(Number.parseFloat(v)) || 0) as RGB;
  return [120, 120, 120];
}

/** jsPDF's standard fonts are WinAnsi: swap the few characters outside it. */
const pdfText = (s: string) => s.replace(/–/g, '-').replace(/…/g, '...').replace(/″/g, '"');
const PT_PER_MM = 1 / 0.352778;

function draw(doc: jsPDF, p: Prim) {
  switch (p.kind) {
    case 'line':
      doc.setDrawColor(...rgb(p.color));
      doc.setLineWidth(p.w);
      doc.setLineDashPattern(p.dash ?? [], 0);
      doc.line(p.x1, p.y1, p.x2, p.y2);
      return;
    case 'poly': {
      if (p.pts.length < 2) return;
      doc.setDrawColor(...rgb(p.color));
      doc.setLineWidth(p.w);
      doc.setLineDashPattern(p.dash ?? [], 0);
      const deltas = p.pts.slice(1).map((q, i) => [q.x - p.pts[i].x, q.y - p.pts[i].y]);
      if (p.fill) doc.setFillColor(...rgb(p.fill));
      doc.lines(deltas, p.pts[0].x, p.pts[0].y, [1, 1], p.fill ? 'FD' : 'S', !!p.closed);
      return;
    }
    case 'circle': {
      doc.setLineDashPattern([], 0);
      doc.setLineWidth(p.w);
      if (p.stroke) doc.setDrawColor(...rgb(p.stroke));
      if (p.fill) doc.setFillColor(...rgb(p.fill));
      const style = p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S';
      doc.circle(p.cx, p.cy, p.r, style);
      return;
    }
    case 'rect': {
      doc.setLineDashPattern([], 0);
      doc.setLineWidth(p.w);
      if (p.stroke) doc.setDrawColor(...rgb(p.stroke));
      if (p.fill) doc.setFillColor(...rgb(p.fill));
      const style = p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S';
      doc.rect(p.x, p.y, p.width, p.height, style);
      return;
    }
    case 'text': {
      const text = pdfText(p.text);
      doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
      doc.setFontSize(p.size * PT_PER_MM);
      doc.setTextColor(...rgb(p.color));
      const w = doc.getTextWidth(text);
      const shift = p.anchor === 'middle' ? w / 2 : p.anchor === 'end' ? w : 0;
      if (p.rotate === -90) doc.text(text, p.x, p.y + shift, { angle: 90 });
      else doc.text(text, p.x - shift, p.y);
      return;
    }
  }
}

/** Render a drawing model with jsPDF vector primitives (one landscape page per sheet). */
export function renderPlanPdf(drawing: PlanDrawing, title: string): jsPDF {
  const fmt: [number, number] = [drawing.width, drawing.height];
  const doc = new jsPDF({ unit: 'mm', format: fmt, orientation: 'landscape' });
  doc.setProperties({ title: `${title}: engineering drawing`, creator: 'Photo Web Designer' });
  doc.setLineCap('butt');
  drawing.sheets.forEach((sheet, i) => {
    if (i > 0) doc.addPage(fmt, 'landscape');
    for (const p of sheet.items) draw(doc, p);
  });
  return doc;
}

/** The engineering drawing as a vector PDF that matches `PlanSheet`. */
export async function exportPlanPdf(resolved: ResolvedDesign, plan: BuildPlan, opts: PlanPdfOptions): Promise<Blob> {
  const drawing = buildPlanDrawing(resolved, plan, opts);
  return renderPlanPdf(drawing, opts.title?.trim() || 'Photo web').output('blob');
}
