import { useMemo } from 'react';
import type { ResolvedDesign } from '@/contracts/design';
import type { BuildPlan, Report } from '@/contracts/plan';
import type { MeasureOrigin } from '@/contracts/ui';
import { buildPlanDrawing, type PlanDrawing, type PlanPaper, type Prim } from './drawing';

export interface PlanSheetProps {
  resolved: ResolvedDesign;
  plan: BuildPlan;
  report?: Report;
  origin?: MeasureOrigin;
  title?: string;
  paper?: PlanPaper;
  /** Fixed date for the title block (tests / reproducible output). */
  date?: string;
  className?: string;
}

const FONT = 'Helvetica, Arial, sans-serif';
const dash = (d?: number[]) => (d && d.length ? d.join(' ') : undefined);

function render(p: Prim, i: number) {
  switch (p.kind) {
    case 'line':
      return (
        <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.color ?? '#000'} strokeWidth={p.w} strokeDasharray={dash(p.dash)} />
      );
    case 'poly': {
      const pts = p.pts.map((q) => `${q.x},${q.y}`).join(' ');
      const common = { stroke: p.color ?? '#000', strokeWidth: p.w, strokeDasharray: dash(p.dash), strokeLinejoin: 'round' as const };
      return p.closed ? (
        <polygon key={i} points={pts} fill={p.fill ?? 'none'} {...common} />
      ) : (
        <polyline key={i} points={pts} fill="none" {...common} />
      );
    }
    case 'circle':
      return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} stroke={p.stroke ?? 'none'} strokeWidth={p.w} fill={p.fill ?? 'none'} />;
    case 'rect':
      return (
        <rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} stroke={p.stroke ?? 'none'} strokeWidth={p.w} fill={p.fill ?? 'none'} />
      );
    case 'text':
      return (
        <text
          key={i}
          x={p.x}
          y={p.y}
          fontSize={p.size}
          fontFamily={FONT}
          fontWeight={p.bold ? 700 : 400}
          textAnchor={p.anchor ?? 'start'}
          fill={p.color ?? '#000'}
          transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}
        >
          {p.text}
        </text>
      );
  }
}

/** Render one sheet of a drawing model as SVG (sheet millimetres as user units). */
export function SheetSvg({ drawing, index, className }: { drawing: PlanDrawing; index: number; className?: string }) {
  const sheet = drawing.sheets[index];
  return (
    <svg
      className={className}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      role="img"
      aria-label={`Drawing sheet ${index + 1} of ${drawing.sheets.length}`}
      data-sheet={index + 1}
      style={{ display: 'block', background: '#fff', colorScheme: 'light' }}
    >
      <rect x={0} y={0} width={drawing.width} height={drawing.height} fill="#fff" />
      {sheet.items.map(render)}
    </svg>
  );
}

/**
 * The dimensioned, scaled engineering drawing of the photo web: one landscape sheet with the
 * wall elevation, dimension chains, schedules, notes and a title block (plus continuation sheets
 * for long schedules). Always black on white, even in dark mode: it's meant to be printed.
 */
export function PlanSheet({ resolved, plan, report, origin = 'top-left', title, paper = 'tabloid', date, className }: PlanSheetProps) {
  const drawing = useMemo(
    () => buildPlanDrawing(resolved, plan, { report, origin, title, paper, date }),
    [resolved, plan, report, origin, title, paper, date],
  );
  return (
    <div className={className} data-testid="plan-sheet" data-scale={drawing.scale.label} style={{ display: 'grid', gap: 16 }}>
      {drawing.sheets.map((_, i) => (
        <SheetSvg key={i} drawing={drawing} index={i} />
      ))}
    </div>
  );
}
